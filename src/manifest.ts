/**
 * 门户模块元数据契约（module.json）的类型、常量与校验器。
 *
 * 真相源在本包：壳的注册中心（servumi-web 的 `src/registry.ts`）与各 Remote 的构建期
 * 守卫（本包的 `vite.ts` 插件与 `cli.ts`）都调用这里的同一份规则，不再各持一份同构副本。
 *
 * 本文件只读 JSON、不引入 React，也不依赖任何运行时框架，因此构建产物既能在浏览器侧被
 * 壳 bundler 打进产物，也能在 Node 里直接跑（构建期守卫与 CLI）。
 *
 * 契约变更必须同步 `docs/frontend-architecture.md` 与 ADR-0007，不得只改一边。
 */

/**
 * 门户接受的 module.json 契约版本；缺失或不支持的版本阻断装配。
 * 3 起 module.json 增加 version / minShellVersion / remote，业务模块前端不再编进壳，
 * 改由注册中心下发远程描述符（见 docs/decisions/0007-portal-federation-runtime.md）。
 *
 * 版本号仍为 3，即便 3 之内又删掉了 `menus`：被删的字段是「模块自己怎么排自己的导航」，
 * 移走后旧产物（仍带 `menus`）照样能被装配，不该被阻断——升版本号的含义是「旧产物必须重发」，
 * 与本变更相反。校验器不认识的字段一律忽略，因此带与不带 `menus` 的 module.json 都通过。
 * 后来新增的可选字段 `slots` 同理：旧产物没有它，按「三端都有」兼容，故也不升版本号。
 */
export const MODULE_SCHEMA_VERSION = 3

export const MODULE_DOMAINS = ['platform', 'learning', 'knowledge', 'personal', 'organization', 'shared'] as const
export const MODULE_GROUPS = ['learn', 'record', 'org', 'system'] as const
export const MODULE_AUDIENCES = ['user', 'admin', 'both'] as const
export const PUBLIC_ACCESS_VALUES = ['none', 'read'] as const
export const PORTAL_RENDER_SLOTS = ['desktop', 'manage', 'mobile', 'publicDesktop', 'publicMobile'] as const
export const REMOTE_TYPES = ['federation'] as const

/**
 * 元数据里登记的路径前缀：module.json 的 paths 必须严格等于 `<前缀>/<id>`。
 * 这些前缀是 module.json 契约的一部分，故与校验器同源；壳的路由常量必须与之一致。
 */
export const MODULE_ROUTE_BASES = {
  desktop: '/desktop',
  manage: '/manage',
  mobile: '/mobile',
  publicDesktop: '/explore',
  publicMobile: '/mobile/explore',
} as const

export type ModuleDomain = (typeof MODULE_DOMAINS)[number]
export type ModuleGroup = (typeof MODULE_GROUPS)[number]
export type ModuleAudience = (typeof MODULE_AUDIENCES)[number]
export type PublicAccess = (typeof PUBLIC_ACCESS_VALUES)[number]
export type PortalRenderSlot = (typeof PORTAL_RENDER_SLOTS)[number]
export type RemoteType = (typeof REMOTE_TYPES)[number]

export type LocalizedText = Record<string, string>

/**
 * 门户路径；`read` 时另有公开两路径，分别在 /explore、/mobile/explore 下。
 */
export type ModulePaths = {
  desktop: string
  manage: string
  mobile: string
  publicDesktop?: string
  publicMobile?: string
}

/** 校验后的模块元数据，字段与 module.json 一一对应。 */
export type ModuleManifest = {
  schemaVersion: number
  id: string
  domain: ModuleDomain
  title: LocalizedText
  summary: LocalizedText
  group: ModuleGroup
  order: number
  apiPrefix: string
  requireAuth: boolean
  audience: ModuleAudience
  publicAccess: PublicAccess
  paths: ModulePaths
  /**
   * 本模块真有哪几端，由构建期按 `src/<端>/index.ts` 在不在推导，用来收窄 `paths` 给出的可挂点：
   * 只登记管理端的模块不该出现在使用端首页，点了也只会落到一个渲染不出的落点。
   *
   * 省缺表示「未推导」，一律按「都有」处理——旧产物没有这个字段，不能因此从各端消失。
   */
  slots?: PortalRenderSlot[]
}

/** 跨模块的唯一性累积器；每次装配必须新建一份，不能跨装配复用。 */
export type Seen = {
  ids: Set<string>
  paths: Set<string>
  apiPrefixes: Set<string>
  orders: Map<ModuleGroup, Set<number>>
}

export function newSeen(): Seen {
  return { ids: new Set(), paths: new Set(), apiPrefixes: new Set(), orders: new Map() }
}

function fail(message: string): never {
  throw new Error(`module.json 校验失败：${message}`)
}

function requireObject(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(`${where} 必须是对象`)
  }
  return raw as Record<string, unknown>
}

function requireString(raw: unknown, where: string, allowEmpty = false): string {
  if (typeof raw !== 'string' || (!allowEmpty && raw.trim() === '')) {
    fail(`${where} 必须是非空字符串`)
  }
  return raw as string
}

function requireBoolean(raw: unknown, where: string): boolean {
  if (typeof raw !== 'boolean') {
    fail(`${where} 必须是布尔值`)
  }
  return raw as boolean
}

function requireInteger(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    fail(`${where} 必须是非负整数`)
  }
  return raw as number
}

function requireEnum<T extends readonly string[]>(raw: unknown, allowed: T, where: string): T[number] {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    fail(`${where} 只能是 ${allowed.join(' / ')}，当前为 ${String(raw)}`)
  }
  return raw as T[number]
}

function requireLocalized(raw: unknown, where: string): LocalizedText {
  const text = requireObject(raw, where)
  const hasText = Object.values(text).some((value) => typeof value === 'string' && value.trim() !== '')
  if (!hasText) {
    fail(`${where} 必须至少含一条非空译文`)
  }
  return text as LocalizedText
}

/** 取一条路径并登记，路径必须等于 base/id 且全局唯一。 */
function requirePath(raw: unknown, base: string, id: string, label: string, seen: Seen): string {
  const path = requireString(raw, `模块 ${id} 的 paths.${label}`)
  const expected = `${base}/${id}`
  if (path !== expected) {
    fail(`模块 ${id} 的 paths.${label} 必须是 ${expected}，当前为 ${path}`)
  }
  if (seen.paths.has(path)) {
    fail(`路径重复：${path}`)
  }
  seen.paths.add(path)
  return path
}

/**
 * 校验 `slots`：这是「本模块真有哪几端」的正名，故每一项都必须是已知槽位、不许重复，也不许为空数组
 * （空数组等于「哪儿都不占」，而装配要求至少有一个可渲染槽位，这种自述只会在运行期变成白页）。
 */
function requireSlots(raw: unknown, where: string): PortalRenderSlot[] {
  if (!Array.isArray(raw)) {
    fail(`${where} 必须是数组`)
  }
  if (raw.length === 0) {
    fail(`${where} 不能为空：模块至少要占一个端`)
  }
  const seen = new Set<string>()
  for (const item of raw) {
    const slot = requireEnum(item, PORTAL_RENDER_SLOTS, where)
    if (seen.has(slot)) {
      fail(`${where} 里 ${slot} 重复`)
    }
    seen.add(slot)
  }
  return raw as PortalRenderSlot[]
}

/** 校验一个 module.json 原文；失败直接抛错，可用于构建期阻断。 */
export function validateManifest(raw: unknown, seen: Seen): ModuleManifest {
  const value = requireObject(raw, '模块登记')

  const id = requireString(value.id, 'id')
  if (!/^[a-z0-9-]+$/.test(id)) {
    fail(`id 只能是小写字母、数字和连字符：${id}`)
  }
  if (seen.ids.has(id)) {
    fail(`id 重复：${id}`)
  }
  seen.ids.add(id)

  if (value.schemaVersion !== MODULE_SCHEMA_VERSION) {
    fail(`模块 ${id} 的 schemaVersion 必须是 ${MODULE_SCHEMA_VERSION}，当前为 ${String(value.schemaVersion)}`)
  }

  const domain = requireEnum(value.domain, MODULE_DOMAINS, `模块 ${id} 的 domain`)
  const group = requireEnum(value.group, MODULE_GROUPS, `模块 ${id} 的 group`)
  const audience = requireEnum(value.audience, MODULE_AUDIENCES, `模块 ${id} 的 audience`)
  const publicAccess = requireEnum(value.publicAccess, PUBLIC_ACCESS_VALUES, `模块 ${id} 的 publicAccess`)
  const title = requireLocalized(value.title, `模块 ${id} 的 title`)
  const summary = requireLocalized(value.summary, `模块 ${id} 的 summary`)
  const order = requireInteger(value.order, `模块 ${id} 的 order`)
  const requireAuth = requireBoolean(value.requireAuth, `模块 ${id} 的 requireAuth`)

  const seenOrders = seen.orders.get(group) ?? new Set<number>()
  if (seenOrders.has(order)) {
    fail(`分组 ${group} 里 order ${order} 重复`)
  }
  seenOrders.add(order)
  seen.orders.set(group, seenOrders)

  const apiPrefix = requireString(value.apiPrefix, `模块 ${id} 的 apiPrefix`, true)
  if (apiPrefix !== '') {
    const expected = `/api/${id}/v1`
    if (apiPrefix !== expected) {
      fail(`模块 ${id} 的 apiPrefix 必须是 ${expected}`)
    }
    if (seen.apiPrefixes.has(apiPrefix)) {
      fail(`apiPrefix 重复：${apiPrefix}`)
    }
    seen.apiPrefixes.add(apiPrefix)
  }

  const paths = requireObject(value.paths, `模块 ${id} 的 paths`)
  const desktop = requirePath(paths.desktop, MODULE_ROUTE_BASES.desktop, id, 'desktop', seen)
  const manage = requirePath(paths.manage, MODULE_ROUTE_BASES.manage, id, 'manage', seen)
  const mobile = requirePath(paths.mobile, MODULE_ROUTE_BASES.mobile, id, 'mobile', seen)

  const slots = value.slots === undefined ? undefined : requireSlots(value.slots, `模块 ${id} 的 slots`)

  let publicDesktop: string | undefined
  let publicMobile: string | undefined
  if (publicAccess === 'read') {
    publicDesktop = requirePath(paths.publicDesktop, MODULE_ROUTE_BASES.publicDesktop, id, 'publicDesktop', seen)
    publicMobile = requirePath(paths.publicMobile, MODULE_ROUTE_BASES.publicMobile, id, 'publicMobile', seen)
  } else if (paths.publicDesktop !== undefined || paths.publicMobile !== undefined) {
    fail(`模块 ${id} 的 publicAccess 为 none 时不能登记公开路径`)
  }

  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    id,
    domain: domain as ModuleDomain,
    title,
    summary,
    group: group as ModuleGroup,
    order,
    apiPrefix,
    requireAuth,
    audience: audience as ModuleAudience,
    publicAccess,
    paths: { desktop, manage, mobile, publicDesktop, publicMobile },
    slots,
  }
}

/** 校验一组 module.json 原文，并做跨模块唯一性检查。 */
export function validateManifests(raws: unknown[]): ModuleManifest[] {
  const seen = newSeen()
  return raws.map((raw) => validateManifest(raw, seen))
}

/** 导航顺序：先按分组固定次序，再按组内 order。 */
export function compareManifests(a: ModuleManifest, b: ModuleManifest): number {
  const groupDelta = MODULE_GROUPS.indexOf(a.group) - MODULE_GROUPS.indexOf(b.group)
  return groupDelta !== 0 ? groupDelta : a.order - b.order
}

/**
 * 校验 Remote 自述里的 Federation 绑定：remote.type / remote.module / remote.scope。
 *
 * scope 必须等于构建期的 federation name，专门挡住「改了 Federation 名却漏改 scope」
 * 这类只在运行时才暴露的漂移。federation name 的唯一真相源在消费仓的 vite.config.ts。
 *
 * 只读不写：不返回重建对象，因为 module.json 里还有 version / minShellVersion / remote
 * 等由注册中心消费的字段，守卫只校验、不改写原文。
 */
export function assertRemoteBinding(raw: unknown, federationName: string): void {
  const value = requireObject(raw, '模块登记')
  const id = typeof value.id === 'string' && value.id !== '' ? value.id : '?'

  if (typeof federationName !== 'string' || federationName.trim() === '') {
    fail('缺少 federationName，无法校验 remote.scope 与之一致')
  }

  const remote = requireObject(value.remote, `模块 ${id} 的 remote`)
  requireEnum(remote.type, REMOTE_TYPES, `模块 ${id} 的 remote.type`)
  const remoteModule = requireString(remote.module, `模块 ${id} 的 remote.module`)
  if (remoteModule !== './module') {
    fail(`模块 ${id} 的 remote.module 必须是 ./module，当前为 ${remoteModule}`)
  }
  const scope = requireString(remote.scope, `模块 ${id} 的 remote.scope`)
  if (scope !== federationName) {
    fail(`模块 ${id} 的 remote.scope 必须与 vite 的 federation name 一致（${federationName}），当前为 ${scope}`)
  }
}
