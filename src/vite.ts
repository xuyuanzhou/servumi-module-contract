/**
 * Remote 仓的模块元数据构建期门禁：Vite 插件 + 从 vite.config.ts 读 federation name。
 *
 * 门户壳不再编译业务模块，壳侧的元数据守卫随之下线，元数据改由各 Remote 自证：
 * 构建前先校验本仓的模块元数据（真相源 package.json#servumiModule），不合规就抛错停下，避免元数据漂了却照常发版。
 * 规则只有这一份（`manifest.ts`），与壳侧注册中心共用。
 *
 * 本文件不依赖 vite：插件对象按结构体返回，消费方装不装 vite 都能引用本包。
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { createBuildManifest } from './build-manifest.js'
import { assertLocaleKeys, collectLocaleFinding, type LocaleFinding } from './locale-gate.js'
import { assertRemoteBinding, newSeen, validateManifest } from './manifest.js'
import { assertPageDirectories } from './pages.js'

const DEFAULT_PACKAGE_PATH = 'package.json'
const DEFAULT_VITE_CONFIG_PATH = 'vite.config.ts'
const FEDERATION_NAME_PATTERN = /const\s+federationName\s*=\s*["']([^"']+)["']/
const MODULE_ROUTE_BASES = {
  desktop: '/desktop',
  manage: '/admin',
  mobile: '/mobile',
  publicDesktop: '/explore',
  publicMobile: '/mobile/explore',
}
const PRIVATE_SLOTS = ['desktop', 'manage', 'mobile']
const PUBLIC_SLOTS = ['publicDesktop', 'publicMobile']
const SLOT_ENTRY_FILE = 'index.ts'

export type ModuleGuardOptions = {
  /** 构建期 federation name；必须与模块自述的 remote.scope 一致。 */
  federationName: string
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

function fromCwd(path: string, cwd: string = process.cwd()): string {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where} 必须是非空字符串`)
  }
  return value
}

function readPackageJson(
  packagePath: string = DEFAULT_PACKAGE_PATH,
  cwd: string = process.cwd(),
): Record<string, unknown> {
  return JSON.parse(readFileSync(fromCwd(packagePath, cwd), 'utf8')) as Record<string, unknown>
}

function moduleFederationName(id: string): string {
  return `servumi_${id.replaceAll('-', '_')}`
}

function hasSlotEntry(cwd: string, slot: string): boolean {
  return existsSync(resolve(cwd, 'src', slot, SLOT_ENTRY_FILE))
}

function readModuleSlots(cwd: string, publicAccess: string): string[] {
  const slots = PRIVATE_SLOTS.filter((slot) => hasSlotEntry(cwd, slot))
  if (publicAccess === 'read') {
    slots.push(...PUBLIC_SLOTS)
  }
  return slots
}

function buildDefaultPaths(id: string, publicAccess: string): Record<string, string> {
  const paths = {
    desktop: `${MODULE_ROUTE_BASES.desktop}/${id}`,
    manage: `${MODULE_ROUTE_BASES.manage}/${id}`,
    mobile: `${MODULE_ROUTE_BASES.mobile}/${id}`,
  }
  if (publicAccess === 'read') {
    return {
      ...paths,
      publicDesktop: `${MODULE_ROUTE_BASES.publicDesktop}/${id}`,
      publicMobile: `${MODULE_ROUTE_BASES.publicMobile}/${id}`,
    }
  }
  return paths
}

function buildModuleManifestFromPackage(cwd: string = process.cwd()): Record<string, unknown> {
  const packageJson = readPackageJson(DEFAULT_PACKAGE_PATH, cwd)
  const source = requireObject(packageJson.servumiModule, 'package.json 的 servumiModule')
  const id =
    typeof source.id === 'string' && source.id.trim() !== ''
      ? source.id
      : requireString(packageJson.name, 'package.json 的 name')
  const version = requireString(packageJson.version, `模块 ${id} 的 package.json version`)
  const publicAccess =
    typeof source.publicAccess === 'string' && source.publicAccess !== '' ? source.publicAccess : 'none'
  const remoteSource =
    typeof source.remote === 'object' && source.remote !== null ? (source.remote as Record<string, unknown>) : {}

  return {
    schemaVersion: 3,
    id,
    domain: source.domain,
    title: source.title,
    summary: source.summary,
    group: source.group,
    order: source.order,
    apiPrefix: typeof source.apiPrefix === 'string' ? source.apiPrefix : `/api/${id}/v1`,
    requireAuth: typeof source.requireAuth === 'boolean' ? source.requireAuth : true,
    audience: typeof source.audience === 'string' ? source.audience : 'both',
    publicAccess,
    paths: {
      ...buildDefaultPaths(id, publicAccess),
      ...(typeof source.paths === 'object' && source.paths !== null ? source.paths : {}),
    },
    slots: readModuleSlots(cwd, publicAccess),
    version,
    minShellVersion: typeof source.minShellVersion === 'string' ? source.minShellVersion : version,
    remote: {
      type: typeof remoteSource.type === 'string' ? remoteSource.type : 'federation',
      scope: typeof remoteSource.scope === 'string' ? remoteSource.scope : moduleFederationName(id),
      module: typeof remoteSource.module === 'string' ? remoteSource.module : './module',
    },
  }
}

/** 读消费仓的模块自述；真相源固定是 package.json，不再从 src/module.json 回读。 */
export function readModuleManifest(cwd: string = process.cwd()): unknown {
  return buildModuleManifestFromPackage(cwd)
}

/**
 * 从消费仓的 vite.config.ts 取出 federation name 字面量。
 * 名字的唯一真相源在 vite.config.ts；命令行与构建期插件据此比对同一个名字，不抄第三份。
 */
export function resolveFederationName(
  configPath: string = DEFAULT_VITE_CONFIG_PATH,
  cwd: string = process.cwd(),
): string {
  const absoluteConfigPath = fromCwd(configPath, cwd)
  if (existsSync(absoluteConfigPath)) {
    const source = readFileSync(absoluteConfigPath, 'utf8')
    const match = FEDERATION_NAME_PATTERN.exec(source)
    if (match) {
      return match[1]
    }
  }
  const manifest = readModuleManifest(cwd)
  const value = typeof manifest === 'object' && manifest !== null ? (manifest as Record<string, unknown>) : null
  const remote = value ? value.remote : null
  const remoteValue = typeof remote === 'object' && remote !== null ? (remote as Record<string, unknown>) : null
  const scope =
    remoteValue && typeof remoteValue.scope === 'string' && remoteValue.scope.trim() !== '' ? remoteValue.scope : null
  if (scope) {
    return scope
  }
  throw new Error('无法从 vite.config.ts 或 package.json 解析 federationName')
}

/**
 * Vite 插件：构建期校验本仓模块元数据、端内页面目录与语言包闭环，并把自述与多语言报告发到产物根。
 *
 * 校验失败直接阻断构建，避免元数据、页面登记或多语言漂了却照常发版。发出的是**原样** JSON，不是校验后的
 * 重建对象：注册中心还要从产物根取 version / minShellVersion / remote，重建会把这些字段丢掉。
 *
 * emit 出去是为了让模块自述随产物一起发布：注册中心按 <产物根>/module.json 取产品元数据，
 * 不在服务端另抄一份——同一份元数据留两个副本，就会各自漂移。产物根由 base 决定
 * （发布时是 /portal-remotes/<id>/<version>/），所以这里只写文件名，不拼路径。
 *
 * 另发一份 `locale-report.json`：缺键已在上一步阻断，这里随产物留下「未被引用」与「硬编码中文」
 * 两份清单，供发版时对照（见 `locale-gate.ts`）。
 *
 * 再发一份 `build.json` 产物自述：记下版本、时刻、提交号与实际装上的共享库版本，
 * 供排查时定位到源码快照与当时那份契约（见 `build-manifest.ts`）。
 */
export function moduleGuard({ federationName }: ModuleGuardOptions) {
  const readValidated = (): { manifest: unknown; locale: LocaleFinding } => {
    const raw = readModuleManifest()
    validateManifest(raw, newSeen())
    assertRemoteBinding(raw, federationName)
    assertPageDirectories()
    const locale = collectLocaleFinding()
    assertLocaleKeys(locale)
    return { manifest: raw, locale }
  }

  let validated: { manifest: unknown; locale: LocaleFinding } | undefined

  const asset = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

  const buildManifest = (manifest: unknown): string => {
    const value = typeof manifest === 'object' && manifest !== null ? (manifest as Record<string, unknown>) : {}
    return asset(
      createBuildManifest({
        id: typeof value.id === 'string' ? value.id : '',
        version: typeof value.version === 'string' ? value.version : '',
      }),
    )
  }

  return {
    name: 'servumi:module-guard',
    buildStart() {
      validated = readValidated()
    },
    generateBundle(this: { emitFile: EmitFile }) {
      this.emitFile({ type: 'asset', fileName: 'module.json', source: asset(validated?.manifest) })
      this.emitFile({ type: 'asset', fileName: 'locale-report.json', source: asset(validated?.locale) })
      this.emitFile({ type: 'asset', fileName: 'build.json', source: buildManifest(validated?.manifest) })
    },
    configureServer(server: DevServer) {
      // 开发服务器没有构建产物。这里按发布后的同一地址补上 /module.json，
      // 否则本地联调时注册中心取不到自述，模块会整个从清单里消失。
      server.middlewares.use('/module.json', (_request: unknown, response: DevResponse) => {
        const current = readValidated()
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(asset(current.manifest))
      })
    },
  }
}
