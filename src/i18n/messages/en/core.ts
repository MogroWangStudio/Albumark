// en · core
const messages: Record<string, string> = {
  // 导出面板
  "导出": "Export",
  "导出范围": "Export range",
  "已选 {0} / {1} 张": "Selected {0} / {1}",
  "共 {0} 张": "{0} photos in total",
  "全部照片": "All photos",
  "自选": "Selected",
  "全部选择": "Select all",
  "取消全选": "Deselect all",
  "多个框选…": "Marquee select…",
  "尚未选择照片，点击上方缩略图勾选要导出的图片。":
    "No photos selected yet. Click the thumbnails above to choose which photos to export.",
  "图像格式": "Image format",
  "JPG（体积小）": "JPG (smaller size)",
  "PNG（无损）": "PNG (lossless)",
  "图像质量": "Image quality",
  "保留 EXIF 元数据": "Keep EXIF metadata",
  "图像长边像素": "Long edge (pixels)",
  "原图": "Original",
  "自定义": "Custom",
  "文件名模板": "File name template",
  // 文件名令牌
  "机型": "Camera model",
  "镜头": "Lens",
  "光圈": "Aperture",
  "快门": "Shutter",
  "感光度": "ISO speed",
  "焦距": "Focal length",
  "拍摄日期": "Date taken",
  "作者": "Author",
  "文件名": "File name",
  "导出方式": "Export method",
  "选择一个文件夹，照片逐张写入其中。":
    "Choose a folder; photos are written into it one by one.",
  "照片逐张写入公共 Documents/Albumark/ 下的按时间命名的文件夹。":
    "Photos are written one by one into a timestamped folder under the public Documents/Albumark/.",
  "导出完成后打开系统分享面板，选择应用直接发送，不在公共目录留副本。":
    "When the export finishes, the system share sheet opens so you can send directly; no copy stays in public folders.",
  "预计大小": "Estimated size",
  "估算中…": "Estimating…",
  "约 {0}": "About {0}",
  "开始导出": "Start export",
  "已导出 {0} 张照片。": "Exported {0} photos.",
  "已导出 {0} 张照片，{1} 张失败。": "Exported {0} photos, {1} failed.",
  "打开所在文件夹": "Show in folder",
  "完成": "Done",
  "ZIP 压缩包": "ZIP archive",
  "文件夹（逐张写入）": "Folder (one by one)",
  "分享": "Share",

  // 框选弹窗
  "框选要导出的照片": "Marquee-select photos to export",
  "拖框批量选择，或按住 Shift 点击首尾连续选段；单张点击切换勾选。":
    "Drag a box to select many, or Shift-click the first and last photo to select a continuous range; click a photo to toggle it.",
  "已选 {0} / {1}": "Selected {0} / {1}",
  "取消": "Cancel",
  "确定": "OK",

  // 工作项目 / 工作目录导出
  "导出工作目录": "Export working folder",
  "导出工作项目": "Export work project",
  "「{0}」": "“{0}”",
  "个文件": "files",
  "正在统计文件…": "Counting files…",
  "导出格式": "Export format",
  "文件夹": "Folder",
  "确认后选择保存位置，打包为 ZIP 压缩包。":
    "After you confirm, choose where to save; it is packed into a ZIP archive.",
  "确认后选择导出位置，文件夹原样复制。":
    "After you confirm, choose where to export; the folder is copied as-is.",
  "将写入公共 Documents/Albumark/ 下按名称与时间命名的位置。":
    "Written to a location under the public Documents/Albumark/ named by name and time.",
  "导出内容为原样备份，含项目清单，解压到工作目录即可重新识别打开。":
    "The export is a verbatim backup, including the project manifest; unzip it into a working folder to have it recognized and opened again.",
  "导出失败：{0}": "Export failed: {0}",
  "正在导出「{0}」…": "Exporting “{0}”…",
  "{0} / {1} 个文件": "{0} / {1} files",
  "已导出「{0}」": "Exported “{0}”",
  "选择导出位置": "Choose export location",
  "目标位置已有同名文件夹，换一个位置或重命名后再导出":
    "A folder with the same name already exists at the destination. Choose another location or rename, then export again.",

  // 导入照片预览
  "导入照片": "Import photos",
  "已选择 {0} 张照片": "Selected {0} photos",
  "照片入库方式": "Import method",
  "复制原文件": "Copy original files",
  "链接源文件": "Link source files",
  "导入": "Import",

  // 工作项目导入
  "导入工作项目": "Import work project",
  "从导出的备份导入一个工作项目到当前工作目录——ZIP 压缩包或项目文件夹（含 albumark.json 清单）均可识别。":
    "Import a work project from an exported backup into the current working folder—both ZIP archives and project folders (with an albumark.json manifest) are recognized.",
  "选择 ZIP 文件…": "Choose ZIP file…",
  "选择项目文件夹…": "Choose project folder…",
  "导入失败：{0}": "Import failed: {0}",
  "关闭": "Close",
  "正在导入…": "Importing…",
  "已导入 {0} 个文件": "{0} files imported",
  "已导入 {0} 个工作项目": "Imported {0} work projects",
  "已导入「{0}」": "Imported “{0}”",
  "{0} 张照片 · 已加入当前工作目录的项目列表":
    "{0} photos · Added to the project list in the current working folder",
  "复制文件夹…": "Copying folder…",
  "选择工作项目文件夹": "Choose work project folder",

  // 链接导入
  "从链接导入照片": "Import photos from links",
  "导入中…": "Importing…",
  "开始导入": "Start import",
  "已导入 {0} 张": "Imported {0}",

  // 空状态问候
  "夜深了": "It's late",
  "早上好": "Good morning",
  "中午好": "Good afternoon",
  "下午好": "Good afternoon",
  "晚上好": "Good evening",
  "选择或拖入照片，开始今天的辑录。":
    "Select or drop in photos to start today's collection.",
  "选择照片": "Choose photos",
  "导入链接": "Import links",

  // 失联重定位
  "重新定位源文件": "Relocate source files",
  "按文件名在所选文件夹中匹配到 {0} / {1} 张失联照片，识别码一致的已默认勾选":
    "Matched {0} / {1} missing photos by file name in the chosen folder; photos with a matching identifier are checked by default.",
  "识别码一致": "ID matches",
  "内容不符": "Content differs",
  "文件夹里没有同名文件": "No file with the same name in this folder",
  "未找到": "Not found",
  "重新定位": "Relocate",

  // 字体选择
  "选择字体": "Choose font",
  "搜索字体": "Search fonts",
  "搜索字体，回车应用输入的名称": "Search fonts; press Enter to apply the typed name",
  "按语言分类": "Group by language",
  "全部": "All",
  "中文": "Chinese",
  "西文": "Latin",
  "日文": "Japanese",
  "韩文": "Korean",
  "等宽": "Monospace",
  "其他": "Other",
  "系统字体": "System fonts",
  "正在读取系统字体…": "Loading system fonts…",
  "没有匹配的字体，回车可应用输入的名称。":
    "No matching fonts; press Enter to apply the typed name.",
  "浏览器未授权读取系统字体，列表为常用字体清单；可直接键入字体名称后回车。":
    "The browser has not granted access to system fonts, so this list shows common fonts; you can type a font name and press Enter.",
  "已使用字体「{0}」": "Using font “{0}”",

  // stores: export / images
  "没有选择要导出的照片": "No photos selected for export",
  "浏览器版本仅支持导出 ZIP，已自动切换":
    "The browser version only supports ZIP export, so it switched automatically",
  "没有照片导出成功": "No photos were exported successfully",
  "已导出 {0} 张照片": "Exported {0} photos",
  "分享失败，请重试": "Sharing failed; please try again",
  "{0}：{1}": "{0}: {1}",
  "这批照片都没有 EXIF 拍摄信息，相关令牌会留空":
    "None of these photos has EXIF capture info; related tokens will be left blank",
  "有 {0} 张照片缺少 EXIF 拍摄信息，相关令牌会留空":
    "{0} photos are missing EXIF capture info; related tokens will be left blank",
  "仅支持 JPG/PNG 图片链接": "Only JPG/PNG image links are supported",
}

export default messages
