# 更新日志

本项目的全部重要变更都会记录在此文件中。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- GitHub Actions 自动构建（推送到 main 或打 `v*` 标签触发，支持手动触发）：
  - Windows x64 便携版（单文件 exe，跳过安装器）
  - macOS arm64（.dmg 与 .app）
  - Android APK（debug 可直接安装；release 未签名）

### 变更

- 应用标识统一为 `com.mws.albumark`（Tauri identifier / Capacitor appId / Android
  applicationId 与 namespace），Android `versionName` 对齐为 0.1.0

## [0.1.0] - 2026-09-18

首个公开版本。

### 新增

- **批量导入**：拖拽（含文件夹递归）/ 选择器 / 图片链接三种方式，仅支持 JPG；
  自动提取 EXIF 摘要（机型、镜头、光圈、快门、感光度、焦距、拍摄日期、作者）
- **水印工作室**：
  - 文本图层（字体 / 字重 / 颜色 / 字距 / 行高 / 对齐 / 斜体 / 描边 / 阴影 / 底色条）
  - 图像图层，支持自定义 SVG（矢量栅格化）与 PNG / JPG 贴纸，可替换
  - EXIF 令牌系统，导出时按每张照片逐一解析替换
  - 画布直接拖拽 + 九宫格定位 + 缩放 / 旋转 / 不透明度 / 混合模式
  - 平铺整图模式（间距可调）
  - 模板系统：内置「右下签名 / 全图平铺 / EXIF 参数条」，支持自制模板持久化
- **快速辑录**：亮度、曝光、阴影、高光、色温、色调、晕影七项调节，
  低分辨率即时预览 + 高清精修
- **打包交付**：JPEG 质量与长边限制、文件名模板与自动去重、
  ZIP 压缩包（全平台）/ 文件夹直写（桌面端）、并行渲染与进度展示
- 技术底座：Vue 3 + TypeScript + Vite；Web Worker 单遍渲染管线；
  Tauri 2 桌面脚手架（官方插件，零自定义 Rust 命令）；Capacitor 8 安卓壳工程；
  深浅色自适应 UI，唯一品牌橙 `#FFA72F`

### 已知限制

- 导出不回写 EXIF；不支持 RAW / HEIC 输入；水印与调节为全局配置
