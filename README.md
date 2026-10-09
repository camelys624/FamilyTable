# 家常（FamilyTable）

家庭菜单微信小程序及 CloudBase 后端。产品围绕家庭数据隔离，支持从微信登录、创建家庭，到维护菜谱、安排周菜单和生成购物清单的家庭用餐协作流程。

- 仓库：<https://github.com/camelys624/FamilyTable>
- 小程序名称：家常
- 工程类型：微信小程序 + CloudBase 云函数
- 用户界面语言：中文

## 当前状态

当前仓库处于本地演示与 CloudBase 迁移并行阶段：

- 小程序页面已包含登录引导、首页、周菜单、菜谱库、投票、购物和个人中心等页面。
- `auth`、`family`、`recipe`、`menu` 四个 CloudBase 云函数已经纳入仓库。
- `session`、`recipe`、`menu` 模块同时提供 local/cloud 适配器，运行时根据 `repositoryMode` 选择数据路径。
- 当前 `miniprogram/config/environments.ts` 的 `activeStage` 为 `test`，对应 cloud 模式；发布前必须重新确认目标环境。
- 投票、购物清单、饮食偏好等页面和后端契约属于产品范围，但对应的完整云端函数仍在逐步迁移中。
- 菜谱编辑页支持从操作步骤生成 AI 食材整理建议；确认后新增食材默认标记为“用完”，原有“用完 / 有剩”状态保留，不要求填写用量。建议不会修改步骤，点击保存才提交。

## 功能范围

### 已有页面

- 微信登录和首次使用引导
- 家庭首页与当前家庭信息
- 菜谱列表、搜索、详情、新增、编辑和删除
- 周菜单查询、添加菜品和移除菜品
- 投票页面
- 购物清单页面
- 个人资料和饮食偏好页面

### 后端能力

当前已实现的云函数及主要动作：

| 云函数 | 主要动作 |
| --- | --- |
| `auth` | `auth.login`、`auth.updateProfile` |
| `family` | `family.current`、`family.create` |
| `recipe` | `recipe.list`、`recipe.detail`、`recipe.create`、`recipe.update`、`recipe.delete` |
| `menu` | `menu.week`、`menu.addRecipe`、`menu.removeRecipe` |

云函数采用 `index.js`、`handler.js`、`repository.js` 分层：入口负责 CloudBase 上下文，handler 负责协议、身份和参数校验，repository 负责数据库访问与事务。

## 技术栈

- 微信小程序原生页面：WXML、WXSS、TypeScript
- 运行时代码：提交编译后的 CommonJS `.js` 文件
- 服务端：Node.js CommonJS 云函数、`wx-server-sdk`
- 数据库：CloudBase 数据库
- 测试：Node.js 内置 `node:test`，不依赖根目录 `package.json`
- 配置校验：Node.js 脚本
- 数据库索引：版本化清单 `cloudbase/indexes.json`

## 项目结构

```text
.
├── miniprogram/                 # 微信小程序前端
│   ├── pages/                   # 页面与页面逻辑
│   ├── modules/                 # session、recipe、menu 模块及适配器
│   ├── repositories/            # CloudBase 客户端适配层
│   ├── services/                # 本地演示状态与种子数据
│   ├── config/                  # dev/test/prod 环境配置
│   ├── models/                  # 页面和领域类型
│   └── utils/                   # 错误、日期、requestId 等工具
├── cloudfunctions/              # CloudBase 云函数
│   ├── auth/
│   ├── family/
│   ├── recipe/
│   └── menu/
├── cloudbase/
│   ├── indexes.json             # 11 个集合及索引的声明清单
│   └── README.md                # CloudBase 初始化说明
├── scripts/cloudbase/           # 环境与索引校验脚本
├── tests/                       # 云函数 handler 与小程序导航测试
├── docs/                        # 产品和后端实施基线
├── project.config.json          # 微信开发者工具项目配置
├── project.private.config.json  # 本地开发者工具配置
└── tsconfig.json                # 小程序 TypeScript 配置
```

## 开始使用

### 前置条件

1. 安装 Node.js，用于运行测试和校验脚本。
2. 安装微信开发者工具。
3. 准备微信小程序 AppID 和 CloudBase 开发、测试、生产环境。
4. 具备对应 CloudBase 数据库、云函数和索引的操作权限。

根目录没有 `package.json` 和 npm scripts；测试、校验和编译命令直接运行。

### 用微信开发者工具打开

1. 用微信开发者工具打开仓库根目录。
2. 在 `project.config.json` 中确认 `appid`，不要使用 `touristappid` 连接正式 CloudBase。
3. 确认项目配置中的目录：
   - `miniprogramRoot`: `miniprogram/`
   - `cloudfunctionRoot`: `cloudfunctions/`
4. 微信开发者工具会根据 `useCompilerPlugins: ["typescript"]` 编译小程序 TypeScript。

### 配置运行环境

编辑 `miniprogram/config/environments.ts`：

- `dev`：`local` repository，适合本地演示和可重置数据。
- `test`：`cloud` repository，适合联调、回归和验收。
- `prod`：必须使用 `cloud` repository。

切换 `activeStage` 前确认对应的 `cloudEnvId`。环境 ID 可以进入小程序包，但 AppSecret、服务账号凭据和数据库管理密钥不得写入代码、配置文件或日志。

AI 食材整理通过 OpenAI 兼容接口调用。`recipe` 云函数需要配置 `AI_API_KEY`、`AI_BASE_URL` 和 `AI_MODEL`;其中 `AI_BASE_URL` 必须使用 HTTPS。腾讯混元可使用 `https://api.hunyuan.cloud.tencent.com/v1` 作为基础地址。详细说明见 [`docs/AI食材识别设计.md`](docs/AI食材识别设计.md)。

### 初始化 CloudBase

首次接入或切换环境时，按以下顺序执行：

1. 使用正式 AppID 打开项目并确认微信基础库支持 CloudBase。
2. 创建相互隔离的 `dev`、`test`、`prod` CloudBase 环境。
3. 根据 `cloudbase/indexes.json` 创建 11 个集合和索引，集合权限设置为客户端不可直接读写。
4. 在 `miniprogram/config/environments.ts` 填写目标环境 ID，并切换 `activeStage`。
5. 在微信开发者工具中按 `auth`、`family`、`recipe`、`menu` 顺序上传并部署云函数，并选择云端安装依赖。
6. 在 `dev` 或 `test` 环境验证登录、创建家庭、菜谱操作、周菜单操作、重复 `requestId` 和版本冲突行为。

更完整的初始化顺序见 [`cloudbase/README.md`](cloudbase/README.md)。

## 测试与校验

运行单个云函数测试：

```bash
node --test tests/cloudfunctions/session-handlers.test.js
```

运行小程序启动导航测试：

```bash
node --test tests/miniprogram/startup-navigation.test.js
```

运行全部测试：

```bash
node --test tests/**/*.test.js
```

运行发布前配置校验：

```bash
node scripts/cloudbase/verify-runtime-config.js
node scripts/cloudbase/verify-index-spec.js
```

小程序测试加载已提交的页面 `.js` 文件，因为微信运行时实际执行的是编译后的 JavaScript。修改 TypeScript 后必须同步生成并提交对应的 `.js` 文件。

## TypeScript 编译注意事项

微信开发者工具可以负责日常编译。若需要在开发者工具外生成编译产物，使用固定的 TypeScript 5.x，并覆盖仓库默认的模块输出配置：

```bash
npx -p typescript@5.9 tsc -p tsconfig.json --module commonjs --moduleResolution node \
  --rootDir miniprogram --outDir /tmp/out
```

生成后只复制本次实际修改的文件。不要只提交 `.ts` 而遗漏对应的 `.js`；运行时加载 `.js`，两者必须在同一提交中保持一致。

云函数是手写的 CommonJS JavaScript，不经过小程序 TypeScript 编译流程。若需要在本地安装云函数依赖，可分别进入各函数目录执行 `npm install`；部署时优先使用微信开发者工具的“上传并部署：云端安装依赖”。

## 架构约定

```text
微信小程序页面
    │
    ▼
页面服务 / 模块
    │
    ▼
Repository 接口
    ├── Local adapter  ── wx.setStorageSync 本地演示状态
    └── Cloud adapter  ── wx.cloud.callFunction
                                │
                                ▼
                    Cloud function handler / repository
                                │
                                ▼
                         CloudBase 数据库
```

关键约定：

- 页面不直接访问 CloudBase 数据库，只通过模块或 Repository 接口。
- 云函数从服务端上下文取得 OpenID，不信任客户端传入的身份字段。
- 家庭资源每次请求都重新验证有效成员关系，服务端负责家庭归属、时间和审计字段。
- 写操作必须携带有效 `requestId`，重试不能制造重复资源或重复副作用。
- Cloud 模式请求失败时不得静默回退到本地种子数据。
- 生产环境禁止使用 local repository。

## 重要文档

- [`CLAUDE.md`](CLAUDE.md)：仓库协作约束、架构现状和开发命令。
- [`docs/家庭菜单微信小程序技术文档.md`](docs/家庭菜单微信小程序技术文档.md)：产品范围、页面行为和发布要求。
- [`docs/后端服务与数据库实施计划.md`](docs/后端服务与数据库实施计划.md)：CloudBase 数据模型、云函数契约、权限、事务和迁移基线。
- [`cloudbase/indexes.json`](cloudbase/indexes.json)：数据库集合和索引的版本化声明。
- [`cloudbase/README.md`](cloudbase/README.md)：CloudBase 环境初始化和部署顺序。
- [`docs/AI食材识别设计.md`](docs/AI食材识别设计.md)：AI 食材整理的交互、云端契约和验收约定。

## 发布前检查清单

- [ ] `project.config.json` 使用目标小程序 AppID。
- [ ] `activeStage` 和 `cloudEnvId` 指向正确环境。
- [ ] `prod` profile 使用 `repositoryMode: 'cloud'`。
- [ ] 未将 AppSecret、服务账号凭据或数据库管理密钥写入仓库。
- [ ] `node scripts/cloudbase/verify-runtime-config.js` 通过。
- [ ] `node scripts/cloudbase/verify-index-spec.js` 通过。
- [ ] 目标 CloudBase 环境已按 `indexes.json` 创建集合和索引。
- [ ] 云函数已上传并部署，且云端依赖已安装。
- [ ] 测试通过并在微信开发者工具中完成预览验证。
- [ ] TypeScript 与对应的编译 `.js` 文件已同步提交。
