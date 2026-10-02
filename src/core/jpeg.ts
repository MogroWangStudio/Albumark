/**
 * JPEG 头部解析：只扫 SOF / APP1 段拿「显示方向应用后」的像素尺寸，
 * 避免为读个尺寸整图解码。
 * 安卓 WebView 上解码一张 50MP 照片要数秒，而尺寸信息总在文件头几 KB 内。
 * 注意 SOF 里的宽高是传感器原始方向；竖拍照片靠 EXIF Orientation（5–8）
 * 旋转 90° 显示——不换算的话，所有按宽高推比例的几何（裁剪内接框、
 * 按需解码的目标尺寸）都会错位。
 */

export interface JpegInfo {
  /** 显示方向（EXIF Orientation 应用后）的像素尺寸 */
  w: number
  h: number
}

/** 从 JPEG 字节流（通常传入文件头部若干 KB 即可）解析显示尺寸；解析不出返回 null。 */
export function jpegSize(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let orientation = 1
  let i = 2
  while (i + 4 < bytes.length) {
    // 标记码前允许若干填充 0xFF
    if (bytes[i] !== 0xff) return null
    while (i < bytes.length && bytes[i] === 0xff) i++
    const marker = bytes[i]
    i++
    // 独立标记（SOI/EOI/RSTn/TEM）：后随段长度
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (i + 2 > bytes.length) return null
    const len = (bytes[i] << 8) | bytes[i + 1]
    // EXIF 方向：第一个以 "Exif\0\0" 开头的 APP1 段（缩略图等嵌套 JPEG 在段内，扫段逻辑不会误入）
    if (marker === 0xe1 && orientation === 1 && i + 8 < bytes.length) {
      if (bytes[i + 2] === 0x45 && bytes[i + 3] === 0x78 && bytes[i + 4] === 0x69 && bytes[i + 5] === 0x66) {
        orientation = exifOrientation(bytes, i + 8)
      }
    }
    // SOF0–SOF15（跳过 DHT/JPG/DAC）：段内为 精度(1) 高(2) 宽(2) …
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > bytes.length) return null
      const h = (bytes[i + 3] << 8) | bytes[i + 4]
      const w = (bytes[i + 5] << 8) | bytes[i + 6]
      if (w <= 0 || h <= 0) return null
      // Orientation 5–8 表示显示时旋转 90°：宽高互换
      return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h }
    }
    if (marker === 0xda) return null // 到扫描数据仍未见到 SOF：结构异常
    i += len
  }
  return null
}

/** 读 APP1 内 TIFF 结构的 IFD0 Orientation（0x0112）；解析失败按 1（正常）处理。 */
function exifOrientation(bytes: Uint8Array, tiff: number): number {
  try {
    if (tiff + 8 > bytes.length) return 1
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const bo = view.getUint16(tiff)
    const little = bo === 0x4949
    if (!little && bo !== 0x4d4d) return 1
    if (view.getUint16(tiff + 2, little) !== 42) return 1
    const ifd0 = tiff + view.getUint32(tiff + 4, little)
    if (ifd0 + 2 > bytes.length) return 1
    const n = view.getUint16(ifd0, little)
    for (let e = 0; e < n; e++) {
      const off = ifd0 + 2 + e * 12
      if (off + 12 > bytes.length) return 1
      if (view.getUint16(off, little) === 0x0112) return view.getUint16(off + 8, little) || 1
    }
  } catch {
    /* 越界或结构异常：按无方向处理 */
  }
  return 1
}
