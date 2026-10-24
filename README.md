# servumi-module-contract

Servumi 门户**模块元数据契约**：`module.json` 的类型、常量与校验器，以及构建期守卫插件与门禁 CLI。
壳（`servumi-web`）与各 Remote（`learn-lesson` / `learn-progress` / `learn-task` / `personal-notes` 等）
同源引用本包，不再各持一份同构副本。

运行时契约（`PortalPageProps`、`PortalRemoteModule`、请求客户端、信封等）在 `servumi-web-commons`，
不在本包；两个包各管一件事：本包管**元数据**，那个包管**运行时**。

## 导出

| 入口                            | 内容                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@servumi/module-contract`      | `MODULE_SCHEMA_VERSION` / `MODULE_DOMAINS` / `MODULE_ROUTE_BASES` 等常量，`ModuleManifest` 等类型，`validateManifest` / `validateManifests` / `compareManifests` / `assertRemoteBinding` |
| `@servumi/module-contract/vite` | `moduleGuard({ federationName })` Vite 插件、`readModuleManifest` / `resolveFederationName`                                                                                              |
| bin `servumi-module-check`      | 门禁 CLI，等价于插件在构建期做的那次校验                                                                                                                                                 |

## Remote 仓怎么用

`vite.config.ts`：

```ts
import { moduleGuard } from '@servumi/module-contract/vite'

const federationName = 'servumi_learn_task'

export default defineConfig({
  plugins: [moduleGuard({ federationName }) /* … */],
})
```

`package.json`：

```json
{
  "scripts": { "check:module": "servumi-module-check" }
}
```

插件在构建期从 `package.json` 的 `servumiModule` 推导模块自述（路径、接口前缀、公开权限、Remote 地址与
槽位按 id 与 `src/<端>/` 补齐），校验后把**原样** JSON 发到产物根 `module.json`；dev server 在
`/module.json` 补同一份内容。校验失败直接阻断构建。

## 发布与消费（公有 git 仓 + semver 标签）

本仓以独立**公有 Git 仓**发布，不依赖任何私有 npm registry。发版即打 tag：

```bash
npm run build && npm test          # 本地校验
git tag v0.1.2 && git push origin v0.1.2
```

消费仓以 npm 的 git 依赖 + semver 解析引用：

```json
{
  "dependencies": {
    "@servumi/module-contract": "git+https://github.com/xuyuanzhou/servumi-module-contract.git#semver:^0.1.0"
  }
}
```

`#semver:^0.1.0` 由 npm 按仓内 tag 解析到最高匹配版本，锁文件记录具体 commit 以保证可复现。
安装（含 CI）时 npm 会克隆本仓并就地跑 `prepare`（即 `tsc -b`）构建 `dist`，故 `dist` 不入库。
升级 = 打新 tag，消费仓重跑 `npm install`。
