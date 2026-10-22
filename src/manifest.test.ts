import { describe, expect, it } from 'vitest'
import {
  assertRemoteBinding,
  MODULE_MENU_MAX_DEPTH,
  MODULE_MENU_MAX_ITEMS,
  MODULE_SCHEMA_VERSION,
  newSeen,
  validateManifest,
  validateManifests,
} from './manifest.js'

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    id: 'demo',
    domain: 'learning',
    title: { 'zh-Hans': '示例' },
    summary: { 'zh-Hans': '示例模块' },
    group: 'learn',
    order: 10,
    apiPrefix: '/api/demo/v1',
    requireAuth: true,
    audience: 'both',
    publicAccess: 'none',
    paths: { desktop: '/desktop/demo', manage: '/admin/demo', mobile: '/mobile/demo' },
    menus: [{ key: '', label: { 'zh-Hans': '示例' } }],
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

  it('拒绝非法的菜单 key', () => {
    const raw = baseManifest({ menus: [{ key: 'Bad Key', label: { 'zh-Hans': '示例' } }] })
    expect(() => validateManifest(raw, newSeen())).toThrow('menus[0].key 只能是空串或 [a-z0-9-] 片段')
  })

  it('接受带子菜单的菜单树', () => {
    const raw = baseManifest({
      menus: [
        { key: '', label: { 'zh-Hans': '概览' } },
        {
          key: 'record',
          label: { 'zh-Hans': '记录' },
          children: [{ key: 'list', label: { 'zh-Hans': '清单' } }],
        },
      ],
    })
    const manifest = validateManifest(raw, newSeen())
    expect(manifest.menus[1].children).toEqual([{ key: 'list', label: { 'zh-Hans': '清单' } }])
  })

  it('拒绝同层重复的菜单 key', () => {
    const raw = baseManifest({
      menus: [
        { key: 'list', label: { 'zh-Hans': '清单' } },
        { key: 'list', label: { 'zh-Hans': '清单二' } },
      ],
    })
    expect(() => validateManifest(raw, newSeen())).toThrow('中 key 重复：list')
  })

  it('拒绝超过深度上限的菜单树', () => {
    const leaf = { key: 'deep3', label: { 'zh-Hans': '三层' } }
    const raw = baseManifest({
      menus: [
        {
          key: 'lv1',
          label: { 'zh-Hans': '一' },
          children: [
            {
              key: 'lv2',
              label: { 'zh-Hans': '二' },
              children: [{ key: 'lv3', label: { 'zh-Hans': '三' }, children: [leaf] }],
            },
          ],
        },
      ],
    })
    expect(() => validateManifest(raw, newSeen())).toThrow(`菜单超过 ${MODULE_MENU_MAX_DEPTH} 层`)
  })

  it('拒绝超过条数上限的菜单树', () => {
    const menus = Array.from({ length: MODULE_MENU_MAX_ITEMS + 1 }, (_, index) => ({
      key: `item-${index}`,
      label: { 'zh-Hans': `项 ${index}` },
    }))
    const raw = baseManifest({ menus })
    expect(() => validateManifest(raw, newSeen())).toThrow(`菜单总条数超过 ${MODULE_MENU_MAX_ITEMS}`)
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
