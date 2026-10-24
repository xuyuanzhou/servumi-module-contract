/**
 * 端内页面登记的门禁：把「页与地址一份自述、菜单另一份自述」从约定抬成机检
 * （见 docs/decisions/0013）。
 *
 * 只管端内 `src/<端>/` 这一处，核三件事：
 * - 形状：`pages/<组>/router.ts` 是组的自述，`pages/<组>/<页>/{index.ts,content.tsx}` 是页的自述
 *   与内容，`menu.ts` 是菜单。目录只管归类——地址由自述显式写出，故目录怎么摆都不影响 URL。
 * - 地址：组前缀与页段拼成页的完整地址，本端内不得有两条自述落到同一地址上——重了会让后写的那条
 *   被静默顶掉，页还在、永远打不开。
 * - 菜单：`key` 就是模块内地址，故每个 key 都得在路由树上找得到；没有子项的那一项还得落在**有页面**
 *   的地址上，否则点下去只空转。至少留一个这样的落点，兜底才有的可落。
 *
 * 与 `manifest.ts` 分开，是因为这里要摸文件系统：它只出现在构建期（本包的 `vite.ts` 插件
 * 与门禁 CLI），不进壳侧——壳只读注册中心下发的描述符，不读模块源码，故本文件不对外导出。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 组的自述文件名：`pages/<组>/router.ts` 给出组前缀与页清单。 */
export const ROUTER_FILE = 'router.ts'
/** 菜单自述文件名：`src/<端>/menu.ts`，与路由树分开的另一棵自述树。 */
export const MENU_FILE = 'menu.ts'
/** 端内页面组目录名：`src/<端>/pages/`。 */
export const PAGES_DIRECTORY = 'pages'
/** 端入口文件名：这一端由它用 `definePages` 装配。 */
export const SLOT_ENTRY_FILE = 'index.ts'
/** 页自述文件名：`pages/<组>/<页>/index.ts`。 */
export const PAGE_ENTRY_FILE = 'index.ts'
/** 页内容文件名；页自述的 `component` 指向它。 */
export const PAGE_CONTENT_FILE = 'content.tsx'
/** `component` 里该写的模块名。 */
const PAGE_CONTENT_MODULE = 'content'
/** 采用页表骨架的端；每一端各有一份组自述与一份菜单自述。 */
export const PAGES_SLOTS = ['desktop', 'manage', 'mobile'] as const

export type PagesSlot = (typeof PAGES_SLOTS)[number]

/** 静态段是自述里 `path` 默认的写法，只认小写单词与连字符：大写与空格会在 URL 里变成另一种拼写。 */
const STATIC_SEGMENT = /^[a-z][a-z0-9-]*$/
/** 动态段：自述里用 `:id` 表达，参数名的字符集与路由库一致。 */
const DYNAMIC_SEGMENT = /^:[\w-]+$/
/** 自述的声明方式：只认 `satisfies <形状>`，写成类型注解或裸对象都不算。 */
const SATISFIES_GROUP = /satisfies\s+PageGroup\b/
const SATISFIES_PAGE = /satisfies\s+PageDefinition\b/
const SATISFIES_MENU = /satisfies\s+MenuItem\[\]/
/** 自述都得是默认导出：消费方按默认导入取用。 */
const EXPORT_DEFAULT = /export\s+default/
/** 旧写法：把文案对象直接写进 `label`。键化后不该再出现。 */
const LABEL_OBJECT = /label\s*:\s*\{/
/** 组前缀与页段，写法都只此一处。 */
const PATH_FIELD = /(^|[\s,{])path\s*:\s*(['"])([^'"]*)\2/
/** 页标题的键。 */
const LABEL_FIELD = /(^|[\s,{])label\s*:\s*(['"])([^'"]*)\2/
/** 页自述的 `component` 写法：懒加载，且取自同目录的 `content`。 */
const COMPONENT_FIELD = /component\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]\.\/([\w.-]+?)['"]\s*\)/
/** 组的 `pages` 清单；项是文件顶部导入进来的标识符。 */
const PAGES_FIELD = /pages\s*:\s*\[([^\]]*)\]/
/** 组自述顶部的默认导入：`import <标识符> from './<页目录名>'`。 */
const IMPORT_DEFAULT = /import\s+(\w+)\s+from\s+['"]\.\/([\w.-]+?)['"]/g
/** 菜单里没有嵌套对象的那一层：即没有子项的菜单项。 */
const INNERMOST_OBJECT = /\{[^{}]*\}/g
/** 菜单项的 `key`。逐个取用（非全局）与整体遍历（全局）各留一个，免得 `exec` 前进 lastIndex。 */
const KEY_FIELD = /(^|[\s,{])key\s*:\s*(['"])([^'"]*)\2/
const KEY_FIELD_ALL = /(^|[\s,{])key\s*:\s*(['"])([^'"]*)\2/g
/** 页内样式文件的扩展名；页目录允许约定之外的样式文件。 */
const STYLE_EXTENSION = /\.(scss|css)$/

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

/** 自述地址归一成模块内地址：前导斜杠与重复斜杠都吃掉，`/` 因此归一到空串（不占地址段）。 */
function addressOf(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .join('/')
}

/** 拼模块内地址；空串表示「停在这一层」，不产生新的一段。 */
function joinAddress(prefix: string, segment: string): string {
  if (segment === '') {
    return prefix
  }
  return prefix === '' ? segment : `${prefix}/${segment}`
}

/** 空地址在报错里写成模块根，免得读的人看到一个空白引号。 */
function display(address: string): string {
  return address === '' ? '（模块根）' : address
}

/** 校验一段地址写法：每一段要么是静态词，要么是 `:参数名`。 */
function checkSegments(value: string, where: string): void {
  const segments = value.split('/').filter((segment) => segment !== '')
  if (segments.some((segment) => !STATIC_SEGMENT.test(segment) && !DYNAMIC_SEGMENT.test(segment))) {
    fail(`${where} 的 path「${value}」不合法：每段要么是小写单词与连字符，要么是 :参数名`)
  }
}

/** 一份自述的公共约束：默认导出，且形状落在 `satisfies` 上。 */
function checkDeclaration(source: string, shape: RegExp, shapeName: string, where: string): void {
  if (!EXPORT_DEFAULT.test(source)) {
    fail(`${where} 要写成 export default：自述由消费方按默认导入取用`)
  }
  if (!shape.test(source)) {
    fail(`${where} 要用 satisfies ${shapeName} 声明：形状落在类型上才不至于各写各样`)
  }
}

/** 核一页：页目录里该有的文件、自述的地址与文案键、内容的默认导出。返回归一后的页段。 */
function readPage(groupDir: string, name: string, where: string): string {
  const dir = join(groupDir, name)
  if (!existsSync(dir) || !isDirectory(dir)) {
    fail(`${where} 引用了 ./${name}，但 ${name} 不是目录：页自述与内容都放在以页名命名的目录里`)
  }

  const names = visibleEntries(dir)
  for (const entry of names) {
    if (entry === PAGE_ENTRY_FILE || entry === PAGE_CONTENT_FILE || STYLE_EXTENSION.test(entry)) {
      continue
    }
    fail(
      `${where} 的 ${name}/ 里多了 ${entry}：页目录只放 ${PAGE_ENTRY_FILE} 与 ${PAGE_CONTENT_FILE}（可另有样式文件）`,
    )
  }

  const contentPath = join(dir, PAGE_CONTENT_FILE)
  if (!existsSync(contentPath)) {
    fail(`${where} 的 ${name}/ 缺 ${PAGE_CONTENT_FILE}：页自述的 component 指向它`)
  }
  if (!EXPORT_DEFAULT.test(readText(contentPath))) {
    fail(`${where} 的 ${name}/${PAGE_CONTENT_FILE} 没有默认导出：懒加载按默认导入取页面组件`)
  }

  const entryPath = join(dir, PAGE_ENTRY_FILE)
  if (!existsSync(entryPath)) {
    fail(`${where} 的 ${name}/ 缺 ${PAGE_ENTRY_FILE}：页要有一份自述说它落在哪一段地址、叫什么`)
  }
  const source = withoutComments(readText(entryPath))
  const pageWhere = `${where} 的 ${name}/${PAGE_ENTRY_FILE}`
  checkDeclaration(source, SATISFIES_PAGE, 'PageDefinition', pageWhere)
  if (LABEL_OBJECT.test(source)) {
    fail(`${pageWhere} 的 label 写成了内联文案对象：label 是 i18n 的键，文案放 locale/*.json`)
  }
  const component = COMPONENT_FIELD.exec(source)
  if (component === null || component[1] !== PAGE_CONTENT_MODULE) {
    fail(
      `${pageWhere} 的 component 要写成 () => import('./${PAGE_CONTENT_MODULE}')：页面按需到达，且取自同目录的 ${PAGE_CONTENT_FILE}`,
    )
  }
  if (LABEL_FIELD.exec(source) === null) {
    fail(`${pageWhere} 没写 label：这是页标题的键（菜单之外的页也要用）`)
  }
  const path = PATH_FIELD.exec(source)
  if (path === null) {
    fail(`${pageWhere} 没写 path：页落在哪一段地址得显式写出来`)
  }
  checkSegments(path[3], pageWhere)
  return addressOf(path[3])
}

type GroupDeclaration = {
  /** 组前缀归一后的地址；空串表示整组不占地址段。 */
  address: string
  /** 组内各页归一后的地址。 */
  pages: { name: string; address: string }[]
}

/** 核一组：`pages/<组>/router.ts` 给出组前缀与页清单，页目录与清单得互相对上。 */
function readGroup(pagesDir: string, name: string, where: string): GroupDeclaration {
  const dir = join(pagesDir, name)
  const names = visibleEntries(dir)
  for (const entry of names) {
    if (entry === ROUTER_FILE || isDirectory(join(dir, entry))) {
      continue
    }
    fail(`${where} 的 ${name}/ 里多了 ${entry}：组目录只放 ${ROUTER_FILE} 与页目录`)
  }

  const routerPath = join(dir, ROUTER_FILE)
  if (!existsSync(routerPath)) {
    fail(`${where} 的 ${name}/ 缺 ${ROUTER_FILE}：组要说清自己的前缀与收录了哪几页`)
  }
  const source = withoutComments(readText(routerPath))
  const groupWhere = `${where} 的 ${name}/${ROUTER_FILE}`
  checkDeclaration(source, SATISFIES_GROUP, 'PageGroup', groupWhere)

  const path = PATH_FIELD.exec(source)
  if (path === null) {
    fail(`${groupWhere} 没写 path：组前缀写 '/' 表示整组不占地址段`)
  }
  checkSegments(path[3], groupWhere)
  const prefix = addressOf(path[3])

  const listed = PAGES_FIELD.exec(source)
  if (listed === null) {
    fail(`${groupWhere} 没写 pages：组要说清自己收了哪几页`)
  }
  const bindings = new Map<string, string>()
  for (const match of source.matchAll(IMPORT_DEFAULT)) {
    bindings.set(match[1], match[2])
  }

  const pages: { name: string; address: string }[] = []
  const referenced = new Set<string>()
  for (const identifier of listed[1]
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')) {
    const pageName = bindings.get(identifier)
    if (pageName === undefined) {
      fail(`${groupWhere} 的 pages 里有 ${identifier}，但它不是本文件顶部从 './<页目录名>' 默认导入进来的`)
    }
    referenced.add(pageName)
    const address = readPage(dir, pageName, groupWhere)
    pages.push({ name: pageName, address: joinAddress(prefix, address) })
  }

  // 反向：组目录下的页目录都得被 pages 收录，否则那一页永远渲染不到。
  for (const entry of names) {
    if (entry === ROUTER_FILE || !isDirectory(join(dir, entry)) || referenced.has(entry)) {
      continue
    }
    fail(`${groupWhere} 没有收录页目录 ${entry}：这一页永远渲染不到`)
  }

  return { address: prefix, pages }
}

/**
 * 登记一条地址；已登记过就拦下。
 *
 * 重名必须在这里拦：目录名不再天然挡住重名（地址写在自述里），而摊平时同一层只有一个页位，
 * 重了的那一条会被静默丢掉——页还在仓里，却永远打不开。
 */
function register(taken: Map<string, string>, address: string, from: string, where: string): void {
  const previous = taken.get(address)
  if (previous !== undefined) {
    fail(`${where} 的 ${from} 与 ${previous} 都落在地址「${display(address)}」上：同一层只能有一页`)
  }
  taken.set(address, from)
}

/** 核一个端：有端入口就得用 `definePages` 装配，且路由树与菜单两棵自述树都得合规、对得上。 */
function checkSlot(root: string, slot: PagesSlot): void {
  const entryPath = join(root, 'src', slot, SLOT_ENTRY_FILE)
  if (!existsSync(entryPath)) {
    // 本模块没有这一端，跳过——「有没有这一端」不归本门禁管。
    return
  }
  if (!readText(entryPath).includes('definePages(')) {
    fail(`src/${slot}/${SLOT_ENTRY_FILE} 没有用 definePages 装配：端入口把页面组与菜单两份自述交进来即可`)
  }

  const pagesDir = join(root, 'src', slot, PAGES_DIRECTORY)
  if (!existsSync(pagesDir) || !isDirectory(pagesDir)) {
    fail(`src/${slot}/${PAGES_DIRECTORY} 不存在：用了 definePages 就要有页面组目录`)
  }

  /** 路由树上的节点：地址 → 这一层有没有页面。纯分组的组前缀也在树上，只是没有页面。 */
  const nodes = new Map<string, boolean>()
  const taken = new Map<string, string>()
  for (const name of visibleEntries(pagesDir)) {
    if (!isDirectory(join(pagesDir, name))) {
      fail(`src/${slot}/${PAGES_DIRECTORY}/ 下只放页面组目录（${name} 是文件）：页自述改放页目录里`)
    }
    const group = readGroup(pagesDir, name, `src/${slot}/${PAGES_DIRECTORY}`)
    const own = group.pages.filter((page) => page.address === group.address)
    if (own.length > 1) {
      fail(
        `src/${slot}/${PAGES_DIRECTORY} 的 ${name}/ 组里有两页都落在「${display(group.address)}」上：同一层只能有一页`,
      )
    }
    if (own.length === 1) {
      register(taken, group.address, `${name}/ 组自己的页`, `src/${slot}/${PAGES_DIRECTORY}`)
      nodes.set(group.address, true)
    } else if (group.address !== '') {
      // 组前缀本身也是路由上的一层：它可能只是分组，故登记成「没有页面」的节点。
      register(taken, group.address, `${name}/ 组前缀`, `src/${slot}/${PAGES_DIRECTORY}`)
      nodes.set(group.address, false)
    }
    for (const page of group.pages) {
      if (page.address === group.address) {
        continue
      }
      register(taken, page.address, `${name}/${page.name}`, `src/${slot}/${PAGES_DIRECTORY}`)
      nodes.set(page.address, true)
    }
  }

  checkMenu(root, slot, nodes)
}

/**
 * 核菜单：`key` 是模块内地址，故得落在路由树上；没有子项的那一项还得落在有页面的地址上。
 */
function checkMenu(root: string, slot: PagesSlot, nodes: Map<string, boolean>): void {
  const menuPath = join(root, 'src', slot, MENU_FILE)
  if (!existsSync(menuPath)) {
    fail(`src/${slot}/${MENU_FILE} 不存在：菜单是另一棵自述树，写它才知道左菜单长什么样、怎么排`)
  }
  const menuWhere = `src/${slot}/${MENU_FILE}`
  const source = withoutComments(readText(menuPath))
  checkDeclaration(source, SATISFIES_MENU, 'MenuItem[]', menuWhere)
  if (LABEL_OBJECT.test(source)) {
    fail(`${menuWhere} 的 label 写成了内联文案对象：label 是 i18n 的键，文案放 locale/*.json`)
  }

  for (const match of source.matchAll(KEY_FIELD_ALL)) {
    if (!nodes.has(addressOf(match[3]))) {
      fail(`${menuWhere} 的 key「${match[3]}」在路由树上找不到落点：菜单项要么指向某页，要么指向某个分组`)
    }
  }

  // 没有嵌套对象的那一层就是没有子项的菜单项；它必须落在有页面的地址上，否则点下去只空转。
  let leaves = 0
  for (const object of source.matchAll(INNERMOST_OBJECT)) {
    const key = KEY_FIELD.exec(object[0])
    if (key === null) {
      continue
    }
    const address = addressOf(key[3])
    if (nodes.get(address) !== true) {
      fail(`${menuWhere} 的菜单项「${key[3]}」没有子项，指向的却不是有页面的地址：点下去不会跳转`)
    }
    leaves++
  }
  if (leaves === 0) {
    fail(`${menuWhere} 里没有一个可点的页面：菜单没有落点，地址没命中时的兜底也无处可去`)
  }
}

/**
 * 校验本仓各端 `src/<端>/` 的页面登记；不合规直接抛错，
 * 供构建期守卫与门禁 CLI 在打包前拦下。
 */
export function assertPageDirectories(root: string = process.cwd()): void {
  for (const slot of PAGES_SLOTS) {
    checkSlot(root, slot)
  }
}
