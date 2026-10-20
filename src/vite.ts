/**
 * Remote 仓的 module.json 构建期门禁：Vite 插件 + 从 vite.config.ts 读 federation name。
 *
 * 门户壳不再编译业务模块，壳侧的元数据守卫随之下线，元数据改由各 Remote 自证：
 * 构建前先校验本仓 module.json，不合规就抛错停下，避免元数据漂了却照常发版。
 * 规则只有这一份（`manifest.ts`），与壳侧注册中心共用。
 *
 * 本文件不依赖 vite：插件对象按结构体返回，消费方装不装 vite 都能引用本包。
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { assertRemoteBinding, newSeen, validateManifest } from './manifest.js'

const DEFAULT_MANIFEST_PATH = 'src/module.json'
const DEFAULT_VITE_CONFIG_PATH = 'vite.config.ts'
const FEDERATION_NAME_PATTERN = /const\s+federationName\s*=\s*["']([^"']+)["']/

export type ModuleGuardOptions = {
  /** 构建期 federation name；必须与 module.json 的 remote.scope 一致。 */
  federationName: string
  /** 相对消费仓根的 module.json 路径；默认 `src/module.json`。 */
  manifestPath?: string
}

type EmitFile = (file: { type: 'asset'; fileName: string; source: string }) => void

type DevResponse = {
  setHeader(name: string, value: string): void
  end(body: string): void
}

type DevServer = {
  middlewares: {
    use(path: string, handler: (request: unknown, response: DevResponse) => void): void
  }
}

function fromCwd(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

/** 读消费仓的 module.json；守卫插件与 CLI 都从这里取元数据，不各自拼路径。 */
export function readModuleManifest(manifestPath: string = DEFAULT_MANIFEST_PATH): unknown {
  return JSON.parse(readFileSync(fromCwd(manifestPath), 'utf8'))
}

/**
 * 从消费仓的 vite.config.ts 取出 federation name 字面量。
 * 名字的唯一真相源在 vite.config.ts；命令行与构建期插件据此比对同一个名字，不抄第三份。
 */
export function resolveFederationName(configPath: string = DEFAULT_VITE_CONFIG_PATH): string {
  const source = readFileSync(fromCwd(configPath), 'utf8')
  const match = FEDERATION_NAME_PATTERN.exec(source)
  if (!match) {
    throw new Error('无法从 vite.config.ts 解析 federationName，确认它仍以字面量常量声明')
  }
  return match[1]
}

/**
 * Vite 插件：构建期校验本仓 module.json，并把这份自述原样发到产物根。
 *
 * 校验失败直接阻断构建，避免元数据漂了却照常发版。发出的是**原样** JSON，不是校验后的
 * 重建对象：注册中心还要从产物根取 version / minShellVersion / remote，重建会把这些字段丢掉。
 *
 * emit 出去是为了让模块自述随产物一起发布：注册中心按 <产物根>/module.json 取产品元数据，
 * 不在服务端另抄一份——同一份元数据留两个副本，就会各自漂移。产物根由 base 决定
 * （发布时是 /portal-remotes/<id>/<version>/），所以这里只写文件名，不拼路径。
 */
export function moduleGuard({ federationName, manifestPath }: ModuleGuardOptions) {
  const readValidated = (): unknown => {
    const raw = readModuleManifest(manifestPath)
    validateManifest(raw, newSeen())
    assertRemoteBinding(raw, federationName)
    return raw
  }

  let manifest: unknown

  return {
    name: 'servumi:module-guard',
    buildStart() {
      manifest = readValidated()
    },
    generateBundle(this: { emitFile: EmitFile }) {
      this.emitFile({
        type: 'asset',
        fileName: 'module.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
    configureServer(server: DevServer) {
      // 开发服务器没有构建产物。这里按发布后的同一地址补上 /module.json，
      // 否则本地联调时注册中心取不到自述，模块会整个从清单里消失。
      server.middlewares.use('/module.json', (_request: unknown, response: DevResponse) => {
        const current = readValidated()
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(`${JSON.stringify(current, null, 2)}\n`)
      })
    },
  }
}
