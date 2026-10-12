# 简约插画素材 v2

生成方式：内置 image_gen。风格改为简约线描与柔和色块，沿用深绿、浅绿、奶油白、淡黄与番茄红。

## 素材与提示词

| 图集 | 生成原图 | 完整提示词 | 运行时素材 |
| --- | --- | --- | --- |
| 冰箱与食材，3 列 × 2 行 | [原图](fridge-source-v2.png) | [提示词](fridge-prompt.md) | `miniprogram/assets/fridge/illustrations-v2.png` |
| 页面与菜品，4 列 × 3 行 | [原图](kitchen-source-v2.png) | [提示词](kitchen-prompt.md) | `miniprogram/assets/kitchen/illustrations-v2.png` |

2026-10-12 修复 iPhone 手机预览插画不显示：运行时改为 RGBA PNG，并在 `project.config.json` 的 `packOptions.include` 中显式包含两张图集，避免动态 src 被无依赖文件过滤。PNG 使用自适应过滤与最高级别无损压缩，保持图集尺寸、格子位置、透明通道和所有 RGBA 像素与之前的 WebP 一致，没有缩小尺寸或减少颜色。两张 PNG 合计 1,815,699 字节，实际预览包体积以开发者工具编译结果为准。

原有无损 WebP 归档为 [冰箱 v2](fridge-lossless-v2.webp) 和 [页面 v2](kitchen-lossless-v2.webp)，移出小程序目录，避免重复打包。最初从生成 PNG 转为无损 WebP 时，编码器只优化完全透明区域中不可见的 RGB 值，可见画面与原始生成 PNG 一致。

## 页面预览

- [冰箱](fridge-preview.jpg)
- [我的](profile-preview.jpg)
- [今天](home-preview.jpg)

## 接入与验证

- 冰箱页和公共插画组件已引用 v2 图集，各页面仍使用页面自身声明的 `kitchen-art` 组件，保留按需加载修复。
- 用户上传的菜谱照片仍优先展示，未知菜品仍使用中性菜谱簿插画。
- 原有页面布局、数据和业务操作保持不变。没有写入展示用云端数据。
- 旧版运行时图集归档为 [冰箱 v1](previous-fridge-v1.webp) 和 [页面 v1](previous-kitchen-v1.webp)，移出小程序目录以控制文件体积。
- TypeScript 编译及 82 项测试通过，测试覆盖组件依赖、图集格子映射，以及两张运行时素材的 PNG 文件签名、透明通道和强制打包规则。微信开发者工具 `auto_preview` 已成功生成并推送新预览包，实际包体积为 2,025,573 字节，小于 2 MiB；手机端显示仍需打开本次新预览验收。
