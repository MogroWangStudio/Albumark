import exifr from 'exifr'
import type { ExifSummary } from '@/types/image'

const PICK = [
  'Make',
  'Model',
  'LensModel',
  'FNumber',
  'ExposureTime',
  'ISO',
  'FocalLength',
  'DateTimeOriginal',
  'Artist',
]

export async function readExif(blob: Blob): Promise<ExifSummary | undefined> {
  try {
    const raw = await exifr.parse(blob, { pick: PICK })
    if (!raw) return undefined
    const s: ExifSummary = {}
    if (raw.Make) s.make = String(raw.Make).trim()
    if (raw.Model) s.model = String(raw.Model).trim()
    if (raw.LensModel) s.lens = String(raw.LensModel).trim()
    if (typeof raw.FNumber === 'number' && raw.FNumber > 0) s.fNumber = raw.FNumber
    if (typeof raw.ExposureTime === 'number' && raw.ExposureTime > 0) {
      s.exposureTime = raw.ExposureTime
    }
    if (typeof raw.ISO === 'number' && raw.ISO > 0) s.iso = raw.ISO
    if (typeof raw.FocalLength === 'number' && raw.FocalLength > 0) {
      s.focalLength = raw.FocalLength
    }
    if (raw.DateTimeOriginal instanceof Date && !isNaN(raw.DateTimeOriginal.getTime())) {
      s.dateTime = formatExifDate(raw.DateTimeOriginal)
    }
    if (raw.Artist) s.artist = String(raw.Artist).trim()
    return Object.keys(s).length ? s : undefined
  } catch {
    return undefined
  }
}

export function formatExifDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatShutter(t: number): string {
  if (t >= 1) return `${Math.round(t * 10) / 10}s`
  return `1/${Math.round(1 / t)}s`
}

/** 摘要一行：机型 · 焦距 光圈 快门 感光度（缺项自动略过）。 */
export function exifSummaryLine(e?: ExifSummary): string {
  if (!e) return ''
  const parts: string[] = []
  if (e.model) parts.push(e.model)
  const shoot: string[] = []
  if (e.focalLength) shoot.push(`${Math.round(e.focalLength)}mm`)
  if (e.fNumber) shoot.push(`f/${Math.round(e.fNumber * 10) / 10}`)
  if (e.exposureTime) shoot.push(formatShutter(e.exposureTime))
  if (e.iso) shoot.push(`ISO ${e.iso}`)
  if (shoot.length) parts.push(shoot.join(' '))
  return parts.join(' · ')
}
