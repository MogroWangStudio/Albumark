import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { t } from '@/i18n'
import type { SerializedAsset, WatermarkLayer, WatermarkTemplate } from '@/types/watermark'
import { migrateLayer } from '@/types/watermark'

/**
 * 水印模板文件：单个普通 `.zip`，方便用户像普通文件一样复制、备份与分享。
 *
 * 目录结构：
 *   albumark-watermark.json  描述文件（导入时唯一识别依据）
 *   watermark.json           水印数据（图层 JSON）
 *   assets/0.png …           原始图片 / SVG 素材
 *
 * 描述文件：
 *   { format:'albumark-watermark', kind:'watermark-template', version:2,
 *     name, createdAt, data:'watermark.json',
 *     assets:[{ id, name, file, mime, aspect }] }
 * 水印数据：
 *   { format:'albumark-watermark-data', version:1, layers:[…] }
 *
 * 导入只认描述文件里的 format：缺少 / 不匹配即拒绝，不再读取旧版 `.amwm`
 * 或裸 manifest.json。
 */

export const TEMPLATE_EXT = '.zip'
export const TEMPLATE_MIME = 'application/zip'
const DESCRIPTOR_FILE = 'albumark-watermark.json'
const DEFAULT_DATA_FILE = 'watermark.json'
const FORMAT = 'albumark-watermark'
const DATA_FORMAT = 'albumark-watermark-data'
const VERSION = 2
const DATA_VERSION = 1
/** 解压后的总字节上限：防压缩炸弹 */
const MAX_UNPACKED = 96 * 1024 * 1024

interface ManifestAsset {
  id: string
  name: string
  file: string
  mime: string
  aspect: number
}

interface Descriptor {
  format: string
  kind?: string
  version: number
  name: string
  createdAt?: number
  data: string
  assets: ManifestAsset[]
}

interface DataFile {
  format: string
  version: number
  layers: WatermarkLayer[]
}

function extForMime(mime: string, name: string): string {
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  const hit = name.toLowerCase().match(/\.(svg|png|jpg|jpeg|webp)$/)
  return hit ? hit[1].replace('jpeg', 'jpg') : 'bin'
}

/** dataURL → 原始字节（同步，导出时避免额外异步等待） */
function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error(t('水印模板内的图片数据损坏'))
  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mime = header.slice(5, header.indexOf(';')) || 'application/octet-stream'
  if (!header.includes('base64')) {
    return { bytes: strToU8(decodeURIComponent(body)), mime }
  }
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}

function bytesDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

/** 文件名合法化：去掉路径分隔符等非法字符，统一后缀为 .zip */
export function watermarkFileName(name: string): string {
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'Albumark watermark'
  return clean.toLowerCase().endsWith(TEMPLATE_EXT) ? clean : clean + TEMPLATE_EXT
}

/** 把模板（含图片素材）打包为单个 .zip 字节流 */
export function packWatermarkTemplate(tpl: WatermarkTemplate): Uint8Array {
  const assets: ManifestAsset[] = []
  const files: Record<string, Uint8Array> = {}
  tpl.assets.forEach((a: SerializedAsset, i) => {
    const parsed = dataUrlBytes(a.dataUrl)
    const ext = extForMime(parsed.mime, a.name)
    const file = `assets/${i}.${ext}`
    files[file] = parsed.bytes
    assets.push({ id: a.id, name: a.name, file, mime: parsed.mime, aspect: a.aspect })
  })
  const data: DataFile = {
    format: DATA_FORMAT,
    version: DATA_VERSION,
    layers: tpl.layers,
  }
  const descriptor: Descriptor = {
    format: FORMAT,
    kind: 'watermark-template',
    version: VERSION,
    name: tpl.name,
    createdAt: tpl.createdAt,
    data: DEFAULT_DATA_FILE,
    assets,
  }
  files[DESCRIPTOR_FILE] = strToU8(JSON.stringify(descriptor, null, 2))
  files[DEFAULT_DATA_FILE] = strToU8(JSON.stringify(data, null, 2))
  return zipSync(files, { level: 6 })
}

/** 模板文件的真实体积（与导出得到的 .zip 一致），用于卡片展示 */
export function watermarkTemplateBytes(tpl: WatermarkTemplate): number {
  try {
    return packWatermarkTemplate(tpl).byteLength
  } catch {
    return 0
  }
}

function isSafeAssetFile(file: string): boolean {
  if (!file.startsWith('assets/')) return false
  const part = file.slice(7)
  return !!part && !part.includes('..') && !part.includes('\\') && !part.startsWith('/')
}

/** 水印数据文件允许放在根目录下的任意安全文件名（不含路径穿越） */
function isSafeDataFile(file: string): boolean {
  return (
    !!file &&
    !file.includes('..') &&
    !file.includes('\\') &&
    !file.startsWith('/') &&
    !file.startsWith('assets/')
  )
}

/** 解析水印模板 .zip，返回可交给模板 store 的模板数据 */
export function unpackWatermarkTemplate(bytes: Uint8Array): WatermarkTemplate {
  if (bytes.byteLength > MAX_UNPACKED) throw new Error(t('水印模板过大，无法导入'))
  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(bytes)
  } catch {
    throw new Error(t('不是有效的 Albumark 水印模板文件'))
  }
  let total = 0
  for (const data of Object.values(zip)) {
    total += data.byteLength
    if (total > MAX_UNPACKED) throw new Error(t('水印模板过大，无法导入'))
  }
  // 描述文件是导入识别的唯一依据：没有它就不是 Albumark 水印模板
  const descBytes = zip[DESCRIPTOR_FILE]
  if (!descBytes) throw new Error(t('水印模板缺少描述文件'))
  let descriptor: Descriptor
  try {
    descriptor = JSON.parse(strFromU8(descBytes)) as Descriptor
  } catch {
    throw new Error(t('水印模板描述文件损坏'))
  }
  if (
    !descriptor ||
    descriptor.format !== FORMAT ||
    typeof descriptor.version !== 'number' ||
    descriptor.version > VERSION ||
    !Array.isArray(descriptor.assets)
  ) {
    throw new Error(t('不是有效的 Albumark 水印模板文件'))
  }
  // 水印数据：描述文件优先指定路径，缺省回落到 watermark.json
  const dataPath =
    typeof descriptor.data === 'string' && isSafeDataFile(descriptor.data)
      ? descriptor.data
      : DEFAULT_DATA_FILE
  const dataBytes = zip[dataPath] ?? zip[DEFAULT_DATA_FILE]
  if (!dataBytes) throw new Error(t('水印模板缺少水印数据'))
  let dataFile: DataFile
  try {
    dataFile = JSON.parse(strFromU8(dataBytes)) as DataFile
  } catch {
    throw new Error(t('水印模板数据损坏'))
  }
  if (
    !dataFile ||
    !Array.isArray(dataFile.layers) ||
    (typeof dataFile.version === 'number' && dataFile.version > DATA_VERSION)
  ) {
    throw new Error(t('不是有效的 Albumark 水印模板文件'))
  }
  if (dataFile.layers.length > 500 || descriptor.assets.length > 200) {
    throw new Error(t('水印模板内容过多，无法导入'))
  }
  const assets: SerializedAsset[] = []
  for (const a of descriptor.assets) {
    if (!a || typeof a.id !== 'string' || !isSafeAssetFile(a.file)) continue
    const data = zip[a.file]
    if (!data) throw new Error(t('水印模板缺少图片素材'))
    assets.push({
      id: a.id,
      name: typeof a.name === 'string' && a.name ? a.name : a.file.split('/').pop() || a.id,
      dataUrl: bytesDataUrl(data, typeof a.mime === 'string' && a.mime ? a.mime : 'application/octet-stream'),
      aspect: Number.isFinite(a.aspect) && a.aspect > 0 ? a.aspect : 1,
    })
  }
  return {
    id: 'imported',
    name: typeof descriptor.name === 'string' ? descriptor.name : t('未命名模板'),
    createdAt: descriptor.createdAt,
    layers: dataFile.layers.map((l) => migrateLayer(l)),
    assets,
  }
}
