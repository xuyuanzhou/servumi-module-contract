#!/usr/bin/env node
/**
 * 门禁 CLI：不依赖 tsc / vite，仅用 node 就能校验消费仓的 module.json、端内页面目录与
 * 语言包闭环，这样元数据、页面登记或多语言出问题时能先于打包被拦下，也不受 node_modules
 * 是否装好影响。
 *
 * federation name 的唯一真相源在 vite.config.ts；这里直接读该文件取出常量，
 * 让命令行与构建期插件比对同一个名字，不再抄第二份。
 */
import { assertLocaleKeys, collectLocaleFinding, describeLocaleWarnings } from './locale-gate.js'
import { assertRemoteBinding, newSeen, validateManifest } from './manifest.js'
import { assertPageDirectories } from './pages.js'
import { readModuleManifest, resolveFederationName } from './vite.js'

try {
  const raw = readModuleManifest()
  const manifest = validateManifest(raw, newSeen())
  assertRemoteBinding(raw, resolveFederationName())
  assertPageDirectories()
  const locale = collectLocaleFinding()
  assertLocaleKeys(locale)
  const warnings = describeLocaleWarnings(locale)
  if (warnings !== '') {
    console.warn(warnings)
  }
  console.log(`module.json 校验通过：id=${manifest.id}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
