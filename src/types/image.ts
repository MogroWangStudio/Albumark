export interface ExifSummary {
  make?: string
  model?: string
  lens?: string
  fNumber?: number
  exposureTime?: number
  iso?: number
  focalLength?: number
  dateTime?: string
  artist?: string
}

export interface ImageItem {
  id: string
  name: string
  baseName: string
  blob: Blob | null
  /** 图库缩略图（240px 长边）的对象 URL；导入后异步生成 */
  thumbUrl: string
  width: number
  height: number
  exif?: ExifSummary
  /** 工作区链接模式：源文件路径（仅桌面端） */
  sourcePath?: string
  /** 工作区复制模式：工作区 images/ 内的存储文件名 */
  storedAs?: string
  /** 内容识别码（SHA-256 前 32 位），重定位源文件时校对用 */
  code?: string
  /** 源文件路径无法读取，需要用户重新定位 */
  missing?: boolean
}
