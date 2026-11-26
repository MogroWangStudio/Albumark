# Albumark 智能体工作参考

> 本文件供 AI 智能体快速了解项目现状与工作约定，只写「当前功能介绍 +
> 架构 + 约定」，不写变更历史（变更看 CHANGELOG.md，面向用户的功能
> 详情看 README.md）。

## 项目概览

**Albumark**——轻量、本地优先的图像批量水印与快速辑录工具。当前版本
**2.0.0-beta13**（2026-11-27）。

- 前端：Vue 3 + TypeScript + Vite（Composition API + Pinia）
- 桌面端：Tauri 2（Rust，`src-tauri/`）
- 安卓端：Capacitor（`android/`）
- 纯本地运行：无后端服务，数据全部落盘在用户自己的工作目录

## 目录结构速查

| 路径 | 职责 |
| --- | --- |
| `src/core/` | 平台无关纯逻辑：`fs`（文件系统抽象，桌面 plugin-fs / 安卓 Capacitor / 浏览器无能力三态；含 `dirSize` 递归体积统计）、`platform`（平台判定 / 窗口背景与 reveal）、`archive`（ZIP 流式打包与解包，fflate）、`imageFormat`（按魔数识别 JPG/PNG）、`bg`（背景水印四处同源）、`layout`（水印锚点 / 包围盒 / 命中测试 / 选中框手柄的唯一几何入口）、`storageReport`（数据目录占用扫描）、`watermarkFile`（水印模板 zip 打包 / 解析）、`updater`（更新检查/下载/暂停续传）、`storage` / `format` / `viewmotion` / `longpress` 等工具 |
| `src/i18n/` | 界面国际化：`types`（Locale / 语言注册表 / 系统语言探测）、`index`（`useI18n` / `t`，键=中文原文）、`messages/{en,ja,ko}/<域>.ts`（按域拆分的三语词条） |
| `src/stores/` | Pinia 状态：`workspace`（目录/项目/两级页导航/多选批量）、`watermark`（图层与模板）、`images`、`settings`（主题/更新渠道）、`updater`（全局更新状态机：检查/下载/暂停/读秒安装/弹窗开合）、`history`（撤销重做）、`export`、`templates`、`ctxMenu`、`toast` 等 |
| `src/components/` | 页面与业务组件：`WorkspacePage`（工作目录⇄工作项目两级页）、`PreviewCanvas`、`WatermarkPanel`、`SettingsPage`、`UpdateDialog`（软件更新 / 版本回退弹窗）、`VersionListDialog`（全部版本列表与升降级确认）、`AppTitleBar`（自绘窗控）；`ui/` 通用件（AppButton / AppDialog / AppSlider / AppDropdown / EmojiPicker…） |
| `src/workers/` | `render.worker.ts`：底图解码 + 调节的 Worker 合成 |
| `src-tauri/src/` | Rust 侧：`update.rs` / `relaunch.rs`（下载后退出替换安装包）、`move_to_trash` 回收站命令 |
| `android/` | Capacitor 工程；版本号在 `android/app/build.gradle` |

## 功能模块一句话索引

1. **工作目录与工作项目**：两级页结构（目录页 ⇄ 项目页，推入/弹出过渡、
   容器高度平滑渐变）；多目录、目录/项目 emoji 图标与简介（编辑信息）；
   多选批量操作（点选 + 桌面框选，复制/移动/导出/删除）；项目导入导出
   （ZIP 流式，不整包驻留内存）；删除走回收站（桌面系统回收站 / 安卓
   应用内回收站）；两页各带**搜索过滤**，目录行与项目卡支持**桌面右键菜单**
   （与 ⋯ 下拉同源）；**占用体积显示**（`refreshStats` 异步扫描，设置可关）；
   工作项目卡片支持**缩略图 / 纯净**两种样式与**列数 / 高度 / 圆角**设置
2. **批量导入**：拖入/整文件夹递归/图片链接导入；JPG/PNG 按文件头魔数
   识别；EXIF 摘要提取；「复制 / 链接」两种入库方式可在同一项目共存
   （链接方式带 SHA-256 识别码；失联重定位支持单张选文件与按文件夹
   同名匹配批量确认——`RelinkDialog.vue`，识别码预校验三态展示）
3. **水印工作室**：独立页面，图层式（文本/图像/EXIF 令牌），锚点三种参照
   （当前图片九宫格 / 其他水印联动 / 自由百分比坐标，可在预览点选），
   **有背景水印时锚点坐标系是照片矩形，随外扩 / 画幅比例贴住照片**；
   像素距离定位，原地复制图层，平铺整图，**测试画幅 16:9 / 9:16 / 1:1 / 4:5 /
   3:2 / 自定义长宽**（cover 裁切样张），**可载入自己的测试图片**并按当前
   画幅 cover 裁切（可恢复内置样张），按工作项目隔离，内置模板 7 个，
   面板与工作室均可保存自制模板；模板库支持 **zip 单文件导入 / 导出**
   （描述文件 `albumark-watermark.json` + 水印数据 `watermark.json` + `assets/`），
   卡片与编辑页头都有显式导出入口；选中水印显示**四角缩放 / 顶部旋转手柄**
4. **快速辑录 + 预览画布**：Worker 分层渲染、切图保持缩放、方向键切图、
   自定义右键菜单（`core/longpress.ts` + `stores/ctxMenu.ts`）、性能档位；
   水印 / 边框 / 背景照片几何按「原图尺度」换算，缩放补渲不改变构图
   （详见下方几何约定）；进出裁剪页保持缩放与位置；失联照片渲染区占位
   （`PreviewCanvas.vue` 的 missing-view，relink 事件由 App.vue 的
   relinkOne 处理）
5. **操作面板与导出**：水印/调节/裁剪/导出四页签；导出范围自选（全部
   选择/取消全选/框选弹窗 `ExportPickDialog.vue`——拖框相交 + Shift 连续
   选段）、预计大小实算、JPG 保留 EXIF
6. **设置与通用**：**语言**（侧边栏第一位；简体中文 / English / 日本語 /
   한국어，首次按系统语言）· 九款主题（含跟随系统）· 启动动画 · 显示字体 ·
   **默认缩放**（首次查看图片，100% = 适应窗口）· **放大平移安全区**
   （0–200 px，数值越大放大后可平移范围越大，0 为最多贴边）· 预览质量 ·
   **工作项目卡片**（缩略图 / 纯净样式、列数 / 高度 / 圆角）·
   **显示文件大小**（工作区体积扫描开关）·
   **数据存储分析**（桌面：总量 / 分类 / 逐目录逐项目占用，只扫含
   albumark.json 的项目文件夹）· 自动更新（stable/beta 渠道，GitHub Releases
   检查 + 下载 + 暂停续传 + 速度显示 + 代理线路切换测速；检查到新版本自动弹出
   更新弹窗，集中展示更新日志与下载进度，下载中切走设置页在后台继续）；
   **版本列表**（`VersionListDialog.vue`）列出全部 Release（含预发布），可就地
   更新或降级，降级在行内二次确认并强警告不可回滚。侧边栏「水印」分组
   （原「水印与导入」）管理水印吸附与 EXIF 缺失提醒

## 工作约定（重要）

- **版本号同步 6 处**：`package.json`、`src/core/version.ts`、
  `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、
  `src-tauri/Cargo.lock`（仅 albumark 包一行）、`android/app/build.gradle`
  （versionName + versionCode；2.0.0-beta13 = versionCode 28，每版 +1）。
  版本声明升到 X 后，本对话内所有改动都归属该版本
- **不本地构建**：vite build / cargo / gradle 都不做；静态验证用
  `npm run typecheck`（vue-tsc）；调试/验证可启动 dev 服务器
  （如 `npx vite --port 5201`），浏览器端无文件系统能力时可在 index.html
  临时注入 `window.Capacitor` mock 验证沙箱分支（验证后删除，勿提交）
- **更新链路命名对齐四项**（动 updater/relaunch/release.yml 前必查）：
  1. 打包名 `Albumark_{版本}_{平台架构}.zip` 对应前端 `templateAssetName()`
     兜底；
  2. 预发布判定「tag 含 `-`」前端过滤与 CI 一致；
  3. zip 内文件名固定 Albumark.exe/.dmg/.apk；beta2 及更早是裸 dmg / exe / apk，
     `downloadUpdate` 按 zip 魔数分流，不要改回一律解压；
  4. 客户端认领以 Release 实际产物名为准（抓 expanded_assets 片段解析），
     不要退回硬拼模板
- **预览几何基准（动渲染几何前必读）**：水印 offset、边框宽度、背景照片的
  offsetX/Y 与 radius 都是**原图尺度像素**。预览会先降采样解码再交给 Worker，
  所以换算系数必须是 `pxScale = scale（到解码位图）× sourceScale（解码 ÷ 原图）`；
  `renderPreview` 已把 sourceScale 放进 `RenderJob`，预览端用
  `resultPhoto.size.w / resultPhoto.nativeW` 求同一个系数（裁剪页用
  `resultMap.w / 旋转包围盒原生宽`）。禁止退回 `resultPhoto.renderScale`
  （只到解码位图）或直接用 `scale`——缩放补渲、或换成原图尺寸不同的照片时，
  会表现为背景照片圆角 / 位移与水印偏移漂移，导出对不上
- **版本号比较用 `compareVersions`**（`core/updater.ts`）：预发布标识符按
  字母 / 数字自然切段，数字段按数值比较，`beta10 > beta9`；不要再写整段
  字典序比较（会判反）。版本列表排序、`isNewer` 与降级判定共用这一份
- **版本列表数据源**：`listReleases()` 优先 GitHub REST（一次取全，含资产），
  失败退回 `releases.atom`（仅最近十条）；选中版本用 `releaseToUpdateInfo()`
  解析资产，下载安装仍走 `downloadUpdate` / `installStagedUpdate`——降级
  只是多一层确认与警告，不要另写安装链路
- **UI 改动调用 kill-ai-slop 与 apple-design 两个 skill**：项目是克制的
  单强调色系统（品牌橙 #FFA72F），新 UI 沿用现有 token（`--dur-hover` /
  `--ease-soft` 等，见 `src/styles/tokens.css`，CSS 变量 43 个全在用）；
  kill-ai-slop 基线为 5 组 33 hits，复扫不新增即通过
- **自定义锚点几何（动水印定位前必读）**：`core/layout.ts` 的 `layerAnchor`
  是锚点解析的唯一入口；`measureLayer` / `layerPivot` 多了一个 `layers` 参数，
  用于解析「绑定其他水印」的父级包围盒。父级按自身旋转后的包围盒九宫格点
  定位，子级随父级移动 / 旋转；父级缺失或链接成环时退回自身九宫格。
  **有背景水印时水印坐标系是照片矩形**（`photoX/Y/W/H`），不是整幅画布：
  `paintComposed` / 导出 Worker 都在 translate 到照片矩形后 `drawLayers`；
  预览叠加层、工作室（`wmSpace`）与命中 / 拖动 / 吸附都换算到照片坐标，
  背景外扩不应改变水印锚点。预览必须传 `resolvedLayers()` 的令牌解析副本，
  否则父级文字尺寸与绘制不一致；自由坐标存 `anchorX/Y` 百分比，像素偏移
  仍是原图尺度。**拖动钳制基准是整幅合成画布**（`-region.x .. resultMap.w -
  region.x`），有背景时水印允许拖到照片之外；**选中框手柄**统一由
  `layerHandles(box, rotateDist)` 生成，预览用 DOM 手柄、工作室画在样张上，
  缩放按到框中心距离比、旋转按角度差，松手取整
- **切换查看照片不自动选中水印**：`setEditContext()` 只切换编辑上下文并把
  `selectedId` 置空；自动选中第一个图层只发生在显式操作（启用独立水印、
  应用模板、切项目等）
- **水印模板 zip 文件**：`core/watermarkFile.ts`——单个普通 `.zip`，内含
  `albumark-watermark.json`（描述文件，导入识别的唯一依据：format / version /
  name / createdAt / data / assets）、`watermark.json`（水印数据 layers）与
  `assets/` 原始图片 / SVG。打包 / 解析必须经 `sanitize` 类校验（路径不以
  assets/ 开头、含 ..、解压总量上限）；导入只认描述文件，**不再读取 `.amwm`
  或裸 manifest.json**。导入走 `templates.importTemplate`，会重映射素材 id
  （全局素材表按 id 共用，同名不同内容会互相顶掉），卡片体积直接用打包字节数
- **界面国际化**：文案以中文原文为键，缺翻译自动回落，绝不出现裸键名。
  组件里 `import { useI18n } from '@/i18n'; const { t } = useI18n()`，模板
  `{{ t('中文') }}`；store/core 用 `import { t } from '@/i18n'`。带变量写成
  `t('…{0}…', x)` 并把同样的键补进 `messages/{en,ja,ko}/<域>.ts`。新增文案
  必须先接线再补三语；语言偏好存 `settings.locale`，实际值是
  `src/i18n/locale.ts` 的共享 `currentLocale` ref（settings 写入、i18n/core 只读，
  避免 settings → platform → i18n → settings 的循环依赖），`applyLocale` 同步
  `<html lang>`。主题 / 启动款式 / 画质 / 更新通道等常量里的 label 保持
  中文，渲染处再 `t(label)`
- **两级页过渡的实现要点**（`WorkspacePage.vue` 的 `wsp-push`/`wsp-pop`）：
  离场页 absolute 化依赖 `.card.grow.subpage.wsp-*-leave-active` 的
  高优先级选择器——卡片自身的 `relative` 是框选覆盖层的定位基准，勿删；
  容器高度过渡钩子挂在 `enter`（Vue Transition 先卸后插，`before-leave`
  时新页还不在 DOM）；位移幅度不得超过 `.ws-page` 的 24px padding
  （transform 溢出会计入滚动区域）；**切换工作目录必须先 `await ws.useDir`
  （项目扫描完成）再 `gotoSubPage('projects')`**——否则新页用上一目录的
  项目数撑高度，扫描结果随后突变，正好砸在高度过渡收尾上（项目数不同时
  那一下卡顿的根因）；扫描期间忽略重复点击并只在被点行显示转圈
- **更新链路实现要点**：更新状态机在 `stores/updater.ts` 全局常驻（设置页
  是 v-if 覆盖页，局部状态会让下载与读秒安装随切页丢失）；更新弹窗
  `UpdateDialog.vue` 与版本列表 `VersionListDialog.vue` 都挂在 App.vue 全局层；
  检查到新版本自动弹出更新弹窗，动作（下载/暂停/继续/取消/安装）收敛在弹窗内，
  设置页只留检查入口、状态摘要、「版本列表…」与「查看更新…」重开入口；
  列表选中目标版本后由 `selectRelease` 关列表、开更新弹窗（先中止旧下载并
  丢弃断点），降级只改变标题 / 文案与警告，不复用另一套执行路径
- **性能红线**：全屏页（设置页等）卡片禁止大面积 `backdrop-filter`——
  卡片底下只有纯色背景，毛玻璃没有内容可透却要全量采样合成，叠加入场
  动画每帧重采样，WebView2 上就是切页瞬间的掉帧来源（设置页卡片已改
  `--surface-solid` 实色）；小面积悬浮胶囊（如水印工作室顶栏）不受限；
  持久化写盘一律走 `core/storage.ts` 的防抖保存器，禁止在 watch /
  watchEffect 里直接同步 localStorage
- **平台判定**：`isCapacitor` 必须用 `Capacitor.isNativePlatform()`
  （`core/platform.ts`），不能只看 `window.Capacitor` 是否存在——`@capacitor/core`
  在浏览器里也会注册该全局（platform = web），误判会让更新链路认领 APK、
  导出 / 设置出现安卓专属入口
- **安全基线**：更新资产下载域白名单见 `core/updater.ts` 的
  TRUSTED_ASSET_HOSTS（github.com / objects.githubusercontent.com），
  新增检查源时同步维护；zip 解包必须过 sanitizeEntry（zip-slip 防御）；
  CSP 当前为 null——发版前建议收紧（需真机回归验证）
- **设置页是分栏结构**：左侧 nav 页面列表 + 右侧各组 v-show 内容
  （SettingsPage.vue 的 navSections / activeSection）；分组顺序为
  **语言 → 外观 → 预览 → 水印 → 数据（仅桌面）→ 关于**。新增设置分组时
  同步更新 navSections 与模板 v-show；选中语言用 --accent-soft + accent
  文字（与 AppTabs 一致），窄屏 ≤640px 折叠为顶部横滑页签
- **设置项说明用 ui/SettingInfo**：ⓘ 图标放主标题右侧，**默认不透明度 100**
  （不再靠悬停浮现），标题行用 inline-flex 与文字垂直居中；悬停图标弹说明
  气泡，触屏常显点击切换。只有「说明」类文案收进按钮——动态值（数据路径 /
  版本号 / 项目主页）与状态（测速 desc-ok/err）保留常显 desc
- **字体清单先铺后扫**：设置页 / 水印面板挂载时调用 `fonts.ensureFallback()`，
  下拉首次打开就有常用字体；系统字体扫描仍由聚焦时 `ensureFonts()` 触发。
  已选字体不在清单时，下拉补一个「当前字体：…」选项，避免值匹配不到显示空白
- **启动背景的早期主题**：`index.html` 顶部内联脚本按 `albumark.settings.v1`
  的 theme（auto 按系统）把 `--bg` 写到 `<html>` 上，防首帧白闪；但窗口创建
  与 WebView 绘制前的白底只能由原生层挡：桌面 `tauri.conf` / `tauri.macos.conf`
  的窗口以 `visible:false` + `backgroundColor` 创建，`main.ts` 在 mount 后调
  `revealMainWindow()`（先 `setBackgroundColor(--bg)` 再 `show()`）；主题切换
  `applyTheme` 同步 `syncWindowBackground`。安卓 `values-night` 启动主题使用
  纯黑 splash / windowBackground。改主题底色时同步 index.html 的 BG 映射表、
  tokens.css 与桌面窗口默认底色
- **放大平移安全区**：`settings.panMargin`（0–200 px）传给 `clampPanAxis`
  的 margin；max = 溢出/2 + margin（仅放大到超出视口时生效），数值越大
  放大后能平移得越远（可把照片推到边界外），0 为最多贴边。工作区体积
  扫描在 `workspace.refreshStats` 里按需触发，设置关闭后不再碰磁盘；
  卡片布局设置（style / columns / height / radius）直接落到
  `WorkspacePage` 的 CSS 变量与内联样式
- **工作室测试画幅**：`WatermarkStudio` 的 `testW/H` 决定样张与 `wmSpace`
  （照片区域）；源样张按横 / 竖选择后用 cover 裁切，缓存按尺寸保留最近 5 份
- **默认缩放**：`settings.defaultZoom` 为百分比，100 = 适应窗口（与缩放
  档位同一语义）；只在首次查看图片（`PreviewCanvas` 的 `resetView`，由
  `lastActiveId` 守卫）应用，浏览切图保持当前缩放。默认值低于适应窗口时，
  `minZoom` 下限会随之下探到该值（否则首次视图会被安全区顶回 100%）
- **数据存储分析**：`core/storageReport.ts` 只递归含 `albumark.json` 的项目
  文件夹，工作目录里的其他子目录一律跳过（防止把用户自己的资料算进占用）；
  软件数据根只统计顶层文件；`StorageReport.vue` 进入数据分组才扫描，
  可重新统计。并发 16 个目录、单文件 stat，超过 40000 文件标记 partial
- **commit 规范**：中文，`feat|fix: 描述（版本号）` 格式，正文分点；
  完成任务即 commit、**暂不推送**（推送由用户决定）
- **验收边界**：Tauri WebView 的 UI 用 computer-use 抓不到，真机效果
  （安卓侧滑返回、更新安装流程、release.yml 实发）由用户真机验收；
  GitHub Actions runner 标签会退役（macos-14 曾整体退役，现用 macos-15）
