/**
 * PNG 头部解析：从 IHDR 块读像素尺寸，避免为读个尺寸整图解码。
 * 与 core/jpeg.ts 对称；PNG 无方向元数据，IHDR 宽高即显示尺寸。
 */

export interface PngInfo {
  /** 像素尺寸 */
  w: number
  h: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 从 PNG 字节流（头部即可）解析 IHDR 尺寸；解析不出返回 null。 */
export function pngSize(bytes: Uint8Array): PngInfo | null {
  // 签名 8 字节 + 块头 8 字节 + IHDR 数据 13 字节 = 33 字节
  if (bytes.length < 33) return null
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null
  }
  // 第一个块必须是 IHDR：长度 13 + 类型 'IHDR'
  if ((bytes[8] << 24 | bytes[9] << 16 | bytes[10] << 8 | bytes[11]) !== 13) return null
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const w = dv.getUint32(16)
  const h = dv.getUint32(20)
  if (w <= 0 || h <= 0) return null
  return { w, h }
}
