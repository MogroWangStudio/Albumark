import { drawLayers, type AssetMap } from './draw'
import { resolveTokens, SAMPLE_EXIF } from './tokens'
import type { SerializedAsset, WatermarkLayer } from '@/types/watermark'
import landscapeUrl from '@/assets/samples/studio-landscape.jpg'
import portraitUrl from '@/assets/samples/studio-portrait.jpg'

/**
 * 工作室样张：横 / 竖两张品牌底图（1920×1080 / 1080×1920）。
 * 尺寸与素材文件保持一致——画布、命中测试、边框扩展都以这里的宽高为基准。
 */
export const SAMPLE_VARIANTS = {
  landscape: { url: landscapeUrl, w: 1920, h: 1080 },
  portrait: { url: portraitUrl, w: 1080, h: 1920 },
} as const

export type SampleOrientation = keyof typeof SAMPLE_VARIANTS

/** 生成一张干净的样张（黄昏海面），画到任意 2D 上下文上 */
export function drawSample(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  // 天空：黄昏的暖橙过渡到暮蓝
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62)
  sky.addColorStop(0, '#31456b')
  sky.addColorStop(0.45, '#7a6a8e')
  sky.addColorStop(0.8, '#d98e6a')
  sky.addColorStop(1, '#f2b57c')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h * 0.62)
  // 太阳与柔光晕
  const sunX = w * 0.66
  const sunY = h * 0.5
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.3)
  halo.addColorStop(0, 'rgba(255, 226, 178, 0.85)')
  halo.addColorStop(1, 'rgba(255, 226, 178, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, w, h * 0.62)
  ctx.fillStyle = '#ffe4b8'
  ctx.beginPath()
  ctx.arc(sunX, sunY, h * 0.085, 0, Math.PI * 2)
  ctx.fill()
  // 远山剪影
  ctx.fillStyle = 'rgba(52, 44, 62, 0.9)'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.62)
  ctx.lineTo(w * 0.16, h * 0.48)
  ctx.lineTo(w * 0.34, h * 0.62)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(w * 0.72, h * 0.62)
  ctx.lineTo(w * 0.9, h * 0.51)
  ctx.lineTo(w, h * 0.62)
  ctx.closePath()
  ctx.fill()
  // 海面：暮色反光
  const sea = ctx.createLinearGradient(0, h * 0.62, 0, h)
  sea.addColorStop(0, '#8a6a74')
  sea.addColorStop(0.4, '#4c4258')
  sea.addColorStop(1, '#2b2733')
  ctx.fillStyle = sea
  ctx.fillRect(0, h * 0.62, w, h * 0.38)
  // 太阳在海面的碎光
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#ffd9a0'
  const glareW = w * 0.16
  for (let i = 0; i < 7; i++) {
    const gy = h * (0.63 + i * 0.05)
    const gw = glareW * (1 - i * 0.09) * (0.7 + ((i * 37) % 10) / 18)
    ctx.fillRect(sunX - gw / 2, gy, gw, h * 0.012)
  }
  ctx.restore()
  // 近景暗浪
  ctx.fillStyle = 'rgba(30, 26, 38, 0.65)'
  ctx.fillRect(0, h * 0.9, w, h * 0.1)
}

export interface PaintComposedResult {
  /** 照片区域在最终画布上的偏移（边框扩展量） */
  photoX: number
  photoY: number
  /** 最终画布尺寸（照片 + 边框扩展） */
  frameW: number
  frameH: number
}

/**
 * 把照片与一组水印图层合成绘制到 ctx 上：先按图层列表从外到内画出边框层
 * （列表越靠前越贴近照片），再画照片与文字 / 图片水印。
 * 与渲染 Worker 的画布扩展顺序完全一致。返回照片偏移与最终画布尺寸。
 */
export function paintComposed(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sampleBmp: ImageBitmap,
  baseW: number,
  baseH: number,
  layers: WatermarkLayer[],
  assets: AssetMap,
): PaintComposedResult {
  const borders = layers.filter(
    (l): l is Extract<WatermarkLayer, { type: 'border' }> => l.type === 'border' && l.visible,
  )
  const others = layers.filter((l) => l.type !== 'border')
  let extL = 0
  let extT = 0
  let extR = 0
  let extB = 0
  for (const b of borders) {
    extL += b.left
    extT += b.top
    extR += b.right
    extB += b.bottom
  }
  const frameW = baseW + extL + extR
  const frameH = baseH + extT + extB
  // 从最外层往里逐层画边框色，最后画照片与水印
  let rx = 0
  let ry = 0
  let rw = frameW
  let rh = frameH
  for (let i = borders.length - 1; i >= 0; i--) {
    const b = borders[i]
    ctx.fillStyle = b.colorTop
    ctx.fillRect(rx, ry, rw, b.top)
    ctx.fillStyle = b.colorBottom
    ctx.fillRect(rx, ry + rh - b.bottom, rw, b.bottom)
    ctx.fillStyle = b.colorLeft
    ctx.fillRect(rx, ry + b.top, b.left, rh - b.top - b.bottom)
    ctx.fillStyle = b.colorRight
    ctx.fillRect(rx + rw - b.right, ry + b.top, b.right, rh - b.top - b.bottom)
    rx += b.left
    ry += b.top
    rw -= b.left + b.right
    rh -= b.top + b.bottom
  }
  ctx.drawImage(sampleBmp, rx, ry)
  ctx.save()
  ctx.translate(rx, ry)
  drawLayers(ctx, baseW, baseH, others, assets)
  ctx.restore()
  return { photoX: rx, photoY: ry, frameW, frameH }
}

/**
 * 位图版样张：读取 @/assets 里的品牌底图（Vite 会把它们打进构建产物）。
 * 素材缺失或被拦截时回退到手绘样张，画布不会空着——工作室仍然可用。
 */
export async function loadSampleBitmap(
  variant: { url: string; w: number; h: number } = SAMPLE_VARIANTS.landscape,
): Promise<ImageBitmap> {
  try {
    const img = new Image()
    // 先挂事件再设 src：缓存命中也一定会走 onload，不会漏掉回调
    const ready = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('样张素材加载失败'))
    })
    img.src = variant.url
    await ready
    return await createImageBitmap(img)
  } catch {
    // 素材缺失时回退到手绘样张：工作室仍然可用，只是看不到品牌底图
    const oc = new OffscreenCanvas(variant.w, variant.h)
    const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D
    drawSample(ctx, variant.w, variant.h)
    return await createImageBitmap(oc)
  }
}

/** 素材 dataUrl → 位图（模板缩略图渲染用） */
async function assetBitmaps(list: SerializedAsset[]): Promise<AssetMap> {
  const m: AssetMap = new Map()
  for (const a of list) {
    try {
      const blob = await (await fetch(a.dataUrl)).blob()
      m.set(a.id, await createImageBitmap(blob))
    } catch {
      /* 跳过无效素材 */
    }
  }
  return m
}

/** 模板缩略图的样张位图：模块内惰性生成一份供各处复用 */
let thumbSampleBmp: ImageBitmap | null = null
async function ensureThumbSample(): Promise<ImageBitmap> {
  if (!thumbSampleBmp) thumbSampleBmp = await loadSampleBitmap(SAMPLE_VARIANTS.landscape)
  return thumbSampleBmp
}

/** 模板缩略图：在画布上按样张构图渲染一组水印图层（令牌替换为样例值，含边框层） */
export async function renderTemplateThumb(
  canvas: HTMLCanvasElement,
  layers: WatermarkLayer[],
  assets: SerializedAsset[],
): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const cw = Math.max(1, Math.round(rect.width * dpr))
  const ch = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const resolved = layers.map((l) =>
    l.type === 'text' ? { ...l, content: resolveTokens(l.content, SAMPLE_EXIF, '样张') } : l,
  )
  // 先算含边框的最终画布尺寸，再按容器适应。
  // 基准尺寸以样张位图自身为准：素材换了尺寸也不会错位
  const sample = await ensureThumbSample()
  const baseW = sample.width
  const baseH = sample.height
  let extL = 0
  let extT = 0
  let extR = 0
  let extB = 0
  for (const l of resolved) {
    if (l.type === 'border' && l.visible) {
      extL += l.left
      extT += l.top
      extR += l.right
      extB += l.bottom
    }
  }
  const frameW = baseW + extL + extR
  const frameH = baseH + extT + extB
  const fit = Math.min(cw / frameW, ch / frameH)
  ctx.translate((cw - frameW * fit) / 2, (ch - frameH * fit) / 2)
  ctx.scale(fit, fit)
  const bmps = await assetBitmaps(assets)
  paintComposed(ctx, sample, baseW, baseH, resolved, bmps)
  for (const b of bmps.values()) b.close()
}
