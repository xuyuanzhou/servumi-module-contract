/**
 * 端内页面登记的门禁：把「每端一份自述、一张平级路由表看全树」从约定抬成机检
 * （见 docs/decisions/0013）。
 *
 * 只管端内 `src/<端>/pages/` 这一处：
 * - 形状：`pages/` 下只有一份 `router.ts`（本端唯一的自述）与平铺的页面文件 `*.tsx`；
 *   自述用 `export default [ ... ] satisfies RouterEntry[]` 声明——顶层就是平级路由表，
 *   各项自带 `path`，往下分层用 `children`。
 * - 自述：`label` 是菜单文案的**键**（字符串，不再写内联文案对象）；`component` 必须写成
 *   `() => import('./<名>')`，且 `pages/<名>.tsx` 真存在。反过来，平铺的页面文件没被自述
 *   引用也拦下——那一页永远渲染不到，属于会静默丢失的错。
 * - 地址：各层的 `path` 要是合法的 URL 段（静态词或 `:参数名`），同级之间还得互不相同——
 *   地址名写进自述后，重名不再由目录名天然挡住；顶层写空串表示模块根那一层，故只有顶层能写。
 *
 * 与 `manifest.ts` 分开，是因为这里要摸文件系统：它只出现在构建期（本包的 `vite.ts` 插件
 * 与门禁 CLI），不进壳侧——壳只读注册中心下发的描述符，不读模块源码，故本文件不对外导出。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 本端唯一的自述文件名：整个端有哪些页与分组都由它列出。 */
export const ROUTER_FILE = 'router.ts'
/** 端内页面目录名：`src/<端>/pages/`。 */
export const PAGES_DIRECTORY = 'pages'
/** 端入口文件名：这一端由它用 `definePages` 装配。 */
export const SLOT_ENTRY_FILE = 'index.ts'
/** 平铺页面文件的扩展名。 */
export const PAGE_EXTENSION = '.tsx'
/** 采用页表骨架的端；每一端各有一份自述。 */
export const PAGES_SLOTS = ['desktop', 'manage', 'mobile'] as const

export type PagesSlot = (typeof PAGES_SLOTS)[number]

/** 层级上限：顶层项 → 页组 → 子页。多一层就落进别人的子项里，树会开始难读。 */
const MAX_DEPTH = 2

/** 顶层表项的所属分组：顶层不在任何 children 数组里，故另给一个编号与它们并列比。 */
const TOP_LEVEL = -1

/** 静态段是自述里 `path` 默认的写法，只认小写单词与连字符：大写与空格会在 URL 里变成另一种拼写。 */
const STATIC_SEGMENT = /^[a-z][a-z0-9-]*$/
/** 动态段：自述里用 `:id` 表达，参数名的字符集与路由库一致。 */
const DYNAMIC_SEGMENT = /^:[\w-]+$/
/** 自述的声明方式：只认 `satisfies RouterEntry[]`，写成类型注解或裸对象都不算。 */
const SATISFIES = /satisfies\s+RouterEntry\[\]/
/** 旧写法：把文案对象直接写进 `label`。键化后不该再出现。 */
const LABEL_OBJECT = /label\s*:\s*\{/
/** 取 `component` 字段，后面的写法另行核。 */
const COMPONENT_FIELD = /component\s*:\s*/g
/** `component` 的合规写法：懒加载，且取自 `pages/` 下平铺的某个文件。 */
const LAZY_IMPORT = /^\(\s*\)\s*=>\s*import\(\s*['"]\.\/([\w.-]+?)(?:\.tsx)?['"]\s*\)/
/** 取一层的地址名，容许它写成 `path: 'a'` 或 `{ path: 'a' }`。 */
const PATH_FIELD = /(^|[\s,{])path\s*:\s*(['"])([^'"]*)\2/g

function fail(message: string): never {
  throw new Error(`页面登记校验失败：${message}`)
}

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

function isDirectory(path: string): boolean {
  return statSync(path).isDirectory()
}

/** 列目录，跳过点开头的条目（编辑器与系统会放 `.DS_Store` 之类，与页面无关）。 */
function visibleEntries(dir: string): string[] {
  return readdirSync(dir).filter((name) => !name.startsWith('.'))
}

/** 去掉注释再匹配：注释里的示例（如 `// path: ...`）不该被当成真的声明。 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 跳过一段字符串字面量，返回结束引号之后的下标。 */
function skipString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote) {
      return i + 1
    }
    i++
  }
  return i
}

type Contexts = {
  /** 每个字符位置所处的「children 数组」编号；不在任何 children 数组里为 null。 */
  groupAt: (number | null)[]
  /** children 数组的最大嵌套层数，2 即上限（页组 + 子页）。 */
  depth: number
}

/**
 * 扫一遍自述，记下每个位置落在哪一层 children 里。
 *
 * `path` 的同级唯一得知道「谁与谁同级」——这只能从 children 的嵌套看出来，故按方括号走一遍。
 * 只有紧跟在 `children:` 后的方括号算一层，泛型实参之类的方括号不进层数。
 */
function scanContexts(source: string): Contexts {
  const groupAt = new Array<number | null>(source.length).fill(null)
  const arrays: (number | null)[] = []
  const inner = (): number | null => {
    for (let i = arrays.length - 1; i >= 0; i--) {
      if (arrays[i] !== null) {
        return arrays[i]
      }
    }
    return null
  }
  let nextGroup = 0
  let depth = 0
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i)
      continue
    }
    if (ch === '[') {
      const isChildren = /children\s*:\s*$/.test(source.slice(0, i))
      arrays.push(isChildren ? nextGroup++ : null)
      depth = Math.max(depth, arrays.filter((id) => id !== null).length)
    } else if (ch === ']') {
      arrays.pop()
    }
    groupAt[i] = inner()
    i++
  }
  return { groupAt, depth }
}

/** 校验一段地址写法：每一段要么是静态词，要么是 `:参数名`。 */
function checkSegments(value: string, where: string): void {
  const segments = value.split('/')
  if (segments.some((segment) => !STATIC_SEGMENT.test(segment) && !DYNAMIC_SEGMENT.test(segment))) {
    fail(`${where} 的 path「${value}」不合法：每段要么是小写单词与连字符，要么是 :参数名`)
  }
}

/** 核一份自述：声明方式、层级、各层地址、页面引用，缺一不可。 */
function checkSelfDescription(pagesDir: string, where: string): void {
  const source = withoutComments(readText(join(pagesDir, ROUTER_FILE)))

  if (!SATISFIES.test(source)) {
    fail(`${where} 要用 export default [ ... ] satisfies RouterEntry[] 声明：顶层是平级路由表，形状落在类型上才不至于各写各样`)
  }
  if (LABEL_OBJECT.test(source)) {
    fail(`${where} 的 label 写成了内联文案对象：label 是 i18n 的键，文案放 locale/*.json`)
  }

  const contexts = scanContexts(source)
  if (contexts.depth > MAX_DEPTH) {
    fail(`${where} 超过了三级（顶层项 → 页组 → 子页）：再深下去树就开始难读`)
  }

  // 地址段：合法与否，以及同级是否重名。同级按 children 数组编号分，顶层项同属一组
  // （编号 TOP_LEVEL），故「两个顶层项占同一段」与「同一组里重名」一样拦下。
  const taken = new Map<number, Set<string>>()
  for (const match of source.matchAll(PATH_FIELD)) {
    const value = match[3]
    const group = contexts.groupAt[match.index ?? 0]
    if (value === '') {
      // 空串表示「模块根那一层」：模块前缀本身就是它，故只有顶层写得出。往下写空等于与父级同址。
      if (group !== null) {
        fail(`${where} 里 path 写成了空串：只有顶层能写 ''（模块根那一层），再往下每层都得占一节地址`)
      }
    } else {
      checkSegments(value, where)
    }
    const peers = taken.get(group ?? TOP_LEVEL) ?? new Set<string>()
    if (peers.has(value)) {
      fail(`${where} 里同级有两个「${value || "''"}」：地址名写进自述后仍要同级唯一`)
    }
    peers.add(value)
    taken.set(group ?? TOP_LEVEL, peers)
  }

  // 页面引用：每个 component 都得指向 pages/ 下一个真实平铺的页面文件。
  const referenced = new Set<string>()
  for (const match of source.matchAll(COMPONENT_FIELD)) {
    const rest = source.slice((match.index ?? 0) + match[0].length)
    const lazy = LAZY_IMPORT.exec(rest)
    if (lazy === null) {
      fail(`${where} 的 component 要写成 () => import('./<页面名>')：页面按需到达，且取自 pages/ 下的平铺文件`)
    }
    const name = lazy[1]
    referenced.add(name)
    if (!existsSync(join(pagesDir, `${name}${PAGE_EXTENSION}`))) {
      fail(`${where} 的 component 指向 ${name}${PAGE_EXTENSION}，但 pages/ 下没有这个文件`)
    }
  }

  // 反向：平铺的页面文件都得被自述引用，否则那一页永远渲染不到。顺带锁住 pages/ 里只放这两样。
  for (const name of visibleEntries(pagesDir)) {
    if (name === ROUTER_FILE) {
      continue
    }
    if (isDirectory(join(pagesDir, name))) {
      fail(`pages/ 下不许有子目录（${name}）：页面按自述的 component 平铺为文件`)
    }
    if (!name.endsWith(PAGE_EXTENSION)) {
      fail(`pages/ 下只放 ${ROUTER_FILE} 与页面文件（${PAGE_EXTENSION}），多了 ${name}`)
    }
    if (!referenced.has(name.slice(0, -PAGE_EXTENSION.length))) {
      fail(`pages/${name} 没被 ${ROUTER_FILE} 引用：这一页永远渲染不到`)
    }
  }
}

/** 校验一个端：有端入口就得用 `definePages` 装配，且那棵树得有一份合规的自述。 */
function checkSlot(root: string, slot: PagesSlot): void {
  const entryPath = join(root, 'src', slot, SLOT_ENTRY_FILE)
  if (!existsSync(entryPath)) {
    // 本模块没有这一端，跳过——「有没有这一端」不归本门禁管。
    return
  }
  if (!readText(entryPath).includes('definePages(')) {
    fail(`src/${slot}/${SLOT_ENTRY_FILE} 没有用 definePages 装配：端入口把 pages/${ROUTER_FILE} 那一份自述交进来即可`)
  }

  const pagesDir = join(root, 'src', slot, PAGES_DIRECTORY)
  if (!existsSync(pagesDir) || !isDirectory(pagesDir)) {
    fail(`src/${slot}/${PAGES_DIRECTORY} 不存在：用了 definePages 就要有这份自述`)
  }
  if (!existsSync(join(pagesDir, ROUTER_FILE))) {
    fail(`src/${slot}/${PAGES_DIRECTORY}/${ROUTER_FILE} 不存在：本端要有一份自述列出全部页面与分组`)
  }
  checkSelfDescription(pagesDir, `src/${slot}/${PAGES_DIRECTORY}/${ROUTER_FILE}`)
}

/**
 * 校验本仓各端 `src/<端>/pages/` 的自述写法；不合规直接抛错，
 * 供构建期守卫与门禁 CLI 在打包前拦下。
 */
export function assertPageDirectories(root: string = process.cwd()): void {
  for (const slot of PAGES_SLOTS) {
    checkSlot(root, slot)
  }
}
