import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBuildManifest, resolveCommonsVersion, resolveGitSha } from './build-manifest.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'servumi-build-manifest-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relative: string, content: string): void {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

describe('resolveCommonsVersion', () => {
  it('读 node_modules 里实际装上的那一份的版本', () => {
    write(
      'node_modules/servumi-web-commons/package.json',
      JSON.stringify({ name: 'servumi-web-commons', version: '0.2.0' }),
    )

    expect(resolveCommonsVersion(root)).toBe('0.2.0')
  })

  it('没装时返回空串，不抛错', () => {
    expect(resolveCommonsVersion(root)).toBe('')
  })
})

describe('resolveGitSha', () => {
  it('不在 git 工作树里时返回空串', () => {
    expect(resolveGitSha(root)).toBe('')
  })
})

describe('createBuildManifest', () => {
  it('组装 id/version/时刻/提交号/共享库版本', () => {
    write('node_modules/servumi-web-commons/package.json', JSON.stringify({ version: '0.2.0' }))

    const manifest = createBuildManifest({
      id: 'demo-module',
      version: '0.1.0',
      cwd: root,
      builtAt: '2026-10-25T00:00:00.000Z',
    })

    expect(manifest).toEqual({
      id: 'demo-module',
      version: '0.1.0',
      builtAt: '2026-10-25T00:00:00.000Z',
      gitSha: '',
      commonsVersion: '0.2.0',
    })
  })
})
