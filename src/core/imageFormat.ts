/**
 * 图片格式判定：项目只接受 JPG / PNG 两种源文件。
 *
 * 判定以**文件头魔数**为准，扩展名只作兜底——扩展名与内容不一致的文件
 * （改名、导出器写错后缀）如果只按名字判断，落盘后缀会与真实编码不符，
 * 之后解码、缩略图有损编码、导出都会走错分支。
 */

export type ImageFormat = 'jpg' | 'png'

const MIME: Record<ImageFormat, string> = { jpg: 'image/jpeg', png: 'image/png' }

/** 从字节流识别格式（只需头部若干字节）；认不出返回 null。 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  // JPEG：SOI 标记 FF D8 后紧跟一个标记 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg'
  }
  // PNG：8 字节签名 89 50 4E 47 0D 0A 1A 0A，前 4 字节即可定性
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }
  return null
}

/** 按扩展名判定（拿不到字节时的兜底）。 */
export function formatOfName(name: string): ImageFormat | null {
  if (/\.jpe?g$/i.test(name)) return 'jpg'
  if (/\.png$/i.test(name)) return 'png'
  return null
}

/** 是否为可导入的图片文件名：导入前先过滤，杂项文件不应计入待导入张数。 */
export function isImportableImage(name: string): boolean {
  return formatOfName(name) !== null
}

/** Blob 的 MIME：解码器按它选分支，PNG 必须给 image/png 才能保住 alpha。 */
export function imageMime(format: ImageFormat): string {
  return MIME[format]
}

/** 项目 images/ 内的落盘后缀（与真实编码一致）。 */
export function imageExt(format: ImageFormat): string {
  return format
}

/** 字节优先、名字兜底的最终判定。 */
export function resolveImageFormat(bytes: Uint8Array, name = ''): ImageFormat | null {
  return sniffImageFormat(bytes) ?? formatOfName(name)
}
