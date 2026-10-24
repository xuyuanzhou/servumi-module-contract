import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertLocaleKeys, collectLocaleFinding, describeLocaleWarnings } from './locale-gate.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'servumi-locale-gate-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relative: string, content: string): void {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function writeLocale(value: unknown): void {
  write('src/locale/zh-cn.json', `${JSON.stringify(value, null, 2)}\n`)
}

/** 一个最小可用的电脑端：端入口、菜单、一页。 */
function writeDesktopPage(label: string, content = 'export default function Page() { return null }\n'): void {
  write(
    'src/desktop/index.ts',
    "import { definePages } from 'servumi-web-commons'\nexport default definePages({}, { navLabel: 'title' })\n",
  )
  write('src/desktop/menu.ts', `export default [{ key: '/', label: 'nav' }] satisfies MenuItem[]\n`)
  write('src/desktop/pages/main/router.ts', `export default { path: '/', pages: [Home] } satisfies PageGroup\n`)
  write(
    'src/desktop/pages/main/home/index.ts',
    `export default { path: '/', label: '${label}', component: () => import('./content') } satisfies PageDefinition\n`,
  )
  write('src/desktop/pages/main/home/content.tsx', content)
}

describe('collectLocaleFinding', () => {
  it('语言包与引用闭环时不报缺键', () => {
    writeLocale({ title: '标题', nav: '导航' })
    writeDesktopPage('title')

    const finding = collectLocaleFinding(root)

    expect(finding.missing).toEqual([])
    expect(() => assertLocaleKeys(finding)).not.toThrow()
  })

  it('代码写了语言包里没有的键时标为缺键，并被 assertLocaleKeys 拦下', () => {
    writeLocale({ title: '标题', nav: '导航' })
    writeDesktopPage(
      'title',
      "import { formatMessage } from 'servumi-web-commons'\nexport default () => formatMessage('missing.key')\n",
    )

    const finding = collectLocaleFinding(root)

    expect(finding.missing).toEqual(['missing.key'])
    expect(() => assertLocaleKeys(finding)).toThrow(/missing\.key/)
  })

  it('页自述的 label 与端入口的 navLabel 都算引用', () => {
    writeLocale({ title: '标题', nav: '导航' })
    writeDesktopPage('title')

    const finding = collectLocaleFinding(root)

    expect(finding.unused).toEqual([])
  })

  it('语言包里没被静态引用到的键只进 unused，不阻断', () => {
    writeLocale({ title: '标题', nav: '导航', dead: '没人用' })
    writeDesktopPage('title')

    const finding = collectLocaleFinding(root)

    expect(finding.unused).toEqual(['dead'])
    expect(() => assertLocaleKeys(finding)).not.toThrow()
    expect(describeLocaleWarnings(finding)).toContain('dead')
  })

  it('端内页面目录里的中文字面量进 hardcoded，测试文件不算', () => {
    writeLocale({ title: '标题', nav: '导航' })
    writeDesktopPage('title', 'export default () => <p>直接写的中文</p>\n')
    write('src/desktop/pages/main/home/content.test.tsx', "it('用例名里的中文', () => {})\n")

    const finding = collectLocaleFinding(root)

    expect(finding.hardcoded.map((item) => item.text)).toEqual(['直接写的中文'])
  })

  it('注释里的键与中文都不算声明', () => {
    writeLocale({ title: '标题', nav: '导航' })
    writeDesktopPage('title', "// formatMessage('commented.key')\nexport default () => null\n")

    const finding = collectLocaleFinding(root)

    expect(finding.missing).toEqual([])
    expect(finding.hardcoded).toEqual([])
  })

  it('嵌套键摊平成点分路径后与点分写法比对', () => {
    writeLocale({ title: '标题', manage: { heading: '{title} · 管理', fact: { domain: '业务域' } } })
    write(
      'src/desktop/index.ts',
      "import { definePages } from 'servumi-web-commons'\nimport { formatMessage } from 'servumi-web-commons'\nexport default definePages({}, { navLabel: 'title' })\n",
    )
    write('src/desktop/pages/main/router.ts', `export default { path: '/', pages: [Home] } satisfies PageGroup\n`)
    write(
      'src/desktop/pages/main/home/index.ts',
      `export default { path: '/', label: 'manage.heading', component: () => import('./content') } satisfies PageDefinition\n`,
    )
    write(
      'src/desktop/pages/main/home/content.tsx',
      "export default () => <p>{formatMessage('manage.fact.domain')}</p>\n",
    )

    const finding = collectLocaleFinding(root)

    expect(finding.missing).toEqual([])
    expect(finding.unused).toEqual([])
  })
})
