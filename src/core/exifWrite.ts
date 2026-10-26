/**
 * 导出时保留 EXIF：从源 JPEG 提取 Exif APP1 段，修补后拼回导出文件。
 *
 * 画布编码出的 JPEG 不含任何元数据；直接搬运源文件的 Exif 段也不行，
 * 有三处内容相对导出结果已经过时，必须先修补：
 *  1. Orientation——解码时已按方向转正（createImageBitmap 默认 from-image），
 *     带着原值（5–8）会让观看端把已经正立的照片再转一次；
 *  2. 像素尺寸——缩放、裁剪、边框都会改变输出尺寸，IFD0 与 Exif IFD
 *     记录的宽高同步改写（原文件没记的标签不新增）；
 *  3. IFD1 内嵌缩略图——那是加水印前的原图预览，随元数据带出去等于
 *     泄露无水印版本，还徒增体积。
 *
 * 结构解析不了就不冒险：读不出 IFD0（无法确认方向）时整个放弃 EXIF，
 * 只在确认可解析的前提下做修补。
 */

const MAX_HEAD_READ = 2 * 1024 * 1024

/**
 * 导出单张的收尾：把源照片的 EXIF 修补后拼进导出 JPEG。
 * 源文件不是 JPEG、没有 Exif 段或结构异常时原样返回——缺元数据好过元数据出错。
 */
export async function withExif(
  rendered: ArrayBuffer,
  source: Blob,
  outW: number,
  outH: number,
): Promise<ArrayBuffer> {
  const src = new Uint8Array(rendered)
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) return rendered
  const seg = await readExifSegment(source)
  if (!seg) return rendered
  const exif = normalizeExifSegment(seg, outW, outH)
  if (!exif) return rendered
  const out = new Uint8Array(src.length + exif.length)
  out.set(src.subarray(0, 2), 0) // SOI 之后紧跟 Exif APP1
  out.set(exif, 2)
  out.set(src.subarray(2), 2 + exif.length)
  return out.buffer
}

/**
 * 取源文件的 Exif APP1 段（含标记与长度字段）。
 * 只按需增量读文件头部，不给几十 MB 的原图整份解码；
 * 段不存在（非 JPEG / 纯净文件）或读到上限仍未见分晓，返回 null。
 */
export async function readExifSegment(blob: Blob): Promise<Uint8Array | null> {
  if (blob.size < 4) return null
  let end = Math.min(256 * 1024, blob.size)
  try {
    for (;;) {
      const buf = new Uint8Array(await blob.slice(0, end).arrayBuffer())
      const seg = scanExifSegment(buf)
      // undefined = 缓冲不够、尚无定论，扩大读取范围再来
      if (seg !== undefined) return seg
      if (end >= blob.size || end >= MAX_HEAD_READ) return null
      end = Math.min(end * 4, blob.size, MAX_HEAD_READ)
    }
  } catch {
    return null
  }
}

/** 扫 JPEG 段序列找 Exif APP1；null = 确定没有，undefined = 缓冲不够。 */
function scanExifSegment(b: Uint8Array): Uint8Array | null | undefined {
  if (b.length < 2 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 4 < b.length) {
    // 标记码前允许若干填充 0xFF（与 jpeg.ts 同一套扫描约定）
    if (b[i] !== 0xff) return null
    while (i < b.length && b[i] === 0xff) i++
    const marker = b[i]
    i++
    // 独立标记（SOI/EOI/RSTn/TEM）：后随段长度
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (i + 2 > b.length) return undefined
    const len = (b[i] << 8) | b[i + 1]
    if (len < 2) return null
    const segEnd = i + len
    if (segEnd > b.length) return undefined
    if (marker === 0xe1 && segEnd - i >= 8 && isExifPayload(b, i + 2)) {
      return b.subarray(i - 2, segEnd) // 标记 2B + 长度字段 + 载荷
    }
    i = segEnd
    if (marker === 0xda) return null // 进入扫描数据：后面不会再有 APP 段
  }
  return undefined
}

/** 载荷以 "Exif\0\0" 开头（6 字节头是 Exif 规范要求的完整形式）。 */
function isExifPayload(b: Uint8Array, p: number): boolean {
  return (
    p + 6 <= b.length &&
    b[p] === 0x45 &&
    b[p + 1] === 0x78 &&
    b[p + 2] === 0x69 &&
    b[p + 3] === 0x66 &&
    b[p + 4] === 0x00 &&
    b[p + 5] === 0x00
  )
}

/**
 * 修补 Exif 段以匹配导出结果：方向置 1、宽高改为实际输出尺寸、
 * 去掉 IFD1 缩略图。结构异常时返回 null（调用方放弃 EXIF）。
 */
export function normalizeExifSegment(
  seg: Uint8Array,
  outW: number,
  outH: number,
): Uint8Array | null {
  // 段布局：FF E1 | len(2) | "Exif\0\0"(6) | TIFF…
  if (seg.length < 18) return null
  try {
    const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength)
    const tiff = 10
    const little = dv.getUint16(tiff) === 0x4949
    if (!little && dv.getUint16(tiff) !== 0x4d4d) return null
    if (dv.getUint16(tiff + 2, little) !== 42) return null
    const ifd0 = tiff + dv.getUint32(tiff + 4, little)
    const n0 = ifdCount(dv, ifd0, seg.length, little)
    if (n0 < 0) return null

    patchTag(dv, ifd0, n0, seg.length, 0x0112, 1, little) // Orientation → 正立
    patchTag(dv, ifd0, n0, seg.length, 0x0100, outW, little) // ImageWidth
    patchTag(dv, ifd0, n0, seg.length, 0x0101, outH, little) // ImageHeight
    const exifIfd = tiff + findValue(dv, ifd0, n0, seg.length, 0x8769, little) // Exif IFD 指针
    if (exifIfd > tiff) {
      const n1 = ifdCount(dv, exifIfd, seg.length, little)
      if (n1 >= 0) {
        patchTag(dv, exifIfd, n1, seg.length, 0xa002, outW, little) // PixelXDimension
        patchTag(dv, exifIfd, n1, seg.length, 0xa003, outH, little) // PixelYDimension
      }
    }
    return dropThumbnail(seg, dv, tiff, ifd0, n0, little)
  } catch {
    return null
  }
}

/** IFD 条目数；越界（段被截断或结构损坏）返回 -1。 */
function ifdCount(dv: DataView, ifd: number, segLen: number, little: boolean): number {
  if (ifd + 2 > segLen) return -1
  const n = dv.getUint16(ifd, little)
  return ifd + 2 + n * 12 + 4 <= segLen ? n : -1
}

/** 找到标签则返回条目起点，否则 -1。 */
function findEntry(
  dv: DataView,
  ifd: number,
  n: number,
  segLen: number,
  tag: number,
  little: boolean,
): number {
  for (let e = 0; e < n; e++) {
    const off = ifd + 2 + e * 12
    if (off + 12 > segLen) return -1
    if (dv.getUint16(off, little) === tag) return off
  }
  return -1
}

function findValue(
  dv: DataView,
  ifd: number,
  n: number,
  segLen: number,
  tag: number,
  little: boolean,
): number {
  const entry = findEntry(dv, ifd, n, segLen, tag, little)
  if (entry < 0 || dv.getUint16(entry + 2, little) !== 4) return 0
  return dv.getUint32(entry + 8, little)
}

/** 改写条目内联值（count=1 且类型为 SHORT/LONG 的才有内联值）；没有或不适用就跳过。 */
function patchTag(
  dv: DataView,
  ifd: number,
  n: number,
  segLen: number,
  tag: number,
  value: number,
  little: boolean,
): void {
  const entry = findEntry(dv, ifd, n, segLen, tag, little)
  if (entry < 0 || dv.getUint32(entry + 4, little) !== 1) return
  const type = dv.getUint16(entry + 2, little)
  if (type === 3 && value <= 0xffff) dv.setUint16(entry + 8, value, little)
  else if (type === 4) dv.setUint32(entry + 8, value, little)
  // 尺寸标签是 SHORT 而输出又超过 65535 时写不下：保留旧值（多数软件以
  // SOF 里的实际尺寸为准，元数据只是参考）
}

/**
 * 去掉 IFD1 内嵌缩略图：缩略图数据在段尾，把 IFD0 的「下一 IFD」指针清零、
 * 截掉 IFD1 起的尾部即可，之前各 IFD 引用的数据不受影响。
 * 缩略图不在尾部（少见布局）时不动段，宁可多带也不损坏。
 */
function dropThumbnail(
  seg: Uint8Array,
  dv: DataView,
  tiff: number,
  ifd0: number,
  n0: number,
  little: boolean,
): Uint8Array {
  const next = ifd0 + 2 + n0 * 12
  const ifd1Rel = dv.getUint32(next, little)
  if (ifd1Rel === 0 || tiff + ifd1Rel >= seg.length) return seg
  const ifd1 = tiff + ifd1Rel
  const n1 = ifdCount(dv, ifd1, seg.length, little)
  if (n1 < 0) return seg
  const thumb = findEntry(dv, ifd1, n1, seg.length, 0x0201, little)
  if (thumb >= 0 && dv.getUint16(thumb + 2, little) === 4) {
    const thumbOff = dv.getUint32(thumb + 8, little)
    if (thumbOff > 0 && thumbOff < ifd1Rel) return seg
  }
  dv.setUint32(next, 0, little)
  // 新总长 = 标记 2B + 长度字段 2B + "Exif\0\0" 6B + TIFF 头 8B + 至 IFD1 前
  const newLen = 10 + ifd1Rel
  dv.setUint16(2, newLen - 4, false) // JPEG 段长度恒为大端
  return seg.subarray(0, newLen)
}
