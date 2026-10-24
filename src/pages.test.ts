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

/** 包一张平级路由表：`satisfies RouterEntry[]` 是门禁认的声明方式，故测试数据都带上它。 */
function selfDescription(rows: string[]): string {
  return [
    "import type { RouterEntry } from 'servumi-web-commons'",
    'export default [',
    ...rows,
    '] satisfies RouterEntry[]',
  ].join('\n')
}

const SLOT_ENTRY = [
  "import { definePages } from 'servumi-web-commons'",
  "import entry from './pages/router'",
  "export default definePages(entry, { navLabel: 'title' })",
].join('\n')

/** 合规的管理端自述：模块根那一页 + `registry` 分组含 `facts` / `paths` 两页。 */
const COMPLIANT = selfDescription([
  "  { path: '', label: 'manage.nav', component: () => import('./overview') },",
  '  {',
  "    path: 'registry',",
  "    label: 'manage.registry',",
  '    children: [',
  "      { path: 'facts', label: 'manage.fact', component: () => import('./facts') },",
  "      { path: 'paths', label: 'manage.path', component: () => import('./paths') },",
  '    ],',
  '  },',
])

/** 把管理端的端入口与自述一起写上；页面文件由调用方按需补。 */
function writeManage(content: string): void {
  write('src/manage/index.ts', SLOT_ENTRY)
  write('src/manage/pages/router.ts', content)
}

/** 一个合规的管理端：自述 + 它引用的三个平铺页面文件。 */
function compliantManageSlot(): void {
  writeManage(COMPLIANT)
  write('src/manage/pages/overview.tsx')
  write('src/manage/pages/facts.tsx')
  write('src/manage/pages/paths.tsx')
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
    write('src/manage/index.ts', 'export default SomePage\n')
    write('src/manage/pages/router.ts', COMPLIANT)
    write('src/manage/pages/overview.tsx')
    write('src/manage/pages/facts.tsx')
    write('src/manage/pages/paths.tsx')
    expect(() => assertPageDirectories(root)).toThrow('没有用 definePages 装配')
  })

  it('拒绝用了 definePages 却没有 pages/ 目录', () => {
    write('src/manage/index.ts', SLOT_ENTRY)
    expect(() => assertPageDirectories(root)).toThrow('pages 不存在')
  })

  it('拒绝缺自述', () => {
    write('src/manage/index.ts', SLOT_ENTRY)
    write('src/manage/pages/overview.tsx')
    expect(() => assertPageDirectories(root)).toThrow('router.ts 不存在')
  })

  it('拒绝没用 satisfies RouterEntry[] 声明的自述', () => {
    writeManage("import type { RouterEntry } from 'servumi-web-commons'\nexport default { label: 'x' } as RouterEntry\n")
    expect(() => assertPageDirectories(root)).toThrow('satisfies RouterEntry[]')
  })

  it('拒绝把 label 写成内联文案对象', () => {
    writeManage(selfDescription(["  { path: '', label: { 'zh-cn': '概览' } },"]))
    expect(() => assertPageDirectories(root)).toThrow('label 是 i18n 的键')
  })

  it('拒绝超过三级：children 再往下分两层就拦下', () => {
    writeManage(
      selfDescription([
        '  { path: "a", label: "a", children: [',
        '    { path: "g", label: "g", children: [',
        '      { path: "l", label: "l", children: [',
        '        { path: "x", label: "x" },',
        '      ] },',
        '    ] },',
        '  ] },',
      ]),
    )
    expect(() => assertPageDirectories(root)).toThrow('超过了三级')
  })

  it('拒绝 component 不是懒加载或没取自 pages/', () => {
    writeManage(selfDescription(["  { path: '', label: 'a', component: loadPage },"]))
    expect(() => assertPageDirectories(root)).toThrow("要写成 () => import('./<页面名>')")
  })

  it('拒绝 component 指向的页面文件不存在', () => {
    writeManage(selfDescription(["  { path: '', label: 'a', component: () => import('./missing') },"]))
    expect(() => assertPageDirectories(root)).toThrow('pages/ 下没有这个文件')
  })

  it('拒绝平铺页面没被自述引用', () => {
    compliantManageSlot()
    write('src/manage/pages/orphan.tsx')
    expect(() => assertPageDirectories(root)).toThrow('没被 router.ts 引用')
  })

  it('拒绝 pages/ 下夹带子目录', () => {
    compliantManageSlot()
    write('src/manage/pages/notes/readme.ts')
    expect(() => assertPageDirectories(root)).toThrow('不许有子目录')
  })

  it('拒绝 pages/ 下的散文件', () => {
    compliantManageSlot()
    write('src/manage/pages/notes.md')
    expect(() => assertPageDirectories(root)).toThrow('页面文件')
  })

  it('拒绝不合法的 path 段', () => {
    compliantManageSlot()
    writeManage(COMPLIANT.replace("path: 'registry'", "path: 'Registry'"))
    expect(() => assertPageDirectories(root)).toThrow('不合法')
  })

  it('拒绝同级两个相同的 path', () => {
    compliantManageSlot()
    writeManage(COMPLIANT.replace("path: 'paths'", "path: 'facts'"))
    expect(() => assertPageDirectories(root)).toThrow('同级有两个')
  })

  it('拒绝两个顶层项占同一段', () => {
    writeManage(
      selfDescription([
        "  { path: 'a', label: 'a', component: () => import('./overview') },",
        "  { path: 'a', label: 'b', component: () => import('./facts') },",
      ]),
    )
    write('src/manage/pages/overview.tsx')
    write('src/manage/pages/facts.tsx')
    expect(() => assertPageDirectories(root)).toThrow('同级有两个')
  })

  it('拒绝顶层之外的 path 写空串', () => {
    writeManage(
      selfDescription([
        "  { path: 'a', label: 'a', children: [",
        "    { path: '', label: 'b', component: () => import('./overview') },",
        '  ] },',
      ]),
    )
    expect(() => assertPageDirectories(root)).toThrow('只有顶层能写')
  })

  it('放行动态段地址', () => {
    compliantManageSlot()
    writeManage(COMPLIANT.replace("path: 'facts'", "path: ':id'"))
    expect(() => assertPageDirectories(root)).not.toThrow()
  })

  it('放行不同层之间的同名地址：不属于同级，不算重名', () => {
    writeManage(
      selfDescription([
        '  { path: "a", label: "a", component: () => import("./overview"), children: [',
        '    { path: "a", label: "l", component: () => import("./facts") },',
        '  ] },',
      ]),
    )
    write('src/manage/pages/overview.tsx')
    write('src/manage/pages/facts.tsx')
    expect(() => assertPageDirectories(root)).not.toThrow()
  })

  it('自述注释里提到的 path 与 component 不算声明', () => {
    compliantManageSlot()
    writeManage(COMPLIANT.replace("label: 'manage.registry',", "label: 'manage.registry',\n    // path: 'BAD',"))
    expect(() => assertPageDirectories(root)).not.toThrow()
  })
})
