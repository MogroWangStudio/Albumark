import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { t } from '@/i18n'
import type { SerializedAsset, WatermarkLayer, WatermarkTemplate } from '@/types/watermark'
import { migrateLayer } from '@/types/watermark'

/**
 * .amwm（Albumark Watermark）单文件模板：
 * 本质是一个 ZIP，内含 manifest.json + assets/ 下的原始图片（PNG/JPG/SVG），
 * 扩展名固定为 .amwm，方便用户像普通文件一样复制、备份与分享。
 *
 * manifest.json：
 *   { format:'albumark-watermark', version:1, name, createdAt, layers,
 *     assets:[{ id, name, file, mime, aspect }] }
 * 图片以二进制存进 assets/，不把 base64 塞进 JSON，模板文件更小。
 */

export const AMWM_EXT = '.amwm'
export const AMWM_MIME = 'application/x-albumark-watermark'
const FORMAT = 'albumark-watermark'
const VERSION = 1
/** 解压后的总字节上限：防压缩炸弹 */
const MAX_UNPACKED = 96 * 1024 * 1024

interface ManifestAsset {
  id: string
  name: string
  file: string
  mime: string
  aspect: number
}

interface Manifest {
  format: string
  version: number
  name: string
  createdAt?: number
  layers: WatermarkLayer[]
  assets: ManifestAsset[]
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

/** 文件名合法化：去掉路径分隔符等非法字符 */
export function amwmFileName(name: string): string {
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'Albumark watermark'
  return clean.toLowerCase().endsWith(AMWM_EXT) ? clean : clean + AMWM_EXT
}

/** 把模板（含图片素材）打包为单个 .amwm 字节流 */
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
  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    name: tpl.name,
    createdAt: tpl.createdAt,
    layers: tpl.layers,
    assets,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  return zipSync(files, { level: 6 })
}

/** 模板文件的真实体积（与导出得到的 .amwm 一致），用于卡片展示 */
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

/** 解析 .amwm，返回可交给模板 store 的模板数据 */
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
  const manifestBytes = zip['manifest.json']
  if (!manifestBytes) throw new Error(t('水印模板缺少 manifest.json'))
  let manifest: Manifest
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest
  } catch {
    throw new Error(t('水印模板清单损坏'))
  }
  if (
    !manifest ||
    manifest.format !== FORMAT ||
    typeof manifest.version !== 'number' ||
    manifest.version > VERSION ||
    !Array.isArray(manifest.layers) ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error(t('不是有效的 Albumark 水印模板文件'))
  }
  if (manifest.layers.length > 500 || manifest.assets.length > 200) {
    throw new Error(t('水印模板内容过多，无法导入'))
  }
  const assets: SerializedAsset[] = []
  for (const a of manifest.assets) {
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
    name: typeof manifest.name === 'string' ? manifest.name : t('未命名模板'),
    createdAt: manifest.createdAt,
    layers: manifest.layers.map((l) => migrateLayer(l)),
    assets,
  }
}
