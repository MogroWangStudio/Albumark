import type { TextLayer, WatermarkLayer } from '@/types/watermark'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface LayerBox {
  cx: number
  cy: number
  w: number
  h: number
  rotation: number
}

export function fontString(l: TextLayer, fontSize: number): string {
  return `${l.italic ? 'italic ' : ''}${l.fontWeight} ${fontSize}px ${l.fontFamily}`
}

/** 计算图层在图片坐标系中的包围盒（含旋转前的宽高）。 */
export function measureLayer(
  layer: WatermarkLayer,
  imgW: number,
  imgH: number,
  mctx: Ctx2D,
): LayerBox {
  const long = Math.max(imgW, imgH)
  const cx = (layer.x / 100) * imgW
  const cy = (layer.y / 100) * imgH

  if (layer.type === 'image') {
    const h = (layer.scale / 100) * long
    return { cx, cy, w: h * layer.aspect, h, rotation: layer.rotation }
  }

  const fontSize = (layer.scale / 100) * long
  mctx.save()
  mctx.font = fontString(layer, fontSize)
  const spacing = (layer.letterSpacing / 100) * fontSize
  const lines = layer.content.split('\n')
  let w = 0
  for (const line of lines) {
    if (!line) continue
    let lw = 0
    for (const ch of line) lw += mctx.measureText(ch).width + spacing
    w = Math.max(w, lw - spacing)
  }
  mctx.restore()
  let h = lines.length * fontSize * layer.lineHeight
  if (layer.background.enabled) {
    const pad = (layer.background.padding / 100) * fontSize
    w += pad * 2
    h += pad * 2
  }
  return { cx, cy, w, h, rotation: layer.rotation }
}

/** 点（图片坐标系）是否落在图层包围盒内（按旋转求逆）。 */
export function hitTest(box: LayerBox, px: number, py: number): boolean {
  const rad = (-box.rotation * Math.PI) / 180
  const dx = px - box.cx
  const dy = py - box.cy
  const x = dx * Math.cos(rad) - dy * Math.sin(rad)
  const y = dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(x) <= box.w / 2 && Math.abs(y) <= box.h / 2
}
