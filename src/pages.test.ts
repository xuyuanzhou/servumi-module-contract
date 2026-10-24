import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertPageDirectories } from './pages.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'servumi-pages-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 按相对路径造文件；父目录自动补齐，内容给默认占位即可。 */
function write(relative: string, content = ''): void {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/** 页组件：门禁只核它有没有默认导出。 */
const CONTENT = 'export default function Page() {\n  return null\n}\n'

/** 页自述：`path` 与 `label` 是键与地址，`component` 指同目录的 content。 */
function pageSource(path: string, label = 'page.label'): string {
  return [
    "import type { PageDefinition } from 'servumi-web-commons'",
    '',
    'export default {',
    `  path: '${path}',`,
    `  label: '${label}',`,
    "  component: () => import('./content'),",
    '} satisfies PageDefinition',
    '',
  ].join('\n')
}

/** 组自述：前缀 + 页清单；清单项取自顶部的默认导入。 */
function groupSource(path: string, pages: string[]): string {
  const identifiers = pages.map((name) => name[0].toUpperCase() + name.slice(1))
  return [
    "import type { PageGroup } from 'servumi-web-commons'",
    ...pages.map((name, index) => `import ${identifiers[index]} from './${name}'`),
    '',
    'export default {',
    `  path: '${path}',`,
    `  pages: [${identifiers.join(', ')}],`,
    '} satisfies PageGroup',
    '',
  ].join('\n')
}

/** 菜单自述：`key` 即模块内地址。 */
function menuSource(rows: string[]): string {
  return [
    "import type { MenuItem } from 'servumi-web-commons'",
    '',
    'export default [',
    ...rows,
    '] satisfies MenuItem[]',
    '',
  ].join('\n')
}

const SLOT_ENTRY = [
  "import { definePages } from 'servumi-web-commons'",
  "import menu from './menu'",
  "import groups from './pages/registry/router'",
  "export default definePages({ './pages/registry/router.ts': { default: groups } }, { menu, navLabel: 'title' })",
].join('\n')

/** 合规的管理端菜单：模块根一页 + `registry` 纯分组含两页。 */
const MENU = menuSource([
  "  { key: '/', label: 'manage.overview' },",
  '  {',
  "    key: '/registry',",
  "    label: 'manage.registry',",
  '    children: [',
  "      { key: '/registry/facts', label: 'manage.facts' },",
  "      { key: '/registry/paths', label: 'manage.paths' },",
  '    ],',
  '  },',
])

/** 一页：页自述 + 页内容。 */
function writePage(group: string, name: string, path: string, label?: string): void {
  write(`src/manage/pages/${group}/${name}/index.ts`, pageSource(path, label))
  write(`src/manage/pages/${group}/${name}/content.tsx`, CONTENT)
}

/** 合规的管理端：模块根一页（组前缀 `/`）+ `registry` 分组两页 + 菜单。 */
function compliantManageSlot(): void {
  write('src/manage/index.ts', SLOT_ENTRY)
  write('src/manage/menu.ts', MENU)
  write('src/manage/pages/main/router.ts', groupSource('/', ['overview']))
  writePage('main', 'overview', '/', 'manage.overview')
  write('src/manage/pages/registry/router.ts', groupSource('/registry', ['facts', 'paths']))
  writePage('registry', 'facts', '/facts', 'manage.facts')
  writePage('registry', 'paths', '/paths', 'manage.paths')
}

describe('assertPageDirectories', () => {
  it('放行合规的「模块根一页 + 分组两页」', () => {
    compliantManageSlot()
    expect(() => assertPageDirectories(root)).not.toThrow()
  })

  it('放行没有这一端的模块', () => {
    expect(() => assertPageDirectories(root)).not.toThrow()
  })

  it('拒绝端入口没用 definePages 装配', () => {
    compliantManageSlot()
    write('src/manage/index.ts', 'export default SomePage\n')
    expect(() => assertPageDirectories(root)).toThrow('没有用 definePages 装配')
  })

  it('拒绝用了 definePages 却没有 pages/ 目录', () => {
    write('src/manage/index.ts', SLOT_ENTRY)
    expect(() => assertPageDirectories(root)).toThrow('pages 不存在')
  })

  it('拒绝缺菜单自述', () => {
    compliantManageSlot()
    rmSync(join(root, 'src/manage/menu.ts'))
    expect(() => assertPageDirectories(root)).toThrow('menu.ts 不存在')
  })

  it('拒绝菜单没用 satisfies MenuItem[] 声明', () => {
    compliantManageSlot()
    write('src/manage/menu.ts', "export default [{ key: '/', label: 'x' }]\n")
    expect(() => assertPageDirectories(root)).toThrow('satisfies MenuItem[]')
  })

  it('拒绝 pages/ 下夹带散文件', () => {
    compliantManageSlot()
    write('src/manage/pages/notes.md')
    expect(() => assertPageDirectories(root)).toThrow('只放页面组目录')
  })

  it('拒绝组目录里缺 router.ts', () => {
    compliantManageSlot()
    rmSync(join(root, 'src/manage/pages/registry/router.ts'))
    expect(() => assertPageDirectories(root)).toThrow('router.ts')
  })

  it('拒绝组自述没用 satisfies PageGroup 声明', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/router.ts', "export default { path: '/registry', pages: [] }\n")
    expect(() => assertPageDirectories(root)).toThrow('satisfies PageGroup')
  })

  it('拒绝组自述没写 path', () => {
    compliantManageSlot()
    write(
      'src/manage/pages/registry/router.ts',
      "import Facts from './facts'\nexport default { pages: [Facts] } satisfies PageGroup\n",
    )
    expect(() => assertPageDirectories(root)).toThrow('没写 path')
  })

  it('拒绝组目录下没被 pages 收录的页目录', () => {
    compliantManageSlot()
    writePage('registry', 'orphan', '/orphan')
    expect(() => assertPageDirectories(root)).toThrow('没有收录页目录 orphan')
  })

  it('拒绝 pages 里写了不是导入进来的标识符', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/router.ts', groupSource('/registry', ['facts']).replace('[Facts]', '[Missing]'))
    expect(() => assertPageDirectories(root)).toThrow('不是本文件顶部')
  })

  it('拒绝组目录里夹带散文件', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/notes.ts')
    expect(() => assertPageDirectories(root)).toThrow('组目录只放')
  })

  it('拒绝页目录缺 content.tsx', () => {
    compliantManageSlot()
    rmSync(join(root, 'src/manage/pages/registry/facts/content.tsx'))
    expect(() => assertPageDirectories(root)).toThrow('缺 content.tsx')
  })

  it('拒绝页内容没有默认导出', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/facts/content.tsx', 'export const Page = 1\n')
    expect(() => assertPageDirectories(root)).toThrow('没有默认导出')
  })

  it('拒绝页自述没用 satisfies PageDefinition 声明', () => {
    compliantManageSlot()
    write(
      'src/manage/pages/registry/facts/index.ts',
      "export default { path: '/facts', label: 'x', component: () => import('./content') }\n",
    )
    expect(() => assertPageDirectories(root)).toThrow('satisfies PageDefinition')
  })

  it('拒绝把 label 写成内联文案对象', () => {
    compliantManageSlot()
    write(
      'src/manage/pages/registry/facts/index.ts',
      pageSource('/facts').replace("label: 'page.label'", "label: { 'zh-cn': '概览' }"),
    )
    expect(() => assertPageDirectories(root)).toThrow('label 是 i18n 的键')
  })

  it('拒绝 component 不是懒加载同目录的 content', () => {
    compliantManageSlot()
    write(
      'src/manage/pages/registry/facts/index.ts',
      pageSource('/facts').replace("() => import('./content')", 'FactsPage'),
    )
    expect(() => assertPageDirectories(root)).toThrow("要写成 () => import('./content')")
  })

  it('拒绝页自述没写 label', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/facts/index.ts', pageSource('/facts').replace(/\s*label: 'page\.label',/, ''))
    expect(() => assertPageDirectories(root)).toThrow('没写 label')
  })

  it('拒绝页目录里留下旧的页面文件', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/facts/index.tsx', CONTENT)
    expect(() => assertPageDirectories(root)).toThrow('页目录只放')
  })

  it('拒绝不合法的 path 段', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/router.ts', groupSource('/Registry', ['facts', 'paths']))
    expect(() => assertPageDirectories(root)).toThrow('不合法')
  })

  it('拒绝同一组里两页落在同一地址', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/router.ts', groupSource('/registry', ['facts', 'paths']))
    writePage('registry', 'paths', '/facts', 'manage.paths')
    expect(() => assertPageDirectories(root)).toThrow('同一层只能有一页')
  })

  it('拒绝两组的页落在同一地址：地址写在自述里，目录名挡不住重名', () => {
    compliantManageSlot()
    write('src/manage/pages/extra/router.ts', groupSource('/', ['notes']))
    writePage('extra', 'notes', '/registry/facts', 'manage.notes')
    expect(() => assertPageDirectories(root)).toThrow('同一层只能有一页')
  })

  it('拒绝菜单 key 在路由树上找不到落点', () => {
    compliantManageSlot()
    write('src/manage/menu.ts', menuSource(["  { key: '/nowhere', label: 'manage.nowhere' },"]))
    expect(() => assertPageDirectories(root)).toThrow('找不到落点')
  })

  it('拒绝没有子项的菜单项指向没有页面的地址', () => {
    compliantManageSlot()
    write('src/manage/pages/extra/router.ts', groupSource('/empty', ['notes']))
    writePage('extra', 'notes', '/facts2', 'manage.notes')
    write('src/manage/menu.ts', menuSource(["  { key: '/empty', label: 'manage.empty' },"]))
    expect(() => assertPageDirectories(root)).toThrow('点下去不会跳转')
  })

  it('拒绝菜单里没有一个可点的页面', () => {
    compliantManageSlot()
    write('src/manage/menu.ts', menuSource([]))
    expect(() => assertPageDirectories(root)).toThrow('没有一个可点的页面')
  })

  it('放行动态段地址', () => {
    compliantManageSlot()
    write('src/manage/pages/registry/router.ts', groupSource('/registry', ['facts', 'paths', 'detail']))
    writePage('registry', 'detail', '/:id', 'manage.detail')
    expect(() => assertPageDirectories(root)).not.toThrow()
  })

  it('自述注释里提到的 path 与 key 不算声明', () => {
    compliantManageSlot()
    write(
      'src/manage/menu.ts',
      MENU.replace("label: 'manage.overview',", "label: 'manage.overview',\n    // key: '/nowhere',"),
    )
    expect(() => assertPageDirectories(root)).not.toThrow()
  })
})
