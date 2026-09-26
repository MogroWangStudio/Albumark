/// <reference lib="webworker" />
import { applyAdjustments } from '../core/adjust'
import { drawLayers, type AssetMap } from '../core/draw'
import type { BorderLayer, WatermarkLayer } from '../types/watermark'
import { isHslNeutral, type Adjustments, type Crop } from '../types/adjust'

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
  let src: ImageBitmap | OffscreenCanvas = job.bitmap
  // 几何变换先行：翻转 → 绕中心拉直旋转（包围盒画布，四角留空），裁剪矩形即定义在变换后的源上
  const c = job.crop
  const rot = c?.rot ? Math.max(-45, Math.min(45, c.rot)) : 0
  const flipH = !!c?.flipH
  const flipV = !!c?.flipV
  if (flipH || flipV || rot !== 0) {
    const w0 = job.bitmap.width
    const h0 = job.bitmap.height
    const rad = (rot * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    const w1 = Math.max(1, Math.round(w0 * cos + h0 * sin))
    const h1 = Math.max(1, Math.round(w0 * sin + h0 * cos))
    const t = new OffscreenCanvas(w1, h1)
    const tctx = t.getContext('2d') as OffscreenCanvasRenderingContext2D
    tctx.translate(w1 / 2, h1 / 2)
    tctx.rotate(rad)
    tctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    tctx.drawImage(job.bitmap, -w0 / 2, -h0 / 2)
    src = t
  }
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
  ctx.imageSmoothingQuality = 'high'
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
    a.vibrance !== 0 ||
    a.saturation !== 0 ||
    a.vignette !== 0 ||
    a.dehaze !== 0 ||
    a.clarity !== 0 ||
    a.sharpen !== 0 ||
    a.grain !== 0 ||
    !isHslNeutral(a.hsl) ||
    (a.curve && a.curve.length >= 4)
  ) {
    const image = ctx.getImageData(0, 0, w, h)
    applyAdjustments(image.data, w, h, a)
    ctx.putImageData(image, 0, 0)
  }

  // 边框水印在调节之后、普通图层之前逐层向外扩展画布；图层列表靠前者更贴近照片。
  // 边框宽度按取样缩放系数等比折算，保证预览（缩放渲染）与导出的边框比例一致
  const borders = job.layers.filter((l): l is BorderLayer => l.type === 'border' && l.visible)
  const pictureLayers = job.layers.filter((l) => l.type !== 'border')
  const scaled = (v: number): number => (v > 0 ? Math.max(1, Math.round(v * scale)) : 0)
  let framed: OffscreenCanvas = canvas
  let fw = w
  let fh = h
  for (const b of borders) {
    const bt = scaled(b.top)
    const br = scaled(b.right)
    const bb = scaled(b.bottom)
    const bl = scaled(b.left)
    const next = new OffscreenCanvas(fw + bl + br, fh + bt + bb)
    const nctx = next.getContext('2d') as OffscreenCanvasRenderingContext2D
    nctx.fillStyle = b.colorTop
    nctx.fillRect(0, 0, next.width, bt)
    nctx.fillStyle = b.colorBottom
    nctx.fillRect(0, fh + bt, next.width, bb)
    nctx.fillStyle = b.colorLeft
    nctx.fillRect(0, bt, bl, fh)
    nctx.fillStyle = b.colorRight
    nctx.fillRect(fw + bl, bt, br, fh)
    nctx.drawImage(framed, bl, bt)
    framed = next
    fw = next.width
    fh = next.height
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
  const outCtx = framed.getContext('2d') as OffscreenCanvasRenderingContext2D
  drawLayers(outCtx, fw, fh, pictureLayers, assetCache)

  if (job.want === 'bitmap') {
    const out = await createImageBitmap(framed)
    post({ id: job.id, bitmap: out, srcBack: job.bitmap }, [out, job.bitmap])
  } else {
    const blob = await framed.convertToBlob({ type: 'image/jpeg', quality: job.quality })
    const bytes = await blob.arrayBuffer()
    post({ id: job.id, bytes, width: fw, height: fh, srcBack: job.bitmap }, [bytes, job.bitmap])
  }
}
