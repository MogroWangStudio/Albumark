/**
 * JPEG 头部解析：只扫 SOF 段拿像素尺寸，避免为读个尺寸整图解码。
 * 安卓 WebView 上解码一张 50MP 照片要数秒，而尺寸信息总在文件头几 KB 内。
 */

export interface JpegSize {
  w: number
  h: number
}

/** 从 JPEG 字节流（通常传入文件头部若干 KB 即可）解析像素尺寸；解析不出返回 null。 */
export function jpegSize(bytes: Uint8Array): JpegSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
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
    // SOF0–SOF15（跳过 DHT/JPG/DAC）：段内为 精度(1) 高(2) 宽(2) …
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > bytes.length) return null
      const h = (bytes[i + 3] << 8) | bytes[i + 4]
      const w = (bytes[i + 5] << 8) | bytes[i + 6]
      return w > 0 && h > 0 ? { w, h } : null
    }
    if (marker === 0xda) return null // 到扫描数据仍未见到 SOF：结构异常
    i += len
  }
  return null
}
