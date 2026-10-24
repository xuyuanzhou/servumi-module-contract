/**
 * 产物自述（build.json）：随构建产物落一份「这是哪个版本、什么时候、从哪个提交、对着哪个共享库编的」。
 *
 * module.json 讲的是「这个模块对外是什么」（产品元数据，注册中心要读），build.json 讲的是
 * 「这份产物是怎么编出来的」（构建事实，只在排查与审计时读）。两者都不在服务端另抄，随产物一起发。
 *
 * 字段里 gitSha 与 commonsVersion 是排查时最常用的两个：前者定位到源码快照，后者定位到
 * 当时那份共享契约——模块与共享库版本对不上时，先看这里再复现。
 *
 * 本文件与 `manifest.ts` 一样只读文件与跑一次 git，不依赖 vite，故构建期守卫与独立脚本都能用。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 共享库在消费仓里的目录名：版本指纹从它的 package.json 取，而不是从声明的范围取。 */
const COMMONS_PACKAGE = 'servumi-web-commons'

export type BuildManifest = {
  /** 模块标识，与 module.json 的 id 同源。 */
  id: string
  /** 模块版本，与 module.json 的 version 同源。 */
  version: string
  /** 构建时刻（ISO 8601）；这是构建事实，不追求可复现。 */
  builtAt: string
  /** 构建时的提交号；不在 git 仓库里时为空串。 */
  gitSha: string
  /** 构建时实际装上的共享库版本；取不到时为空串。 */
  commonsVersion: string
}

/** 取本仓当前提交号；非 git 工作树（如从 tarball 构建）返回空串，不阻断构建。 */
export function resolveGitSha(cwd: string = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

/**
 * 取实际装上的共享库版本。读的是 `node_modules` 里那份的 package.json：声明只写了范围，
 * 真正编进去的是装上的那一份，指纹要对准后者。
 */
export function resolveCommonsVersion(cwd: string = process.cwd()): string {
  const packagePath = join(cwd, 'node_modules', COMMONS_PACKAGE, 'package.json')
  if (!existsSync(packagePath)) {
    return ''
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : ''
  } catch {
    return ''
  }
}

/** 组装产物自述；`builtAt` 可注入，便于测试与固定时刻重放。 */
export function createBuildManifest(options: {
  id: string
  version: string
  cwd?: string
  builtAt?: string
}): BuildManifest {
  const cwd = options.cwd ?? process.cwd()
  return {
    id: options.id,
    version: options.version,
    builtAt: options.builtAt ?? new Date().toISOString(),
    gitSha: resolveGitSha(cwd),
    commonsVersion: resolveCommonsVersion(cwd),
  }
}
