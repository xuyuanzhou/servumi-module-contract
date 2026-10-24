/**
 * 多语言键闭环门禁：核模块内相对键（见 docs/decisions/0014）在构建前是否闭环。
 *
 * 相对键的好处是文案随模块走、换壳不改键；代价是「写了键没人接」与「接了键没人写」
 * 编译器都不管。故这里在打包前把闭环补上，核三件事：
 * - 引用缺键：代码或自述里写了键，语言包里没有 —— **挡下**，运行时会退化成把键名当文案。
 * - 未引用键：语言包里有键，代码与自述都没直白提到 —— 只提示。动态拼键（如 `error.${code}`）
 *   与共享工具间接取用（如 `error.detail`）都会落到这里，故不能当错。
 * - 硬编码中文：端内页面目录里直接写中文字面量 —— 只提示。中文只该活在语言包里，页面里该是键。
 *
 * 与 `pages.ts` 一样要摸文件系统，故只出现在构建期（本包的 `vite.ts` 插件与门禁 CLI），
 * 不进壳侧——壳不读模块源码。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PAGES_SLOTS } from './pages.js'

/** 语言包目录：`src/locale/`，一地区一份，文件名即地区码。 */
const LOCALE_DIRECTORY = 'locale'
/** 语言包文件名：小写地区码，如 `zh-cn.json`。 */
const LOCALE_FILE = /^[a-z]{2}(-[a-z0-9]+)*\.json$/
/** 取句：只认字面量首参。变量或模板拼出来的键静态核不了，故不计入引用。 */
const FORMAT_MESSAGE_REFERENCE = /formatMessage\(\s*(['"])([^'"]+)\1/g
/** 页标题键：页自述的 `label`。 */
const LABEL_REFERENCE = /(^|[\s,{])label\s*:\s*(['"])([^'"]*)\2/g
/** 端导航标题键：端入口 `definePages(..., { navLabel })`。 */
const NAV_LABEL_REFERENCE = /(^|[\s,{])navLabel\s*:\s*(['"])([^'"]*)\2/g
/** 中文字面量：注释剥离后，源码里任何一段连续汉字都算（字符串与 JSX 文本都覆盖）。 */
const CHINESE_RUN = /[\u4e00-\u9fff]+/g

export type LocaleFinding = {
  /** 写了键、语言包里没有：阻断。 */
  missing: string[]
  /** 语言包里有、静态引用里没见到：仅提示。 */
  unused: string[]
  /** 端内页面目录里直接写下的中文：仅提示。 */
  hardcoded: { file: string; text: string }[]
}

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

/** 列目录，跳过点开头的条目（编辑器与系统会放 `.DS_Store` 之类，与页面无关）。 */
function visibleEntries(dir: string): string[] {
  return readdirSync(dir).filter((name) => !name.startsWith('.'))
}

/** 去掉注释再匹配：注释里的示例键与中文都不算声明。 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 测试文件不参与：用例里的中文与键都是夹具，不是产品面。 */
function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path)
}

/** 递归收文件；`filter` 拿到的是绝对路径。 */
function collectFiles(dir: string, filter: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) {
    return out
  }
  for (const name of visibleEntries(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      collectFiles(path, filter, out)
    } else if (filter(path)) {
      out.push(path)
    }
  }
  return out
}

/** 语言包键摊平成点分路径：`{ a: { b: 'x' } }` 与 `{ 'a.b': 'x' }` 是同一个键。 */
function flattenKeys(value: unknown, prefix: string, out: Set<string>): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix !== '') {
      out.add(prefix)
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    flattenKeys(child, prefix === '' ? key : `${prefix}.${key}`, out)
  }
}

function collectDefinedKeys(root: string): Set<string> {
  const keys = new Set<string>()
  const localeDir = join(root, 'src', LOCALE_DIRECTORY)
  if (!existsSync(localeDir)) {
    return keys
  }
  for (const name of visibleEntries(localeDir)) {
    if (!LOCALE_FILE.test(name)) {
      continue
    }
    flattenKeys(JSON.parse(readText(join(localeDir, name))) as unknown, '', keys)
  }
  return keys
}

function collectReferencedKeys(root: string): Set<string> {
  const keys = new Set<string>()
  const sourceDir = join(root, 'src')
  for (const path of collectFiles(sourceDir, (item) => /\.tsx?$/.test(item) && !isTestFile(item))) {
    const source = withoutComments(readText(path))
    for (const match of source.matchAll(FORMAT_MESSAGE_REFERENCE)) {
      keys.add(match[2])
    }
  }
  // 自述里的 `label` / `navLabel` 也是键：它们不在页面代码里，另扫一份。
  for (const slot of PAGES_SLOTS) {
    const slotDir = join(sourceDir, slot)
    if (!existsSync(slotDir)) {
      continue
    }
    const entryPath = join(slotDir, 'index.ts')
    if (existsSync(entryPath)) {
      for (const match of withoutComments(readText(entryPath)).matchAll(NAV_LABEL_REFERENCE)) {
        keys.add(match[3])
      }
    }
    const menuPath = join(slotDir, 'menu.ts')
    if (existsSync(menuPath)) {
      for (const match of withoutComments(readText(menuPath)).matchAll(LABEL_REFERENCE)) {
        keys.add(match[3])
      }
    }
    for (const path of collectFiles(join(slotDir, 'pages'), (item) => /index\.tsx?$/.test(item))) {
      for (const match of withoutComments(readText(path)).matchAll(LABEL_REFERENCE)) {
        keys.add(match[3])
      }
    }
  }
  return keys
}

function collectHardcoded(root: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = []
  const sourceDir = join(root, 'src')
  for (const slot of PAGES_SLOTS) {
    const slotDir = join(sourceDir, slot)
    if (!existsSync(slotDir)) {
      continue
    }
    for (const path of collectFiles(slotDir, (item) => /\.tsx?$/.test(item) && !isTestFile(item))) {
      for (const match of withoutComments(readText(path)).matchAll(CHINESE_RUN)) {
        found.push({ file: path.slice(root.length + 1), text: match[0] })
      }
    }
  }
  return found
}

/**
 * 核本仓的语言包闭环；不抛错，只把三份清单交出去。
 * 消费方（CLI / 构建期守卫）决定哪份阻断、哪份只打印。
 */
export function collectLocaleFinding(root: string = process.cwd()): LocaleFinding {
  const defined = collectDefinedKeys(root)
  const referenced = collectReferencedKeys(root)
  return {
    missing: [...referenced].filter((key) => !defined.has(key)).sort(),
    unused: [...defined].filter((key) => !referenced.has(key)).sort(),
    hardcoded: collectHardcoded(root),
  }
}

/**
 * 缺键即阻断：写了键却没人接，运行时会退化成把键名当文案显示，必须在打包前拦下。
 */
export function assertLocaleKeys(finding: LocaleFinding): void {
  if (finding.missing.length > 0) {
    throw new Error(
      `多语言校验失败：引用了语言包里没有的键 —— ${finding.missing.join(', ')}（文案放 src/locale/<地区码>.json）`,
    )
  }
}

/** 把只提示的两份清单拼成一段告警；没有可提示的时返回空串。 */
export function describeLocaleWarnings(finding: LocaleFinding): string {
  const lines: string[] = []
  if (finding.unused.length > 0) {
    lines.push(`未被引用（可能是动态拼键或共享工具间接取用）：${finding.unused.join(', ')}`)
  }
  for (const item of finding.hardcoded) {
    lines.push(`硬编码中文（该改成键）：${item.file} —— ${item.text}`)
  }
  return lines.join('\n')
}
