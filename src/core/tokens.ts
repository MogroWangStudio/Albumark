import type { ExifSummary } from '@/types/image'
import { formatShutter } from './exif'

export interface TokenDef {
  key: string
  label: string
  sample: string
}

/** 可插入水印文本的 EXIF 令牌，导出时按每张照片的实际信息替换。 */
export const TOKENS: TokenDef[] = [
  { key: 'Model', label: '机型', sample: 'iPhone 17 Pro' },
  { key: 'Lens', label: '镜头', sample: '24mm f/1.6' },
  { key: 'Aperture', label: '光圈', sample: 'f/1.6' },
  { key: 'Shutter', label: '快门', sample: '1/120s' },
  { key: 'ISO', label: '感光度', sample: 'ISO 100' },
  { key: 'FocalLength', label: '焦距', sample: '24mm' },
  { key: 'DateTime', label: '拍摄日期', sample: '2026-09-18 10:24' },
  { key: 'Artist', label: '作者', sample: 'MogroWang' },
  { key: 'FileName', label: '文件名', sample: 'DSC01234' },
]

function resolveToken(key: string, exif?: ExifSummary, fileName?: string): string | undefined {
  switch (key) {
    case 'Model':
      return exif?.model
    case 'Make':
      return exif?.make
    case 'Lens':
      return exif?.lens
    case 'Aperture':
      return exif?.fNumber ? `f/${round1(exif.fNumber)}` : undefined
    case 'Shutter':
      return exif?.exposureTime ? formatShutter(exif.exposureTime) : undefined
    case 'ISO':
      return exif?.iso ? `ISO ${exif.iso}` : undefined
    case 'FocalLength':
      return exif?.focalLength ? `${Math.round(exif.focalLength)}mm` : undefined
    case 'DateTime':
      return exif?.dateTime
    case 'Artist':
      return exif?.artist
    case 'FileName':
      return fileName
    default:
      return undefined
  }
}

function round1(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/** 已知令牌缺失信息时替换为空串，未知令牌保留原文以便发现拼写问题。 */
export function resolveTokens(text: string, exif?: ExifSummary, fileName?: string): string {
  return text.replace(/\{(\w+)\}/g, (raw, key: string) => resolveToken(key, exif, fileName) ?? raw)
}

/** 找出内容中用到、但当前照片解析不出值的令牌（用于常驻缺失警告）。 */
export function missingTokens(
  text: string,
  exif?: ExifSummary,
  fileName?: string,
): TokenDef[] {
  const keys = new Set<string>()
  for (const m of text.matchAll(/\{(\w+)\}/g)) keys.add(m[1])
  const out: TokenDef[] = []
  for (const t of TOKENS) {
    if (!keys.has(t.key)) continue
    if (resolveToken(t.key, exif, fileName) === undefined) out.push(t)
  }
  return out
}
