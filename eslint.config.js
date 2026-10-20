// 前端规则基线：ESLint 只管语言正确性，行内格式全部交给 Prettier，
// 两者重叠的规则由 eslint-config-prettier 关闭，避免同一处报两次。
// 本包不含 React 页面，故不装 react-hooks 插件；消费方（壳与各 Remote）的副本仍保留它。
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.history'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // 相等判断必须写全，`== null` 例外：它同时判 null 与 undefined，是刻意的写法。
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // 本包在 Node 里跑（构建期插件与 CLI），globals 只给 node。
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  eslintConfigPrettier,
)
