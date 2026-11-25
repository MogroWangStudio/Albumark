/// <reference lib="webworker" />
import { applyAdjustments } from '../core/adjust'
import {
  backgroundAspect,
  blurRadiusPx,
  borderTotals,
  layoutBackgroundFrame,
  paintBorderBand,
  paintOverlay,
  paintPhotoOnBackground,
  renderBlurredCover,
} from '../core/bg'
import { drawLayers, type AssetMap } from '../core/draw'
import type { BackgroundLayer, BorderLayer, WatermarkLayer } from '../types/watermark'
import { cropRot, isCurvesNeutral, isCurveNeutral, isHslNeutral, type Adjustments, type Crop } from '../types/adjust'

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
  /**
   * 解码位图相对原图的缩放（≤1）。水印偏移 / 边框宽度 / 背景偏移与圆角都是
   * 「原图尺度」像素，必须按「原图 → 当前画布」的系数换算；预览为省内存会
   * 先把源图降采样解码，此时取样系数 scale 只到解码位图为止，两者相乘才是
   * 与导出（全分辨率解码）同源的 pxScale。缺省 1（导出 / 全分辨率解码）。
   */
  sourceScale?: number
  /** JPEG 质量 0-1（PNG 编码忽略） */
  quality: number
  want: 'bitmap' | 'jpeg' | 'png'
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
  const job = e.data.job
  void handle(job).catch((err) => {
    // 任务失败必须回报，否则主线程的 pending 永远挂起、渲染静默冻结。
    // 源位图是 transfer 进来的，不还回去主线程就永久失去了它——后续渲染
    // 只能重新解码整张照片（安卓上一次要数秒）。已 detach 时 transfer 会抛错，
    // 那就退回纯错误回报。
    const message = err instanceof Error ? err.message : String(err)
    try {
      post({ id: job.id, err: message, srcBack: job.bitmap }, [job.bitmap])
    } catch {
      post({ id: job.id, err: message })
    }
  })
})

async function handle(job: RenderJob): Promise<void> {
  let src: ImageBitmap | OffscreenCanvas = job.bitmap
  // 几何变换先行：翻转 → 绕中心旋转（包围盒画布，四角留空），裁剪矩形即定义在变换后的源上
  const c = job.crop
  const rot = cropRot(c)
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
  /**
   * 「原图尺度」长度（水印偏移 / 边框宽度 / 背景偏移与圆角）→ 本次画布的
   * 换算系数。预览会把源图先降采样再交给 Worker，scale 只能换算到解码位图；
   * 乘上 sourceScale 才回到原图基准，与导出（全分辨率解码、sourceScale=1）
   * 完全同源——这是缩放查看时水印 / 圆角不漂移的前提。
   */
  const pxScale = scale * Math.max(0.0001, job.sourceScale ?? 1)
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
    (a.denoise ?? 0) > 0 ||
    !isHslNeutral(a.hsl) ||
    !isCurvesNeutral(a.curves) ||
    !isCurveNeutral(a.curve)
  ) {
    const image = ctx.getImageData(0, 0, w, h)
    applyAdjustments(image.data, w, h, a)
    ctx.putImageData(image, 0, 0)
  }

  // 背景水印存在时改变整条合成路径：边框从「扩展画布」改为「照片外围环带」，
  // 背景图铺满最终画布（照片 + 背景外扩），照片带缩放 / 偏移 / 圆角 / 阴影
  // 浮于其上，文字 / 图片水印在最上层。布局与绘制走 core/bg.ts 共享实现，
  // 与预览主线程组合、工作室样张保持同一几何。
  const bgLayers = job.layers.filter((l): l is BackgroundLayer => l.type === 'background' && l.visible)
  const borders = job.layers.filter((l): l is BorderLayer => l.type === 'border' && l.visible)
  const pictureLayers = job.layers.filter((l) => l.type !== 'border' && l.type !== 'background')
  // 预览（want=bitmap）不在 Worker 里合成背景：背景与照片效果由主线程即时
  // 组合（拖动 / 滑杆零 Worker 往返），Worker 只输出照片 + 边框环带位图；
  // 导出（jpeg/png）在这里完整合成
  const composeBg = job.want !== 'bitmap' && bgLayers.length > 0
  const scaled = (v: number): number => (v > 0 ? Math.max(1, Math.round(v * pxScale)) : 0)
  let framed: OffscreenCanvas = canvas
  let fw = w
  let fh = h
  let photoOffset = { x: 0, y: 0 }

  if (bgLayers.length > 0) {
    // 边框环带：贴照片外围，不扩展画布（预览 / 导出同一实现）。
    // 传入的 canvas 必是 OffscreenCanvas：无边框时原样返回、有边框时返回新画布
    const band = paintBorderBand(canvas, borders, pxScale)
    framed = band as OffscreenCanvas
    if (composeBg) {
      // 完整合成（导出）：背景 → 照片（缩放 / 偏移 / 圆角 / 阴影）→ 水印
      const bg = bgLayers[0]
      const layout = layoutBackgroundFrame(bg, w, h, backgroundAspect(bg, w, h), pxScale)
      const frame = new OffscreenCanvas(layout.frameW, layout.frameH)
      const fctx = frame.getContext('2d') as OffscreenCanvasRenderingContext2D
      // 列表靠前者更贴近照片（更上层）：从列表末尾往前画
      for (let i = bgLayers.length - 1; i >= 0; i--) {
        const b = bgLayers[i]
        const src: ImageBitmap | OffscreenCanvas | null =
          b.source === 'custom' ? (assetCache.get(b.assetId ?? '') ?? null) : canvas
        if (!src) continue // custom 素材缺失：跳过该层，露出下层或透明
        const blurred = renderBlurredCover(
          src,
          layout.frameW,
          layout.frameH,
          blurRadiusPx(b, layout.frameW, layout.frameH),
        )
        fctx.drawImage(blurred, 0, 0)
        paintOverlay(fctx, b, layout.frameW, layout.frameH)
      }
      paintPhotoOnBackground(fctx, band, w, h, layout, bg, borders, pxScale)
      measureCtx()
      // 水印坐标系是照片区域：背景外扩只改变照片占比，锚点跟随照片
      fctx.save()
      fctx.translate(layout.photoX, layout.photoY)
      drawLayers(fctx, layout.photoW, layout.photoH, pictureLayers, assetCache, pxScale)
      fctx.restore()
      framed = frame
      fw = layout.frameW
      fh = layout.frameH
      photoOffset = { x: Math.round(layout.photoX), y: Math.round(layout.photoY) }
    } else {
      // 预览：输出照片 + 环带位图，几何信息交给主线程组合。
      // 环带左右 / 上下可以不等宽，照片偏移按各自的环带宽度报（不能再用居中假设）
      const tot = borderTotals(borders)
      fw = band.width
      fh = band.height
      photoOffset = {
        x: Math.round(tot.left * pxScale),
        y: Math.round(tot.top * pxScale),
      }
    }
  } else {
    // 无背景水印：边框逐层向外扩展画布，图层列表靠前者更贴近照片。
    // 边框宽度按取样缩放系数等比折算，保证预览（缩放渲染）与导出的边框比例一致
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
      photoOffset = { x: photoOffset.x + bl, y: photoOffset.y + bt }
    }
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
  // 背景导出已在照片坐标系里画过水印，这里只处理无背景路径，避免二次绘制
  if (!composeBg) {
    // pxScale：水印偏移是原图尺度像素，预览（缩小 / 降采样渲染）与导出必须同一折算
    drawLayers(outCtx, fw, fh, pictureLayers, assetCache, pxScale)
  }

  if (job.want === 'bitmap') {
    const out = await createImageBitmap(framed)
    post(
      {
        id: job.id,
        bitmap: out,
        srcBack: job.bitmap,
        /** 照片（不含边框环带）在输出位图中的位置与尺寸，预览主线程组合用 */
        photoOffset,
        photoSize: { w, h },
        /** 原图尺度 → 输出位图的真实换算系数（已含解码降采样） */
        renderScale: pxScale,
      },
      [out, job.bitmap],
    )
  } else {
    const type = job.want === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await framed.convertToBlob({ type, quality: job.quality })
    const bytes = await blob.arrayBuffer()
    post({ id: job.id, bytes, width: fw, height: fh, srcBack: job.bitmap }, [bytes, job.bitmap])
  }
}
