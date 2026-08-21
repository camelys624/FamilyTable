# CloudBase 初始化说明

当前仓库已包含 `auth`、`family`、`recipe`、`menu` 云函数和数据库索引清单，但不会写入任何真实 AppID、环境 ID 或密钥。

首次接入顺序：

1. 将 `project.config.json` 的 `appid` 替换为正式小程序 AppID。
2. 创建独立的 `dev`、`test`、`prod` CloudBase 环境。
3. 按 `indexes.json` 创建 11 个集合和索引，集合权限设置为客户端不可直接读写。
4. 在 `miniprogram/config/environments.ts` 中填写目标环境 ID，并把 `activeStage` 切换到 `test` 或 `prod`；生产 profile 不允许使用 local repository。
5. 将 `project.config.json` 的 `appid` 替换为正式小程序 AppID；运行时会拒绝 `touristappid` 连接 CloudBase。
6. 在微信开发者工具中按 `auth`、`family`、`recipe`、`menu` 顺序分别上传并部署，部署时安装云端依赖。
7. 先在 `dev` 或 `test` 验证首次登录、重复登录、创建家庭、菜谱新增/编辑、周菜单查询/添加/移除、重复 requestId 和版本冲突。

环境 ID 也可记录在根目录 `.env`（模板见 `.env.example`）供发布脚本读取，但小程序运行时仍需将非敏感配置编译进 `environments.ts`。AppSecret、服务账号凭据和数据库管理密钥不进入小程序配置。

索引清单是版本化的声明文件。实际控制台或 CLI 创建结果必须与其名称、唯一性、字段顺序一致。
