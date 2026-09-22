/// <reference lib="webworker" />
import { applyAdjustments } from '../core/adjust'
import { drawLayers, type AssetMap } from '../core/draw'
import type { WatermarkLayer } from '../types/watermark'
import type { Adjustments, Crop } from '../types/adjust'

export interface RenderJob {
  id: number
  bitmap: ImageBitmap
  assets: { id: string; blob: Blob }[]
  layers: WatermarkLayer[]
  adjustments: Adjustments
  /** 裁剪区域（归一化 0–1），不传 = 不裁剪 */
  crop?: Crop
  /** 长边上限（像素），0 表示原图尺寸 */
  maxSize: number
  /** JPEG 质量 0-1 */
  quality: number
  want: 'bitmap' | 'jpeg'
}

type PostMessage = (message: unknown, transfer?: Transferable[]) => void
const post = (self as unknown as { postMessage: PostMessage }).postMessage.bind(self)

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const assetCache: AssetMap = new Map()
let mctx: OffscreenCanvasRenderingContext2D | null = null

function measureCtx(): OffscreenCanvasRenderingContext2D {
  if (!mctx) {
    mctx = new OffscreenCanvas(1, 1).getContext('2d') as OffscreenCanvasRenderingContext2D
  }
  return mctx
}

self.addEventListener('message', (e: MessageEvent<{ job: RenderJob }>) => {
  void handle(e.data.job)
})

async function handle(job: RenderJob): Promise<void> {
  const src = job.bitmap
  // 裁剪在取样阶段完成：只把裁剪区域画进画布，后续调节与水印都以裁剪后的图为画布
  const c = job.crop
  const sx = c ? Math.round(clamp01(c.x) * src.width) : 0
  const sy = c ? Math.round(clamp01(c.y) * src.height) : 0
  const sw = c ? Math.max(1, Math.round(clamp01(c.w) * src.width)) : src.width
  const sh = c ? Math.max(1, Math.round(clamp01(c.h) * src.height)) : src.height

  const long = Math.max(sw, sh)
  const scale = job.maxSize > 0 ? Math.min(1, job.maxSize / long) : 1
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h)

  const a = job.adjustments
  if (
    a.brightness !== 0 ||
    a.exposure !== 0 ||
    a.contrast !== 0 ||
    a.shadows !== 0 ||
    a.highlights !== 0 ||
    a.temperature !== 0 ||
    a.tint !== 0 ||
    a.vignette !== 0 ||
    (a.curve && a.curve.length >= 4)
  ) {
    const image = ctx.getImageData(0, 0, w, h)
    applyAdjustments(image.data, w, h, a)
    ctx.putImageData(image, 0, 0)
  }

  const keep = new Set(job.assets.map((x) => x.id))
  for (const key of [...assetCache.keys()]) {
    if (!keep.has(key)) assetCache.delete(key)
  }
  for (const asset of job.assets) {
    if (!assetCache.has(asset.id)) {
      try {
        assetCache.set(asset.id, await createImageBitmap(asset.blob))
      } catch {
        /* 无效素材直接跳过 */
      }
    }
  }

  measureCtx()
  drawLayers(ctx, w, h, job.layers, assetCache)

  if (job.want === 'bitmap') {
    const out = await createImageBitmap(canvas)
    post({ id: job.id, bitmap: out, srcBack: src }, [out, src])
  } else {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: job.quality })
    const bytes = await blob.arrayBuffer()
    post({ id: job.id, bytes, width: w, height: h, srcBack: src }, [bytes, src])
  }
}
