import { zipSync } from 'fflate'
import type { ImageItem } from '@/types/image'
import type { WatermarkLayer } from '@/types/watermark'
import type { Adjustments, Crop } from '@/types/adjust'
import type { AssetPayload } from './renderer'
import { RenderClient } from './renderer'
import { resolveTokens } from './tokens'
import { withExif } from './exifWrite'

export interface ExportPayload {
  layers: WatermarkLayer[]
  /** 全局调节参数 */
  adjustments: Adjustments
  /** 开启「单独调节」的照片 id → 独立参数，优先于全局 */
  perImage: Record<string, Adjustments>
  /** 照片 id → 裁剪区域（归一化 0–1） */
  crops: Record<string, Crop>
  /** 开启「单独水印」的照片 id → 独立图层，优先于全局 layers */
  perImageLayers: Record<string, WatermarkLayer[]>
  assets: AssetPayload[]
  quality: number
  longEdge: number
  pattern: string
  /** 输出格式：JPG（有损，质量生效）或 PNG（无损） */
  format: 'jpg' | 'png'
  /** JPG 导出时把源照片的 EXIF 修补后写回导出文件（PNG 不含此能力） */
  keepExif: boolean
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function buildFilename(
  pattern: string,
  item: ImageItem,
  index: number,
  total: number,
  format: 'jpg' | 'png',
): string {
  const now = new Date()
  const ds = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`
  let name = pattern
    .replaceAll('{name}', item.baseName)
    .replaceAll('{index}', pad(index + 1, String(total).length))
    .replaceAll('{date}', ds)
  name = resolveTokens(name, item.exif, item.baseName)
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  if (!name) name = item.baseName
  return `${name}${format === 'png' ? '.png' : '.jpg'}`
}

/**
 * 并行渲染全部照片，返回 文件名 → JPEG 字节 的映射。
 * 文件名已按导出批次去重。
 */
export async function runExport(
  items: ImageItem[],
  payload: ExportPayload,
  concurrency: number,
  onProgress: (done: number, total: number, current: string) => void,
  onItemError?: (name: string, err: unknown) => void,
): Promise<Map<string, ArrayBuffer>> {
  const clients = Array.from(
    { length: Math.max(1, Math.min(4, concurrency)) },
    () => new RenderClient(),
  )
  const used = new Set<string>()
  const out = new Map<string, ArrayBuffer>()
  let next = 0
  let finished = 0

  async function loop(client: RenderClient): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      const item = items[i]
      onProgress(finished, items.length, item.name)
      if (!item.blob) {
        onItemError?.(item.name, new Error('源文件缺失，无法导出'))
        finished++
        onProgress(finished, items.length, item.name)
        continue
      }
      try {
        // 单独水印的照片用独立图层，其余用全局
        const baseLayers = payload.perImageLayers[item.id] ?? payload.layers
        const layers = baseLayers.map((l) =>
          l.type === 'text'
            ? { ...l, content: resolveTokens(l.content, item.exif, item.baseName) }
            : l,
        )
        const { bytes: rendered, width, height } = await client.renderImage(
          item.blob,
          payload.assets,
          layers,
          payload.perImage[item.id] ?? payload.adjustments,
          payload.longEdge,
          payload.quality / 100,
          payload.crops[item.id],
          payload.format,
        )
        // 画布编码不携带元数据：需要保留时从源文件取 EXIF 段，修补后拼回
        const bytes =
          payload.keepExif && payload.format === 'jpg'
            ? await withExif(rendered, item.blob, width, height)
            : rendered
        let name = buildFilename(payload.pattern, item, i, items.length, payload.format)
        let n = 2
        while (used.has(name)) name = name.replace(/\.(jpg|png)$/, `-${n++}$&`)
        used.add(name)
        out.set(name, bytes)
      } catch (err) {
        onItemError?.(item.name, err)
      }
      finished++
      onProgress(finished, items.length, item.name)
    }
  }

  try {
    await Promise.all(clients.map((c) => loop(c)))
  } finally {
    for (const c of clients) c.terminate()
  }
  return out
}

/** STORE 方式打包（JPEG 已压缩，无需再压缩），文件名保留 UTF-8。 */
export function buildZip(files: Map<string, ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const data: Record<string, Uint8Array> = {}
  for (const [name, bytes] of files) data[name] = new Uint8Array(bytes)
  return zipSync(data, { level: 0 }) as Uint8Array<ArrayBuffer>
}

/**
 * 估算导出总大小：均匀抽样（不超过 sampleCount 张）用与真实导出完全相同的
 * 管线渲染编码——水印 / 裁剪 / 调节 / EXIF 拼回全部生效——再按「样本输出
 * 字节 ÷ 源图字节」的压缩率外推全部范围的总和。范围内照片不超过样本数时
 * 全量实算、无外推误差。没有可估样本（源文件全缺失）返回 null。
 */
export async function estimateExportBytes(
  items: ImageItem[],
  payload: ExportPayload,
  sampleCount = 5,
): Promise<number | null> {
  const estimable = items.filter((i) => i.blob)
  if (!estimable.length) return null
  // 均匀取样覆盖大小分布；样本按各自完整配置（独立水印 / 裁剪）实算
  const stride = Math.ceil(estimable.length / Math.min(sampleCount, estimable.length))
  const samples = estimable.filter((_, i) => i % stride === 0)
  const client = new RenderClient()
  let ratioSum = 0
  try {
    for (const item of samples) {
      const blob = item.blob
      if (!blob) continue
      const baseLayers = payload.perImageLayers[item.id] ?? payload.layers
      const layers = baseLayers.map((l) =>
        l.type === 'text'
          ? { ...l, content: resolveTokens(l.content, item.exif, item.baseName) }
          : l,
      )
      const { bytes: rendered, width, height } = await client.renderImage(
        blob,
        payload.assets,
        layers,
        payload.perImage[item.id] ?? payload.adjustments,
        payload.longEdge,
        payload.quality / 100,
        payload.crops[item.id],
        payload.format,
      )
      const bytes =
        payload.keepExif && payload.format === 'jpg'
          ? await withExif(rendered, blob, width, height)
          : rendered
      const src = blob.size || 1
      ratioSum += bytes.byteLength / src
    }
  } finally {
    client.terminate()
  }
  const avgRatio = ratioSum / samples.length
  const srcTotal = estimable.reduce((n, i) => n + (i.blob?.size ?? 0), 0)
  return Math.round(srcTotal * avgRatio)
}
