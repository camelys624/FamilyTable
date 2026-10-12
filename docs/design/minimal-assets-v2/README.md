# 简约插画素材 v2

生成方式：内置 image_gen。风格改为简约线描与柔和色块，沿用深绿、浅绿、奶油白、淡黄与番茄红。

## 素材与提示词

| 图集 | 生成原图 | 完整提示词 | 运行时素材 |
| --- | --- | --- | --- |
| 冰箱与食材，3 列 × 2 行 | [原图](fridge-source-v2.png) | [提示词](fridge-prompt.md) | `miniprogram/assets/fridge/illustrations-v2.webp` |
| 页面与菜品，4 列 × 3 行 | [原图](kitchen-source-v2.png) | [提示词](kitchen-prompt.md) | `miniprogram/assets/kitchen/illustrations-v2.webp` |

采用无损 WebP 编码，逐项核对可见像素 RGBA 和整个 alpha 通道与生成 PNG 一致；仅允许编码器优化完全透明区域中不可见的 RGB 值。像素尺寸和图集格子位置保持不变。

## 页面预览

- [冰箱](fridge-preview.jpg)
- [我的](profile-preview.jpg)
- [今天](home-preview.jpg)

## 接入与验证

- 冰箱页和公共插画组件已引用 v2 图集，各页面仍使用页面自身声明的 `kitchen-art` 组件，保留按需加载修复。
- 用户上传的菜谱照片仍优先展示，未知菜品仍使用中性菜谱簿插画。
- 原有页面布局、数据和业务操作保持不变。没有写入展示用云端数据。
- 旧版运行时图集归档为 [冰箱 v1](previous-fridge-v1.webp) 和 [页面 v1](previous-kitchen-v1.webp)，移出小程序目录以控制文件体积。
- TypeScript 编译及 67 项测试通过；小程序源文件总量约 1.60 MB，实际上传包大小以开发者工具结果为准。
