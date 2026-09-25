# AGENT.md — wbwEncrypt 项目计划与协作约定

> 本文件是项目的执行计划与 AI 协作规范。子代理开工前必须完整阅读本文件。

## 一、项目概览

AES-GCM 文件加密箱 · Vite 原生 JS 模块化项目（无框架）。部署在 GitHub Pages。

### 架构地图
| 文件 | 职责 |
|---|---|
| `index.html` | 入口，全部静态 UI 结构 |
| `src/main.js` | 装配入口：各模块 init、加密业务流 |
| `src/crypto.js` | 加密核心：MAGIC 头、PBKDF2、AES-GCM、分片、压缩、哈希 |
| `src/key.js` | 密钥获取/派生/记忆（localStorage 按文件哈希记忆） |
| `src/library.js` | 文件库穿梭框（左右列表）+ localStorage 缓存 + 重命名 |
| `src/decrypt.js` | 解密、校验、多文件预览、JSZip 批量下载 |
| `src/editor.js` | 文本/HTML 编辑器弹窗 |
| `src/imageEditor.js` | 图片编辑器（线稿/饱和/对比/马赛克/画笔） |
| `src/camera.js` | 拍照/录像 |
| `src/settings.js` | 配置导入/导出（sweetalert2） |
| `src/ui.js` | DOM/toast/模态框/拖拽工具 |
| `src/icons.js` | Lucide 开源 SVG 图标集（MIT） |
| `src/style.css` | 唯一样式源，VS Code Dark+ 主题 |
| `plan.md` | 用户可读的待办清单（收尾时更新） |

### 常用命令
```bash
npm run dev      # 开发服务器
npm run build    # 构建（每次提交前必须跑通）
npm run preview  # 预览构建产物
# 阶段一引入后新增：
npm run lint     # ESLint 检查
npm run format   # Prettier 格式化
npm test         # vitest 单元测试
```

## 二、协作铁律（所有子代理必须遵守）

1. **全程中文**：代码注释、UI 文案、提交信息、汇报全部用中文，禁止输出英文。
2. **每个提交点完成即 commit**：`git add <改动文件>` + `git commit -m "<中文提交信息>"`。禁止跨提交点打包提交。禁止 amend、禁止 force push。
3. **不 push**：除非用户明确要求，否则只 commit 不 push。
4. **提交前验证**：至少跑 `npm run build` 必须通过；引入 lint/test 后必须 `npm run lint`、`npm test` 同时通过才能提交。
5. **不引入英文 UI 文案**：界面新增文案一律中文（i18n 不在本次范围）。
6. **加密格式变更必须同步补测试**：改动 `crypto.js` 的头部/分片逻辑时，必须在 `tests/` 补对应用例。
7. **遵循既有代码风格**：Prettier 配置引入后以配置为准；此前以文件既有风格为准。注释用中文。
8. **临时文件不得入库**：`*.log`、`dev.err`、`node_modules/`、`dist/`、`*.7z` 已在 .gitignore。
9. **遇到计划外的阻塞**（如依赖装不上、格式方案冲突）：停止并汇报，不要擅自变更设计决策。
10. **完成后汇报**：每个阶段结束，用中文汇报「完成的提交点、提交哈希、验证结果、遗留问题」。

## 三、关键技术决策（不得擅自更改）

### D1 · 分片格式修复（最高优先级 bug）
- 现状：`crypto.js` 解密循环切片逻辑错误，且格式头未记录 `chunkSize`，压缩后 >8MB 的文件加密后**必然解不开**，报错误导为"密钥错误"。
- 方案：新增格式版本 `v3`，头部在 `[salt+iter]` 之后追加 4 字节 `chunkSize`（小端或与现有字段一致），分片按固定 `chunkSize` 切分，最后一片为余数。
- 解密兼容：`v3` 按头部 `chunkSize` 正确切片；`v2` 仅 `count==1` 走现有单片路径，`count>1` 抛中文错误「此文件由存在缺陷的旧版本生成，无法解密」（旧路径本就从未成功，等价于隐性失败变显性报错）。
- 同步加固：`version` 读取后必须与当前版本比对；`iterations` 必须校验（上限如 5,000,000、下限 1,000）防恶意文件卡死主线程；`keyInfo.type` 合法性校验；`chunkSize` 合法性校验。

### D2 · Web Worker 长任务
- `src/worker.js` 承载 `encryptBytes`/`decryptBytes` 全流程（哈希→压缩→分片→AES-GCM），WebCrypto 与 CompressionStream 在 Worker 内可用。
- 按分片 `postMessage` 上报进度（阶段 + 百分比 + 分片 i/n），主线程用 `worker.terminate()` 实现取消。
- **必须保留同步降级路径**：Worker 创建失败（旧浏览器/环境）时回落主线程执行，不能白屏。
- JSZip 批量打包一并移入 Worker。

### D3 · 深浅主题切换
- 顺序：localStorage 记忆 → `prefers-color-scheme` → 默认深色。
- **前置条件**：必须先完成硬编码颜色归变量，再做浅色映射，否则换肤不完整。
- 补齐语义变量：`--bg-app` `--bg-elevated` `--shadow` `--overlay` `--on-accent`。
- SweetAlert2 用其原生 `--swal2-*` 变量覆盖，尽量消除 `!important`。

### D4 · PWA
- 手写 Service Worker（预缓存 dist 资源 + 运行时缓存，约 60 行），不引入 workbox 插件。
- `manifest.webmanifest` + `theme-color` + 图标（用现有 shield 图标生成 PNG）。
- 注意 `vite.config.js` 的 `base: './'` 相对路径与 GitHub Pages 的 SW 作用域；SW 缓存必须带版本号，避免升级后用户拿到旧资源。

## 四、执行计划（18 个提交点，严格按序）

### 阶段一 · 代码质量（提交点 1–7）
| # | 内容 | 覆盖问题 |
|---|---|---|
| 1 | 修分片解密：v3 格式含 chunkSize、v2 兼容分支、version/iterations/chunkSize/keyInfo.type 输入校验 | 分片必现失败、头部无校验 |
| 2 | vitest 落地：crypto 核心 round-trip/分片/legacy/损坏检测/密码模式、library 穿梭逻辑、localStorage mock；`npm test` 脚本 | 全项目 0 测试 |
| 3 | ESLint + Prettier：flat config、lint/format 脚本，首轮清理 14 处死代码与未用导入 | 无规范工具 |
| 4 | 错误兜底：全局 `unhandledrejection`、4 处 async onclick 补 try/catch、6 处空 catch 改可见提示、clipboard 加 await、legacy 分支明确提示、解密错误带 cause | 异步无兜底、吞异常 |
| 5 | 重复逻辑收敛：`downloadBlob`、`lsGet/lsSet`、b64/随机工具复用、`isXxxType` 统一、`buttonText` 合并、blob URL 统一 revoke | 8 组重复 + 泄漏 |
| 6 | 结构拆分：加密业务流抽 `src/encryptFlow.js`；`buildBatchPayload` 与 `parseBatchPayload` 合并到 `src/payload.js`；删 `window.downloadUrl` 全局 | main.js setup 106 行超载 |
| 7 | 失效代码修复：HTML 补 `#decryptProgress` 并接入 `onProgress`；`injectIcons` 支持容器参数供 camera 动态面板调用 | 进度 no-op、相机图标空 |

### 阶段二 · 样式（提交点 8–12）
| # | 内容 | 覆盖问题 |
|---|---|---|
| 8 | 真 Bug：`.editor-modal .modal-content-editor` 改为 `.modal .modal-content-editor`（现选择器永不命中，弹窗无背景无宽度）；`.btn-outline btn-sm` 组合被覆盖失效（5 个按钮）；合并 `.card min-width` 冲突重复声明 | 样式正确性 |
| 9 | 无障碍基线：统一 `:focus-visible`；file input 由 `display:none` 改 visually-hidden（键盘可达）；三弹窗 `role="dialog"`+`aria-modal`+Esc 关闭+焦点归还；toast/进度 `aria-live`；穿梭按钮 `aria-label`；图标 `aria-hidden`；`--text-sec` 对比度提亮至 AA、微字号放大 | 全项目 0 ARIA、键盘不可达、对比度不达标 |
| 10 | 设计 token：圆角 9 档收敛为 4 档（`--r-sm/md/lg/pill`）、间距 token、20+ 处硬编码色归变量（含 HTML 行内遮罩 2 处）、删死变量 `--selection`/`--thumb-bg`、补 Firefox `scrollbar-width/scrollbar-color` | 变量体系混乱 |
| 11 | 响应式补漏：close-modal 尺寸、swal `max-width:92vw`、`#memKeyList`/`#decryptPreviewArea` 行内样式外提、textarea/预览区改 `min(300px,40vh)`、图片弹窗 padding、`prefers-reduced-motion` | 小屏遗漏 |
| 12 | 深浅主题：浅色令牌全量映射 + 页头开关激活 + 持久化 + 跟随系统（D3） | 无主题切换 |

### 阶段三 · 功能（提交点 13–18）
| # | 内容 | 覆盖问题 |
|---|---|---|
| 13 | P0 功能修复：按钮文案 `textContent→innerHTML` 修 SVG 源码乱码；解密进度真实显示；删除 SweetAlert2 确认+toast 撤销；缓存写入失败显式提示+导出备份入口；HTML 预览改 iframe `sandbox`（防注入） | 6 个体验/安全 Bug |
| 14 | 文件库增强：搜索框+类型筛选、checkbox 多选/全选/反选、补「全部左移」、多选批量右移/删除、同哈希去重提示、列表显示大小/类型 | 无检索无批量 |
| 15 | 键盘快捷键：Esc 关弹窗、Ctrl/Cmd+Enter 加密、←/→ 穿梭选中项、Ctrl+S 保存、Ctrl+F 聚焦搜索 | 无快捷键 |
| 16 | Worker 长任务：加密/解密/ZIP 入 Worker、百分比进度条（分片 i/n）、取消按钮（D2，保留同步降级） | 主线程卡死无取消 |
| 17 | PWA：manifest + SW + theme-color + 图标生成（D4），`npm run preview` 验证离线可启动 | 无离线能力 |
| 18 | 收尾：plan.md 全量更新、lint+test+build 三关全绿、dev server 冒烟、最终汇报 | 验收 |

## 五、验收标准

1. `npm run lint`、`npm test`、`npm run build` 三关全绿。
2. 分片用例：1KB / 100KB / 30MB 三档 round-trip 通过；v2 旧文件按约定行为（单片可解、多片明确报错）。
3. 两个真样式 bug 目视修复：编辑器弹窗有背景有宽度、outline 按钮描边生效。
4. 纯键盘完成：添加文件 → 穿梭 → 加密 → 解密全流程。
5. 深浅主题切换后无硬编码色残留；构建产物断网后 PWA 可启动。
6. 每个提交点独立可构建；提交信息全中文。

## 六、风险与注意

- **格式变更**（D1）会让"旧版分片文件"永远无法解密——这类文件当前本就解不开，属隐性失败转显性报错，已在 v2 分支给出明确中文提示。
- **Worker 化**必须保留同步降级，否则旧环境白屏。
- **SW 版本号**必须随构建更新，否则升级后用户卡旧缓存。
- **不改动** `.github/workflows/vite.yml` 部署逻辑，除非 PWA 需要且确认安全。
- i18n 不在本次范围：新增文案一律中文硬编码。
