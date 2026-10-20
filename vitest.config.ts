import { defineConfig } from 'vitest/config'

/** 纯逻辑单测：只跑 `src` 下的 `*.test.ts`，环境为 node。 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
