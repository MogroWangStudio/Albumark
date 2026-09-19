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
  blob: Blob
  /** 图库缩略图（240px 长边）的对象 URL；导入后异步生成 */
  thumbUrl: string
  width: number
  height: number
  exif?: ExifSummary
}
