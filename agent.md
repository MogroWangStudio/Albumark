# Albumark 智能体工作参考

> 本文件供 AI 智能体快速了解项目现状与工作约定，只写「当前功能介绍 +
> 架构 + 约定」，不写变更历史（变更看 CHANGELOG.md，面向用户的功能
> 详情看 README.md）。

## 项目概览

**Albumark**——轻量、本地优先的图像批量水印与快速辑录工具。当前版本
**2.0.0-beta9**（2026-11-23）。

- 前端：Vue 3 + TypeScript + Vite（Composition API + Pinia）
- 桌面端：Tauri 2（Rust，`src-tauri/`）
- 安卓端：Capacitor（`android/`）
- 纯本地运行：无后端服务，数据全部落盘在用户自己的工作目录

## 目录结构速查

| 路径 | 职责 |
| --- | --- |
| `src/core/` | 平台无关纯逻辑：`fs`（文件系统抽象，桌面 plugin-fs / 安卓 Capacitor / 浏览器无能力三态）、`platform`（平台判定）、`archive`（ZIP 流式打包与解包，fflate）、`imageFormat`（按魔数识别 JPG/PNG）、`bg`（背景水印四处同源）、`updater`（更新检查/下载/暂停续传）、`storage` / `format` / `viewmotion` / `longpress` 等工具 |
| `src/stores/` | Pinia 状态：`workspace`（目录/项目/两级页导航/多选批量）、`watermark`（图层与模板）、`images`、`settings`（主题/更新渠道）、`updater`（全局更新状态机：检查/下载/暂停/读秒安装/弹窗开合）、`history`（撤销重做）、`export`、`templates`、`ctxMenu`、`toast` 等 |
| `src/components/` | 页面与业务组件：`WorkspacePage`（工作目录⇄工作项目两级页）、`PreviewCanvas`、`WatermarkPanel`、`SettingsPage`、`UpdateDialog`（软件更新弹窗）、`AppTitleBar`（自绘窗控）；`ui/` 通用件（AppButton / AppDialog / AppSlider / AppDropdown / EmojiPicker…） |
| `src/workers/` | `render.worker.ts`：底图解码 + 调节的 Worker 合成 |
| `src-tauri/src/` | Rust 侧：`update.rs` / `relaunch.rs`（下载后退出替换安装包）、`move_to_trash` 回收站命令 |
| `android/` | Capacitor 工程；版本号在 `android/app/build.gradle` |

## 功能模块一句话索引

1. **工作目录与工作项目**：两级页结构（目录页 ⇄ 项目页，推入/弹出过渡、
   容器高度平滑渐变）；多目录、目录/项目 emoji 图标与简介（编辑信息）；
   多选批量操作（点选 + 桌面框选，复制/移动/导出/删除）；项目导入导出
   （ZIP 流式，不整包驻留内存）；删除走回收站（桌面系统回收站 / 安卓
   应用内回收站）
2. **批量导入**：拖入/整文件夹递归/图片链接导入；JPG/PNG 按文件头魔数
   识别；EXIF 摘要提取；「复制 / 链接」两种入库方式可在同一项目共存
   （链接方式带 SHA-256 识别码，失联后可重新定位）
3. **水印工作室**：独立页面，图层式（文本/图像/EXIF 令牌），九宫格锚点
   + 像素距离定位，平铺整图，按工作项目隔离，内置模板 7 个
4. **快速辑录 + 预览画布**：Worker 分层渲染、切图保持缩放、方向键切图、
   自定义右键菜单（`core/longpress.ts` + `stores/ctxMenu.ts`）、性能档位
5. **操作面板与导出**：水印/调节/裁剪/导出四页签；导出范围自选、预计
   大小实算、JPG 保留 EXIF
6. **设置与通用**：八款主题、自动更新（stable/beta 渠道，GitHub Releases
   检查 + 下载 + 暂停续传 + 速度显示 + 代理线路切换测速；检查到新版本
   自动弹出更新弹窗，集中展示更新日志与下载进度，下载中切走设置页在
   后台继续）

## 工作约定（重要）

- **版本号同步 6 处**：`package.json`、`src/core/version.ts`、
  `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、
  `src-tauri/Cargo.lock`（仅 albumark 包一行）、`android/app/build.gradle`
  （versionName + versionCode；2.0.0-beta9 = versionCode 24，每版 +1）。
  版本声明升到 X 后，本对话内所有改动都归属该版本
- **不本地构建**：vite build / cargo / gradle 都不做；静态验证用
  `npm run typecheck`（vue-tsc）；调试/验证可启动 dev 服务器
  （如 `npx vite --port 5201`），浏览器端无文件系统能力时可在 index.html
  临时注入 `window.Capacitor` mock 验证沙箱分支（验证后删除，勿提交）
- **更新链路命名对齐四项**（动 updater/relaunch/release.yml 前必查）：
  1. 打包名 `Albumark_{版本}_{平台架构}.zip` 对应前端 `templateAssetName()`
     兜底；
  2. 预发布判定「tag 含 `-`」前端过滤与 CI 一致；
  3. zip 内文件名固定 Albumark.exe/.dmg/.apk；
  4. 客户端认领以 Release 实际产物名为准（抓 expanded_assets 片段解析），
     不要退回硬拼模板
- **UI 改动调用 kill-ai-slop 与 apple-design 两个 skill**：项目是克制的
  单强调色系统（品牌橙 #FFA72F），新 UI 沿用现有 token（`--dur-hover` /
  `--ease-soft` 等，见 `src/styles/tokens.css`，CSS 变量 43 个全在用）；
  kill-ai-slop 基线为 5 组 33 hits，复扫不新增即通过
- **两级页过渡的实现要点**（`WorkspacePage.vue` 的 `wsp-push`/`wsp-pop`）：
  离场页 absolute 化依赖 `.card.grow.subpage.wsp-*-leave-active` 的
  高优先级选择器——卡片自身的 `relative` 是框选覆盖层的定位基准，勿删；
  容器高度过渡钩子挂在 `enter`（Vue Transition 先卸后插，`before-leave`
  时新页还不在 DOM）；位移幅度不得超过 `.ws-page` 的 24px padding
  （transform 溢出会计入滚动区域）
- **更新链路实现要点**：更新状态机在 `stores/updater.ts` 全局常驻（设置页
  是 v-if 覆盖页，局部状态会让下载与读秒安装随切页丢失）；更新弹窗
  `UpdateDialog.vue` 挂在 App.vue 全局层，检查到新版本自动弹出，动作
  （下载/暂停/继续/取消/安装）收敛在弹窗内，设置页只留检查入口、状态
  摘要与「查看更新…」重开入口
- **commit 规范**：中文，`feat|fix: 描述（版本号）` 格式，正文分点；
  完成任务即 commit、**暂不推送**（推送由用户决定）
- **验收边界**：Tauri WebView 的 UI 用 computer-use 抓不到，真机效果
  （安卓侧滑返回、更新安装流程、release.yml 实发）由用户真机验收；
  GitHub Actions runner 标签会退役（macos-14 曾整体退役，现用 macos-15）
