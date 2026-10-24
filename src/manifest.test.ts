import { describe, expect, it } from 'vitest'
import { assertRemoteBinding, MODULE_SCHEMA_VERSION, newSeen, validateManifest, validateManifests } from './manifest.js'

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    id: 'demo',
    domain: 'learning',
    title: { 'zh-cn': '示例' },
    summary: { 'zh-cn': '示例模块' },
    group: 'learn',
    order: 10,
    apiPrefix: '/api/demo/v1',
    requireAuth: true,
    audience: 'both',
    publicAccess: 'none',
    paths: { desktop: '/desktop/demo', manage: '/admin/demo', mobile: '/mobile/demo' },
    version: '0.1.0',
    minShellVersion: '0.1.0',
    remote: { type: 'federation', scope: 'servumi_demo', module: './module' },
    ...overrides,
  }
}

describe('validateManifest', () => {
  it('接受一条合规元数据，并只保留契约字段', () => {
    const manifest = validateManifest(baseManifest(), newSeen())
    expect(manifest.id).toBe('demo')
    expect(manifest.paths.desktop).toBe('/desktop/demo')
    // version / remote 属于注册中心消费的字段，不在元数据契约里，不参与重建。
    expect(manifest).not.toHaveProperty('remote')
  })

  it('拒绝与 id 不符的路径', () => {
    const raw = baseManifest({ paths: { desktop: '/desktop/other', manage: '/admin/demo', mobile: '/mobile/demo' } })
    expect(() => validateManifest(raw, newSeen())).toThrow('paths.desktop 必须是 /desktop/demo')
  })

  it('title 至少含一条非空译文，语言标签不作限定', () => {
    expect(() => validateManifest(baseManifest({ title: {} }), newSeen())).toThrow('title 必须至少含一条非空译文')
    expect(() => validateManifest(baseManifest({ title: { 'zh-cn': '   ' } }), newSeen())).toThrow(
      'title 必须至少含一条非空译文',
    )
    const withEnglish = validateManifest(baseManifest({ title: { 'en-us': 'Demo' } }), newSeen())
    expect(withEnglish.title['en-us']).toBe('Demo')
  })

  it('拒绝重复 id', () => {
    const seen = newSeen()
    validateManifest(baseManifest(), seen)
    expect(() => validateManifest(baseManifest(), seen)).toThrow('id 重复')
  })

  it('publicAccess 为 none 时不得登记公开路径', () => {
    const raw = baseManifest({
      paths: {
        desktop: '/desktop/demo',
        manage: '/admin/demo',
        mobile: '/mobile/demo',
        publicDesktop: '/explore/demo',
      },
    })
    expect(() => validateManifest(raw, newSeen())).toThrow('不能登记公开路径')
  })

  it('publicAccess 为 read 时必须补齐两条公开路径', () => {
    const raw = baseManifest({ publicAccess: 'read' })
    expect(() => validateManifest(raw, newSeen())).toThrow('paths.publicDesktop 必须是非空字符串')
  })

  it('同一分组内 order 不得重复', () => {
    const seen = newSeen()
    validateManifest(baseManifest(), seen)
    expect(() =>
      validateManifest(
        baseManifest({
          id: 'demo2',
          paths: { desktop: '/desktop/demo2', manage: '/admin/demo2', mobile: '/mobile/demo2' },
          apiPrefix: '/api/demo2/v1',
        }),
        seen,
      ),
    ).toThrow('order 10 重复')
  })

  it('slots 可省缺：旧产物没有这个字段，按三端都有兼容', () => {
    expect(validateManifest(baseManifest(), newSeen()).slots).toBeUndefined()
  })

  it('slots 收下推导结果，只认已知槽位', () => {
    expect(validateManifest(baseManifest({ slots: ['manage'] }), newSeen()).slots).toEqual(['manage'])
    expect(() => validateManifest(baseManifest({ slots: ['admin'] }), newSeen())).toThrow('只能是')
  })

  it('slots 不许重复，也不许为空', () => {
    expect(() => validateManifest(baseManifest({ slots: ['manage', 'manage'] }), newSeen())).toThrow('重复')
    expect(() => validateManifest(baseManifest({ slots: [] }), newSeen())).toThrow('至少要占一个端')
    expect(() => validateManifest(baseManifest({ slots: 'manage' }), newSeen())).toThrow('必须是数组')
  })
})

describe('validateManifests', () => {
  it('一组元数据按序校验并做跨模块查重', () => {
    const manifests = validateManifests([
      baseManifest(),
      baseManifest({
        id: 'demo2',
        order: 20,
        apiPrefix: '/api/demo2/v1',
        paths: { desktop: '/desktop/demo2', manage: '/admin/demo2', mobile: '/mobile/demo2' },
      }),
    ])
    expect(manifests.map((item) => item.id)).toEqual(['demo', 'demo2'])
  })
})

describe('assertRemoteBinding', () => {
  it('scope 必须等于 federation name', () => {
    expect(() => assertRemoteBinding(baseManifest(), 'servumi_demo')).not.toThrow()
    expect(() => assertRemoteBinding(baseManifest(), 'servumi_other')).toThrow(
      'remote.scope 必须与 vite 的 federation name 一致',
    )
  })

  it('remote.module 必须是 ./module', () => {
    const raw = baseManifest({ remote: { type: 'federation', scope: 'servumi_demo', module: './entry' } })
    expect(() => assertRemoteBinding(raw, 'servumi_demo')).toThrow('remote.module 必须是 ./module')
  })
})
