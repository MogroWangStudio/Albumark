// en · app
const messages: Record<string, string> = {
  // App.vue
  "已跳过 {0} 个非 JPG/PNG 文件": "Skipped {0} non-JPG/PNG files",
  "选择照片": "Choose photos",
  "适应窗口": "Fit to window",
  "实际大小 100%": "Actual size 100%",
  "收起操作面板": "Hide control panel",
  "展开操作面板": "Show control panel",
  "导入照片…": "Import photos…",
  "套用预设「{0}」": "Apply preset \"{0}\"",
  "已将「{0}」套用到这张照片": "Applied \"{0}\" to this photo",
  "设为当前照片": "Set as current photo",
  "重新定位源文件…": "Relink source file…",
  "从项目中移除": "Remove from project",
  "定位原文件": "Locate original file",
  "再侧滑一次退出应用": "Swipe back once more to exit",
  "水印": "Watermark",
  "调节": "Adjust",
  "裁剪": "Crop",
  "导出": "Export",
  "收起面板": "Hide panel",
  "展开面板": "Show panel",

  // AppTitleBar.vue
  "水印工作室的草稿不进入撤销历史":
    "Watermark Studio drafts are not tracked in undo history",
  "撤销{0}（{1}Z）": "Undo {0} ({1}Z)",
  "没有可撤销的操作": "Nothing to undo",
  "重做{0}（{1}⇧Z）": "Redo {0} ({1}⇧Z)",
  "没有可重做的操作": "Nothing to redo",
  "本次会话": "This session",
  "工作区": "Workspace",
  "撤销与重做": "Undo and redo",
  "撤销": "Undo",
  "重做": "Redo",
  "主工具": "Main tools",
  "导入图片": "Import images",
  "先进入工作区后才能导入": "Open a workspace before importing",
  "水印工作室": "Watermark Studio",
  "设置": "Settings",
  "第 5 张底片，往往是最好的一张": "The fifth frame is often the best one",
  "连点五次的手速，适合去按快门": "That five-click speed belongs on a shutter button",
  "水印已盖好，今日辑录顺利": "Watermark stamped — may today's editing go smoothly",
  "胶片会褪色，水印不会": "Film fades; watermarks don't",
  "暗房灯已亮，慢慢冲": "Darkroom light is on — take your time developing",
  "方寸虽小，皆有印记": "Small frame, lasting mark",

  // UpdateDialog.vue
  "版本回退": "Roll back version",
  "软件更新": "Software update",
  "这是降级安装：旧版本会覆盖当前版本，且不会自动回滚。项目数据与设置可能已被新版本改写，旧版本未必能完整读取，可能出现不可逆的 bug——建议先备份工作目录。":
    "This is a downgrade: the older version will overwrite the current one and cannot be rolled back automatically. Project data and settings may already have been rewritten by the newer version, so the older version may not read them correctly and irreversible bugs are possible — back up your working directory first.",
  "安卓系统不允许覆盖安装更低版本，需先卸载当前应用，本地应用数据会一并清除。":
    "Android does not allow installing a lower version over the current one. Uninstall the app first; local app data will be erased.",
  "更新内容": "What's new",
  "本次更新没有附更新说明。": "No release notes for this update.",
  "立即重启安装": "Restart and install now",
  "稍后": "Later",
  "暂停": "Pause",
  "取消": "Cancel",
  "继续下载": "Resume download",
  "下载并降级": "Download and downgrade",
  "立即更新": "Update now",
  "发布页": "Release page",
  "打开发布页": "Open release page",
  "本平台暂无自动更新包，请前往发布页手动下载":
    "No automatic update package for this platform — download it manually from the release page",
  "尚未检查更新。": "No update check has run yet.",

  // VersionListDialog.vue
  "版本列表": "Version list",
  "当前 v{0}": "Current v{0}",
  "{0} 个已发布版本": "Published versions: {0}",
  "正在读取版本列表…": "Loading versions…",
  "版本列表读取失败，可能是网络或接口限流。":
    "Failed to load the version list — the network or API rate limit may be the cause.",
  "重试": "Retry",
  "暂无已发布版本。": "No published versions yet.",
  "当前": "Current",
  "预发布": "Pre-release",
  "最新": "Latest",
  "正在使用": "In use",
  "更新": "Update",
  "降级": "Downgrade",
  "降级到 v{0}？": "Downgrade to v{0}?",
  "降级会用旧版本覆盖当前安装，且不会自动回滚。项目数据与设置可能已被新版本改写，旧版本未必能完整读取，可能出现不可逆的 bug——请先备份工作目录。":
    "A downgrade overwrites the current installation with the older version and cannot be rolled back automatically. Project data and settings may already have been rewritten by the newer version, so the older version may not read them correctly and irreversible bugs are possible — back up your working directory first.",
  "安卓系统不允许覆盖安装更低版本：确认后需先卸载当前应用，本地应用数据会一并清除。":
    "Android does not allow installing a lower version over the current one: after confirming, uninstall the app first; local app data will be erased.",
  "仍要降级": "Downgrade anyway",
  "该版本没有附更新说明。": "No release notes for this version.",

  // stores/updater.ts
  "无法获取该版本的安装包信息，请前往发布页手动下载":
    "Could not get the installer details for this version — download it manually from the release page",
  "更新失败：{0}": "Update failed: {0}",
  "请稍后重试，或前往下载页手动获取":
    "Try again later or download it manually from the release page",
  "安装失败：{0}": "Installation failed: {0}",
  "请重试，或前往下载页手动获取": "Try again or download it manually from the release page",
  "下载中…": "Downloading…",
  "下载 {0}% · {1}": "Downloading {0}% · {1}",
  "下载 {0}%": "Downloading {0}%",
  "下载已暂停": "Download paused",
  "已暂停 · 已下载 {0}%": "Paused · {0}% downloaded",
  "{0} 秒后自动重启安装": "Restarting to install in {0}s",

  // core/updater.ts
  "该版本暂无适配当前平台的安装包，请前往发布页手动下载":
    "No package for this platform is available for this version — download it manually from the release page",
  "没有适配当前平台的更新包，请前往下载页手动获取":
    "No update package matches this platform — get it manually from the release page",
  "更新包解析失败，请重新下载或前往下载页手动获取":
    "Could not parse the update package — download it again or get it manually from the release page",
  "更新包内容为空，请重新下载或前往下载页手动获取":
    "The update package is empty — download it again or get it manually from the release page",
  "更新包格式无法识别，请前往下载页手动获取":
    "Unrecognized update package format — get it manually from the release page",
  "无法定位程序目录": "Could not locate the program directory",
  "无法定位数据目录": "Could not locate the data directory",
  "已交给系统安装，按提示完成更新":
    "Handed off to the system installer — follow the prompts to finish",
  "更新包已就绪": "Update package ready",
}

export default messages
