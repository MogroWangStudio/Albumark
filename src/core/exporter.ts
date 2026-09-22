import { zipSync } from 'fflate'
import type { ImageItem } from '@/types/image'
import type { WatermarkLayer } from '@/types/watermark'
import type { Adjustments, Crop } from '@/types/adjust'
import type { AssetPayload } from './renderer'
import { RenderClient } from './renderer'
import { resolveTokens } from './tokens'

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
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function buildFilename(
  pattern: string,
  item: ImageItem,
  index: number,
  total: number,
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
  return `${name}.jpg`
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
        const { bytes } = await client.renderJpeg(
          item.blob,
          payload.assets,
          layers,
          payload.perImage[item.id] ?? payload.adjustments,
          payload.longEdge,
          payload.quality / 100,
          payload.crops[item.id],
        )
        let name = buildFilename(payload.pattern, item, i, items.length)
        let n = 2
        while (used.has(name)) name = name.replace(/\.jpg$/, `-${n++}.jpg`)
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
