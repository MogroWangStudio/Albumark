import { drawLayers, type AssetMap } from './draw'
import { resolveTokens } from './tokens'
import type { SerializedAsset, WatermarkLayer } from '@/types/watermark'

/** 样张尺寸：工作室预览与模板缩略图共用同一构图 */
export const SAMPLE_W = 1600
export const SAMPLE_H = 1067

/** 生成一张干净的样张（渐变天空 + 地平线），画到任意 2D 上下文上 */
export function drawSample(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72)
  sky.addColorStop(0, '#2b3a4a')
  sky.addColorStop(0.65, '#6e7f8c')
  sky.addColorStop(1, '#c9b8a3')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h * 0.72)
  // 太阳
  ctx.fillStyle = 'rgba(255, 214, 156, 0.9)'
  ctx.beginPath()
  ctx.arc(w * 0.68, h * 0.4, h * 0.11, 0, Math.PI * 2)
  ctx.fill()
  // 地面
  const ground = ctx.createLinearGradient(0, h * 0.72, 0, h)
  ground.addColorStop(0, '#4a4238')
  ground.addColorStop(1, '#2a2620')
  ctx.fillStyle = ground
  ctx.fillRect(0, h * 0.72, w, h * 0.28)
  // 远山剪影
  ctx.fillStyle = 'rgba(38, 34, 30, 0.85)'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.72)
  ctx.lineTo(w * 0.22, h * 0.55)
  ctx.lineTo(w * 0.4, h * 0.72)
  ctx.lineTo(w * 0.56, h * 0.6)
  ctx.lineTo(w * 0.78, h * 0.72)
  ctx.closePath()
  ctx.fill()
}

/** 位图版样张：工作室画布 drawImage 用 */
export async function makeSampleBitmap(): Promise<ImageBitmap> {
  const oc = new OffscreenCanvas(SAMPLE_W, SAMPLE_H)
  const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D
  drawSample(ctx, SAMPLE_W, SAMPLE_H)
  return await createImageBitmap(oc)
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

/** 模板缩略图：在画布上按样张构图渲染一组水印图层（令牌替换为样例值） */
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
  const fit = Math.min(cw / SAMPLE_W, ch / SAMPLE_H)
  ctx.translate((cw - SAMPLE_W * fit) / 2, (ch - SAMPLE_H * fit) / 2)
  ctx.scale(fit, fit)
  drawSample(ctx, SAMPLE_W, SAMPLE_H)
  const resolved = layers.map((l) =>
    l.type === 'text' ? { ...l, content: resolveTokens(l.content, undefined, '样张') } : l,
  )
  const bmps = await assetBitmaps(assets)
  drawLayers(ctx, SAMPLE_W, SAMPLE_H, resolved, bmps)
  for (const b of bmps.values()) b.close()
}
