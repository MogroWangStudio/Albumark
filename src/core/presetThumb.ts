import { applyAdjustments } from './adjust'
import type { Adjustments } from '@/types/adjust'

/**
 * 调节预设卡片的缩略图。
 *
 * 预览用「当前照片 + 预设参数」实时算出：卡片上的画面就是套用后的大致效果，
 * 比一枚色块更能说明问题。素材取图库缩略图（长边 240px），在 2× 尺寸下绘制，
 * 逐像素调节走与导出完全相同的 applyAdjustments 管线，所见即所得。
 *
 * 没有照片时用一张内置的合成样张（天空 / 夕阳 / 远山 / 暗部），
 * 足以体现曝光、对比、色温与分色差异。
 */

/** 缩略图输出尺寸：卡片显示宽度约 136px，按 2× 留足清晰度，16:10 与模板卡片一致 */
export const PRESET_THUMB_W = 272
export const PRESET_THUMB_H = 170

function makeCtx(w: number, h: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas.getContext('2d', { willReadFrequently: true })
}

/** 内置回退样张：只画一次，之后复用同一份像素 */
let fallback: ImageData | null = null

function fallbackBase(): ImageData {
  if (fallback) return fallback
  const w = PRESET_THUMB_W
  const h = PRESET_THUMB_H
  const ctx = makeCtx(w, h)
  if (!ctx) return new ImageData(w, h)

  // 天空：深蓝过渡到地平线的暖橘，覆盖从暗到亮的完整层次
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#24405e')
  sky.addColorStop(0.4, '#6f93b6')
  sky.addColorStop(0.7, '#e2b087')
  sky.addColorStop(1, '#f3d6b6')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // 夕阳：中高调最容易被推爆的位置，正好检验高光回收
  const sun = ctx.createRadialGradient(w * 0.72, h * 0.36, 0, w * 0.72, h * 0.36, h * 0.42)
  sun.addColorStop(0, 'rgba(255, 248, 231, 0.96)')
  sun.addColorStop(0.35, 'rgba(255, 219, 168, 0.52)')
  sun.addColorStop(1, 'rgba(255, 196, 128, 0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, w, h)

  // 远山：低饱和青绿，用来看去雾与分色是否把山林染偏
  ctx.fillStyle = '#5c7c7b'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.64)
  ctx.bezierCurveTo(w * 0.2, h * 0.5, w * 0.34, h * 0.66, w * 0.52, h * 0.6)
  ctx.bezierCurveTo(w * 0.72, h * 0.53, w * 0.86, h * 0.64, w, h * 0.58)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()

  // 近景暗部：阴影一提就死的区域，能直接看出黑位处理
  ctx.fillStyle = '#2b403f'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.82)
  ctx.bezierCurveTo(w * 0.28, h * 0.72, w * 0.46, h * 0.88, w * 0.7, h * 0.8)
  ctx.bezierCurveTo(w * 0.86, h * 0.75, w * 0.94, h * 0.8, w, h * 0.78)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()

  // 前景小舟：一处高对比细节，检验清晰度与锐化
  ctx.fillStyle = '#1b2a2a'
  ctx.beginPath()
  ctx.ellipse(w * 0.34, h * 0.86, w * 0.07, h * 0.022, -0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(238, 232, 220, 0.75)'
  ctx.lineWidth = Math.max(1, h * 0.008)
  ctx.beginPath()
  ctx.moveTo(w * 0.34, h * 0.855)
  ctx.lineTo(w * 0.34, h * 0.72)
  ctx.stroke()

  fallback = ctx.getImageData(0, 0, w, h)
  return fallback
}

/** 以 cover 方式铺满画布（与卡片裁切一致，不变形） */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
): void {
  const iw = img.width || 1
  const ih = img.height || 1
  const s = Math.max(PRESET_THUMB_W / iw, PRESET_THUMB_H / ih)
  const dw = iw * s
  const dh = ih * s
  ctx.drawImage(img, (PRESET_THUMB_W - dw) / 2, (PRESET_THUMB_H - dh) / 2, dw, dh)
}

/** 同一张图库缩略图只解一次；工作区里来回切照片时不会反复解码 */
const baseCache = new Map<string, ImageData>()
const BASE_CACHE_LIMIT = 6

/**
 * 取一张预设预览的底图。
 * @param thumbUrl 当前照片的图库缩略图 URL；为空时用内置样张
 */
export async function buildPresetBase(thumbUrl?: string): Promise<ImageData> {
  if (!thumbUrl) return fallbackBase()
  const hit = baseCache.get(thumbUrl)
  if (hit) return hit
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = thumbUrl
    await img.decode()
    const ctx = makeCtx(PRESET_THUMB_W, PRESET_THUMB_H)
    if (!ctx) return fallbackBase()
    drawCover(ctx, img)
    const data = ctx.getImageData(0, 0, PRESET_THUMB_W, PRESET_THUMB_H)
    if (baseCache.size >= BASE_CACHE_LIMIT) {
      const oldest = baseCache.keys().next().value
      if (oldest) baseCache.delete(oldest)
    }
    baseCache.set(thumbUrl, data)
    return data
  } catch {
    // 缩略图尚未生成 / 已被回收：回退到内置样张，卡片不至于空白
    return fallbackBase()
  }
}

interface ThumbJob {
  canvas: HTMLCanvasElement
  base: ImageData
  values: Adjustments
}

const queue: ThumbJob[] = []
let flushing = false

/** 真正执行一次绘制：复制底图 → 全管线调节 → 写回画布 */
function paintNow(job: ThumbJob): void {
  const { canvas, base, values } = job
  const data = new Uint8ClampedArray(base.data)
  applyAdjustments(data, base.width, base.height, values)
  if (canvas.width !== base.width || canvas.height !== base.height) {
    canvas.width = base.width
    canvas.height = base.height
  }
  const ctx = canvas.getContext('2d')
  ctx?.putImageData(new ImageData(data, base.width, base.height), 0, 0)
}

/**
 * 排队绘制。预设多时逐个出图而不是开面板的瞬间算完——
 * 一次同步算十几张 2× 缩略图会明显卡住展开动画。
 */
export function requestPresetThumb(
  canvas: HTMLCanvasElement,
  base: ImageData,
  values: Adjustments,
): void {
  const job: ThumbJob = { canvas, base, values }
  const i = queue.findIndex((j) => j.canvas === canvas)
  if (i >= 0) queue[i] = job
  else queue.push(job)
  if (flushing) return
  flushing = true
  // 每帧两张：出图有节奏，也不与展开动画抢主线程
  window.setTimeout(function step() {
    for (let n = 0; n < 2; n++) {
      const next = queue.shift()
      if (!next) break
      paintNow(next)
    }
    if (queue.length) window.setTimeout(step, 16)
    else flushing = false
  }, 0)
}

/** 卡片卸载时撤掉还没轮到的那一帧 */
export function cancelPresetThumb(canvas: HTMLCanvasElement): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].canvas === canvas) queue.splice(i, 1)
  }
}
