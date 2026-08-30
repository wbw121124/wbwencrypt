# wbwEncrypt 待办清单（plan.md）

> AES-GCM 加密箱 · Vite 模块化项目。持续更新，`[x]`=完成，`[ ]`=待办。

## 进度总览
- 骨架/核心：✅ 完成（Vite + src 模块 + 加解密核心）
- 小屏兼容 + 5 项功能：✅ 完成（未提交，与后续合并提交）
- 图标/sweetalert2/性能/滚动条：🔨 进行中

## 已完成 [x]
- [x] 小屏媒体查询（卡片单列、穿梭框适配窄屏）
- [x] 模态框 / 图片编辑器 / 画布小屏适配
- [x] 功能1：加密产物命名优化（单文件用原文件名）
- [x] 功能2：记忆密钥管理面板（列出 / 删除 / 清空）
- [x] 功能3：加密后清空待加密列表选项
- [x] 功能4：解密历史快捷键（记忆成功密钥）
- [x] 功能5：文件库条目悬停显示内容哈希
- [x] 功能6：文件库条目重命名
- [x] 界面改名：图片库 → 文件库
- [x] 功能7：文件库 localStorage 缓存（刷新恢复）
- [x] 接线 settings.js（导入 / 导出配置）到 main.js
- [x] 创建 icons.js（Lucide 开源图标集，MIT）：图标底层已就绪

## 进行中 [~]
- [~] 图标替换：表情符号 → 开源 SVG 图标
  - [x] icons.js 图标库 + `icon()` / `injectIcons()` 帮助函数
  - [x] library.js 动态图标（doc-icon、动作按钮）已替换
  - [ ] index.html 内联 emoji 替换为 `<i data-icon>` 占位
  - [ ] main.js 启动时调用 `injectIcons()` 填充
- [~] sweetalert2 替换浏览器原生弹窗
  - [x] 安装 sweetalert2
  - [x] library.js：`prompt`(重命名) → Swal 输入框
  - [ ] settings.js：`confirm`(导出配置) → Swal 确认框
  - [ ] style.css 覆盖 SweetAlert2 变量以匹配 Dark+ 主题

## 待办 [ ]（下一步）
- [ ] 图片编辑器性能修复（可引入 npm 包）
  - 饱和 / 对比 → 原生 `ctx.filter`（GPU 加速）
  - 马赛克 → 一次性 getImageData 内存操作（消除逐块调用）
  - 滑杆防抖 + 画笔 rAF 节流
- [ ] 修复弹窗过高无滚动条（`.modal` 增加 overflow-y:auto + 高度约束）
- [ ] 构建验证（`npm run build`；dev server 冒烟）
- [ ] git commit：小屏 + 功能1~7 + 导入导出配置 + 图标 + sweetalert2

## 备注
- 加密新格式 `MAGIC "WBWENC01"`，密码派生 PBKDF2 100 万次；密钥模式旧版兼容。
- StaticShield（D:\project\staticshield）仅作设计参考，不并入本项目。
