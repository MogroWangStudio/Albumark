/// <reference lib="webworker" />
import { applyAdjustments } from '../core/adjust'
import { drawLayers, type AssetMap } from '../core/draw'
import type { WatermarkLayer } from '../types/watermark'
import type { Adjustments } from '../types/adjust'

export interface RenderJob {
  id: number
  bitmap: ImageBitmap
  assets: { id: string; blob: Blob }[]
  layers: WatermarkLayer[]
  adjustments: Adjustments
  /** 长边上限（像素），0 表示原图尺寸 */
  maxSize: number
  /** JPEG 质量 0-1 */
  quality: number
  want: 'bitmap' | 'jpeg'
}

type PostMessage = (message: unknown, transfer?: Transferable[]) => void
const post = (self as unknown as { postMessage: PostMessage }).postMessage.bind(self)

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
  const long = Math.max(src.width, src.height)
  const scale = job.maxSize > 0 ? Math.min(1, job.maxSize / long) : 1
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  ctx.drawImage(src, 0, 0, w, h)

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
