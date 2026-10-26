import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readModuleManifest, resolveFederationName } from './vite.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'servumi-module-vite-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relative: string, content: string): void {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function packageSource(): string {
  return JSON.stringify(
    {
      name: 'demo-module',
      version: '0.1.0',
      servumiModule: {
        domain: 'learning',
        title: { 'zh-cn': '示例模块' },
        summary: { 'zh-cn': '示例摘要' },
        group: 'learn',
        order: 10,
      },
    },
    null,
    2,
  )
}

describe('readModuleManifest', () => {
  it('在没有 src/module.json 时也能从 package.json 推导', () => {
    write('package.json', `${packageSource()}\n`)
    write('src/manage/index.ts', 'export default {}\n')

    const manifest = readModuleManifest(root) as {
      id: string
      paths: { manage: string }
      slots: string[]
    }

    expect(manifest.id).toBe('demo-module')
    expect(manifest.paths.manage).toBe('/manage/demo-module')
    expect(manifest.slots).toEqual(['manage'])
  })
})

describe('resolveFederationName', () => {
  it('在 vite.config.ts 没写字面量时回退到 package.json 推导的 scope', () => {
    write('package.json', `${packageSource()}\n`)
    write('vite.config.ts', 'export default {}\n')

    expect(resolveFederationName(undefined, root)).toBe('servumi_demo_module')
  })
})
