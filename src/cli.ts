#!/usr/bin/env node
/**
 * 门禁 CLI：不依赖 tsc / vite，仅用 node 就能校验消费仓的 module.json 与端内页面目录，
 * 这样元数据或页面登记出问题时能先于打包被拦下，也不受 node_modules 是否装好影响。
 *
 * federation name 的唯一真相源在 vite.config.ts；这里直接读该文件取出常量，
 * 让命令行与构建期插件比对同一个名字，不再抄第二份。
 */
import { assertRemoteBinding, newSeen, validateManifest } from './manifest.js'
import { assertPageDirectories } from './pages.js'
import { readModuleManifest, resolveFederationName } from './vite.js'

try {
  const raw = readModuleManifest()
  const manifest = validateManifest(raw, newSeen())
  assertRemoteBinding(raw, resolveFederationName())
  assertPageDirectories()
  console.log(`module.json 校验通过：id=${manifest.id}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
