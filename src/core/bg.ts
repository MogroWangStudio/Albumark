import type { BackgroundLayer, BorderLayer } from '@/types/watermark'

/**
 * 背景水印的共享绘制核心：布局、背景铺满模糊、照片投影 / 圆角绘制。
 * 渲染 Worker（导出完整合成）、预览画布（主线程组合，拖动 / 滑杆零 Worker
 * 往返）、水印工作室样张与图库缩略图四处共用同一份实现——预览与导出
 * 所见即所得由这里保证。
 */

export type PaintSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas
export type BgCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** 边框各边的总宽度（多层边框累加）。有背景时边框以「环带」画在照片外围。 */
export function borderTotals(borders: BorderLayer[]): {
  top: number
  right: number
  bottom: number
  left: number
} {
  const t = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const b of borders) {
    t.top += b.top
    t.right += b.right
    t.bottom += b.bottom
    t.left += b.left
  }
  return t
}

/** 背景图宽高比：custom 取素材比例，self（当前照片自身）取照片比例。 */
export function backgroundAspect(bg: BackgroundLayer, photoW: number, photoH: number): number {
  if (bg.source === 'custom') return bg.aspect && bg.aspect > 0 ? bg.aspect : 1
  return photoH > 0 ? photoW / photoH : 1
}

export interface BgFrameLayout {
  /** 最终画布尺寸（照片 + 背景外扩） */
  frameW: number
  frameH: number
  /** 照片矩形在画布中的位置与尺寸（已含 photoScale 与 offsetX/Y） */
  photoX: number
  photoY: number
  photoW: number
  photoH: number
}

/**
 * 背景水印的画布布局。w/h 为照片（裁剪后、不含边框）在当前渲染分辨率下的
 * 尺寸；pxScale 把「原图尺度」的偏移 / 圆角折算到该分辨率（导出缩放、
 * 预览低清渲染、缩略图各不相同，传入对应系数即可）。
 *
 * fit=background：画布按背景图宽高比适配照片（照片完整置于画布内），
 * 「外扩程度」决定照片的面积占比余量——0 为贴边基准，100 时照片约占
 * 画布四分之一面积。fit=custom：横 / 纵外扩按照片边长百分比、两侧对称。
 */
export function layoutBackgroundFrame(
  bg: BackgroundLayer,
  w: number,
  h: number,
  bgAspect: number,
  pxScale: number,
): BgFrameLayout {
  let frameW: number
  let frameH: number
  if (bg.fit === 'custom') {
    frameW = Math.round(w + 2 * w * (bg.expandX / 100))
    frameH = Math.round(h + 2 * h * (bg.expandY / 100))
  } else {
    // 程度 0-100 → 照片面积占比 1 → 0.25
    const fill = 1 - (Math.min(100, Math.max(0, bg.expand)) / 100) * 0.75
    const area = (w * h) / Math.max(0.05, fill)
    const r = Math.max(0.05, bgAspect)
    // 画布保持背景图比例（frameW/frameH = r），面积取 fill 折算值
    frameW = Math.max(w, Math.round(Math.sqrt(area * r)))
    frameH = Math.max(h, Math.round(Math.sqrt(area / r)))
  }
  const s = bg.photoScale / 100
  const photoW = w * s
  const photoH = h * s
  return {
    frameW,
    frameH,
    photoX: (frameW - photoW) / 2 + bg.offsetX * pxScale,
    photoY: (frameH - photoH) / 2 + bg.offsetY * pxScale,
    photoW,
    photoH,
  }
}

/** 圆角矩形路径（draw.ts 的 roundRectFill 同款几何，只建路径不填充）。 */
export function roundRectPath(ctx: BgCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** 高斯模糊强度（0-100）→ 模糊半径（画布长边的百分比，封顶约 6%）。 */
export function blurRadiusPx(bg: BackgroundLayer, frameW: number, frameH: number): number {
  return (bg.blur / 100) * Math.max(frameW, frameH) * 0.06
}

/**
 * 背景位图按 cover 铺满画布并施加高斯模糊，返回画好的画布（尺寸恰为
 * fw×fh）。大半径先降采样再模糊再放大（大模糊本就是低频信息，视觉等效、
 * 开销大幅下降）；绘制范围向四周外溢一个模糊半径再裁回，避免边缘半透明。
 * srcRect 可指定源位图中作为背景的子区域（预览里 self 背景取照片部分，
 * 不含边框环带）。调用方可按（源、模糊量、尺寸）缓存返回值。
 */
export function renderBlurredCover(
  bmp: PaintSource,
  fw: number,
  fh: number,
  blurPx: number,
  srcRect?: { x: number; y: number; w: number; h: number },
): OffscreenCanvas {
  const blur = Math.max(0, blurPx)
  const sx = srcRect?.x ?? 0
  const sy = srcRect?.y ?? 0
  const sw = srcRect?.w ?? bmp.width
  const sh = srcRect?.h ?? bmp.height
  // 降采样系数：模糊半径越大越不需要全分辨率，上限 4
  const ds = blur > 8 ? Math.min(4, Math.max(1, blur / 8)) : 1
  const tw = Math.max(1, Math.round((fw + blur * 2) / ds))
  const th = Math.max(1, Math.round((fh + blur * 2) / ds))
  const t = new OffscreenCanvas(tw, th)
  const tctx = t.getContext('2d') as OffscreenCanvasRenderingContext2D
  tctx.imageSmoothingQuality = 'high'
  // cover：铺满（含外溢区域），居中裁剪
  const scale = Math.max(tw / sw, th / sh)
  const dw = sw * scale
  const dh = sh * scale
  tctx.drawImage(bmp, sx, sy, sw, sh, (tw - dw) / 2, (th - dh) / 2, dw, dh)

  const out = new OffscreenCanvas(Math.max(1, Math.round(fw)), Math.max(1, Math.round(fh)))
  const octx = out.getContext('2d') as OffscreenCanvasRenderingContext2D
  octx.imageSmoothingQuality = 'high'
  if (blur > 0) octx.filter = `blur(${(blur / ds).toFixed(2)}px)`
  octx.drawImage(t, -blur, -blur, fw + blur * 2, fh + blur * 2)
  return out
}

/** 照片阴影参数：强度 0-100 → 模糊半径 / 不透明度 / 下移量（按画布长边折算）。 */
export function photoShadow(bg: BackgroundLayer, frameW: number, frameH: number): {
  blur: number
  alpha: number
  offsetY: number
} {
  const long = Math.max(frameW, frameH)
  const k = bg.shadow / 100
  return { blur: k * long * 0.03, alpha: k * 0.55, offsetY: k * long * 0.012 }
}

/**
 * 把照片（可含边框环带）绘制到背景画布上：先按外轮廓投下圆角矩形阴影，
 * 再按圆角裁剪、等比缩放绘制。photo 为照片 + 环带位图，photoW/H 为其中
 * 照片部分在当前渲染分辨率下的尺寸，layout.photoW/H 为目标显示尺寸。
 * 环带是照片的边框，随照片等比缩放；圆角作用于「照片 + 环带」组合外轮廓
 * （环带总宽按缩放折算后叠加到圆角半径上）。
 */
export function paintPhotoOnBackground(
  ctx: BgCtx,
  photo: PaintSource,
  photoW: number,
  photoH: number,
  layout: BgFrameLayout,
  bg: BackgroundLayer,
  borders: BorderLayer[],
  pxScale: number,
): void {
  const tot = borderTotals(borders)
  // 照片缩放系数；位图整体（照片 + 环带）一起缩放
  const s = layout.photoW / Math.max(1, photoW)
  const bandL = tot.left * pxScale * s
  const bandT = tot.top * pxScale * s
  const dx = layout.photoX - bandL
  const dy = layout.photoY - bandT
  const dw = (photoW + (tot.left + tot.right) * pxScale) * s
  const dh = (photoH + (tot.top + tot.bottom) * pxScale) * s
  const radius = bg.radius * pxScale * s + Math.max(bandL, bandT, tot.right * pxScale * s, tot.bottom * pxScale * s)

  ctx.save()
  if (bg.shadow > 0) {
    const sh = photoShadow(bg, layout.frameW, layout.frameH)
    // 先填充外轮廓路径投下阴影：照片不透明，填充本身会被完全盖住
    ctx.save()
    ctx.shadowColor = `rgba(0, 0, 0, ${sh.alpha.toFixed(3)})`
    ctx.shadowBlur = sh.blur
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = sh.offsetY
    ctx.fillStyle = '#000000'
    roundRectPath(ctx, dx, dy, dw, dh, radius)
    ctx.fill()
    ctx.restore()
  }
  if (bg.radius > 0 || borders.length > 0) {
    roundRectPath(ctx, dx, dy, dw, dh, radius)
    ctx.clip()
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, dx, dy, dw, dh)
  ctx.restore()
}

/**
 * 有背景水印时把边框画成照片外围的「环带」（不扩展画布），返回含环带的
 * 照片位图（无边框时原样返回照片）。列表靠前者更贴近照片（画在内层），
 * 与边框扩展画布的顺序一致。
 */
export function paintBorderBand(
  photo: PaintSource,
  borders: BorderLayer[],
  pxScale: number,
): PaintSource {
  const tot = borderTotals(borders)
  const bt = Math.round(tot.top * pxScale)
  const br = Math.round(tot.right * pxScale)
  const bb = Math.round(tot.bottom * pxScale)
  const bl = Math.round(tot.left * pxScale)
  if (!bt && !br && !bb && !bl) return photo
  const band = new OffscreenCanvas(photo.width + bl + br, photo.height + bt + bb)
  const ctx = band.getContext('2d') as OffscreenCanvasRenderingContext2D
  // 从最外层往里逐层画色环，最后放照片：与扩展画布版顺序一致
  let rx = 0
  let ry = 0
  let rw = band.width
  let rh = band.height
  for (let i = borders.length - 1; i >= 0; i--) {
    const b = borders[i]
    const t = Math.round(b.top * pxScale)
    const r = Math.round(b.right * pxScale)
    const bo = Math.round(b.bottom * pxScale)
    const l = Math.round(b.left * pxScale)
    ctx.fillStyle = b.colorTop
    ctx.fillRect(rx, ry, rw, t)
    ctx.fillStyle = b.colorBottom
    ctx.fillRect(rx, ry + rh - bo, rw, bo)
    ctx.fillStyle = b.colorLeft
    ctx.fillRect(rx, ry + t, l, rh - t - bo)
    ctx.fillStyle = b.colorRight
    ctx.fillRect(rx + rw - r, ry + t, r, rh - t - bo)
    rx += l
    ry += t
    rw -= l + r
    rh -= t + bo
  }
  ctx.drawImage(photo, bl, bt)
  return band
}
