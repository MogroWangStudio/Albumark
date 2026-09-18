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
  url: string
  width: number
  height: number
  exif?: ExifSummary
}
