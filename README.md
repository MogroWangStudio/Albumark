<div align="center">

<img src="public/brand/albumark-text-logo.svg" alt="辑印 Albumark" width="320" />

**轻量 · 本地优先的图像批量水印与快速辑录工具**

v0.2.0 · Vue 3 + TypeScript + Vite · Tauri 2（桌面端）· Capacitor（安卓端）

</div>

---

辑印（Albumark）把「给一批照片加水印、做基础调整、打包交付」压缩成一条流水线：
批量导入 → 水印工作室 → 快速辑录 → 打包导出。所有图像处理都在本机的 Web Worker
里完成，**没有任何上传**，也没有账号与云端的负担。

## 功能

### 1. 批量导入
- 拖入文件或**整个文件夹**（自动递归），或用选择器批量选取；仅支持 JPG
- 从**图片链接**批量导入（桌面端走 Tauri HTTP，不受浏览器跨域限制）
- 自动提取 EXIF 摘要：机型、镜头、光圈、快门、感光度、焦距、拍摄日期、作者

### 2. 水印工作室
- **文本图层**：字体、字重、颜色、字距、行高、对齐、斜体、描边、阴影、底色条
- **图像图层**：自定义 SVG（矢量栅格化）与 PNG/JPG 贴纸，可随时替换
- **EXIF 令牌**：在文本中插入 `{机型}`、`{光圈}`、`{拍摄日期}` 等令牌，
  预览用当前照片、导出时按每张照片的实际信息逐一替换（缺失信息自动留空）
- 画布上**直接拖拽**定位，九宫格快速吸附；缩放、旋转、不透明度、混合模式
- **平铺整图**：间距可调，防裁剪盗用
- **模板**：内置「右下签名 / 全图平铺 / EXIF 参数条」，可保存自制模板
  （localStorage 持久化，下次启动自动恢复上次的配置）

### 3. 快速辑录
亮度 · 曝光 · 阴影 · 高光 · 色温 · 色调 · 晕影，七项滑杆 -100~100，
双击滑杆名称复位单项。拖动时低分辨率即时跟手预览，松手后自动高清精修。
默认应用到全部照片；对某张照片开启**单独调节**后，它使用独立参数，不再应用全局调节。

### 4. 预览画布
- PC 端**滚轮 / 触控板捏合**缩放，移动端**双指捏合**；双击在适应窗口与 250% 间切换
- 放大后可直接拖拽平移，到边界有橡皮筋回弹；放大时自动请求更高分辨率的精修渲染

### 5. 打包交付
- JPEG 质量与长边限制（原图 / 2560 / 1920 / 1280 px）
- 文件名模板：`{name}` 原名、`{index}` 序号、`{date}` 日期 + EXIF 令牌，自动去重
- 导出方式：**ZIP 压缩包**（全平台）或**文件夹直写**（桌面端），并行渲染 + 进度条

## 平台差异

| 能力 | 桌面端（Tauri 2） | 浏览器 | 安卓（Capacitor） |
| --- | --- | --- | --- |
| 批量导入文件 | ✓ | ✓ | ✓（文件选择） |
| 链接导入 | ✓ 无跨域限制 | 受目标站 CORS 限制 | 受目标站 CORS 限制 |
| 导出文件夹 | ✓ | ✗（仅 ZIP） | ✗（仅 ZIP） |
| 导出 ZIP | ✓ 另存为 | ✓ 下载 | ✓ 下载 |
| 打开导出目录 | ✓ | ✗ | ✗ |
| 状态栏 / 安全区 | — | — | ✓ 内容延伸至系统栏下，安全区自动留白 |

## 技术与架构

```
src/
├─ core/        # 引擎：exif（EXIF 解析）· tokens（令牌替换）· adjust（像素管线）
│               # layout（图层几何）· draw（水印绘制）· renderer（Worker 通道）
│               # exporter（并行导出 + ZIP）· platform（Tauri/Web 能力适配）
├─ workers/     # render.worker：单遍完成「调节 + 水印 + JPEG 编码」
├─ stores/      # Pinia：images / watermark / adjust / templates / export / settings
├─ components/  # 画布、面板与 ui/ 原子组件（无第三方 UI 框架）
└─ styles/      # 设计令牌与基础样式（单一品牌橙 #FFA72F，深浅色自适应）
```

- 图像管线零服务器：预览与导出共用同一套 Worker 渲染代码，所见即所得
- 桌面端 Rust 侧零自定义命令，仅注册官方插件（dialog / fs / http / opener）
- 运行时依赖只有 `vue` `pinia` `exifr` `fflate` `lucide-vue-next` 与 Tauri/Capacitor 官方包

## 开发

```bash
npm install
npm run dev        # 浏览器开发（http://localhost:5173）
npm run typecheck  # vue-tsc 类型检查
npm run build      # 类型检查 + 生产构建（输出 dist/）
```

### 桌面端（Tauri 2，需要 Rust 工具链）

```bash
cargo tauri dev    # 或：npm run tauri dev
cargo tauri build  # 产出安装包
```

### 安卓端（Capacitor）

`android/` 壳工程已随仓库提供（webDir 指向 `dist/`，不含任何编译产物）：

```bash
npm run build          # 先产出 Web 资源
npx cap sync android   # 同步 Web 资源与插件
npx cap open android   # 在 Android Studio 中构建运行
```

### 持续集成（GitHub Actions）

推送到 `main` 或打 `v*` 标签时自动构建，产物在 Actions 页面下载（支持手动触发）：

- **Windows x64 便携版**：单文件 exe（目标机器需系统自带的 WebView2 运行时）
- **macOS arm64**：`.dmg` 与 `.app`（未签名）
- **Android**：debug APK 可直接安装；release APK 未签名，需自行配置签名后发布

## 已知限制（v0.2.0）

- 仅支持 JPG 输入；导出为重编码 JPEG，**不回写 EXIF**（如需保留元数据请期待后续版本）
- 大体积 ZIP（数百张以上）在浏览器端会占用较多内存；桌面端后续改为流式写盘
- 安卓端原生保存到相册 / 分享、双语文案列入路线图

## 路线图

- [x] 逐图独立调节（v0.2.0 单独调节模式）
- [ ] EXIF 回写（导出保留原元数据）
- [ ] RAW / HEIC 输入
- [ ] 选区式局部应用
- [ ] 安卓原生分享与相册写入
- [ ] 桌面端流式 ZIP 写盘

---

© MogroWang Studio · 辑印 Albumark
