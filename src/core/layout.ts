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

/** 九宫格锚点在图片中的坐标（0/0.5/1 比例 → 像素）。 */
export function anchorPoint(anchor: string, imgW: number, imgH: number): { x: number; y: number } {
  const row = anchor.startsWith('top') ? 0 : anchor.startsWith('middle') ? 1 : 2
  const col = anchor.endsWith('left') ? 0 : anchor.endsWith('center') ? 1 : 2
  return { x: (col / 2) * imgW, y: (row / 2) * imgH }
}

/** 图层定位点：锚点 + 偏移（像素）。文字框锚点决定文字框的哪个位置对准这个点。 */
export function layerPivot(l: WatermarkLayer, imgW: number, imgH: number): { x: number; y: number } {
  const a = anchorPoint(l.anchor, imgW, imgH)
  return { x: a.x + l.offsetX, y: a.y + l.offsetY }
}

/** 文字框锚点在框内的位置（top-left = 左上角原点）。缺省按「居中」处理。 */
function boxAnchorPoint(l: TextLayer, w: number, h: number): { x: number; y: number } {
  const ba = l.boxAnchor ?? 'middle-center'
  const col = ba.endsWith('left') ? 0 : ba.endsWith('center') ? 1 : 2
  const row = ba.startsWith('top') ? 0 : ba.startsWith('middle') ? 1 : 2
  return { x: (col / 2) * w, y: (row / 2) * h }
}

export interface TextMetricsResult {
  lines: string[]
  /** 每行像素宽度（已含字距） */
  widths: number[]
  /** 全部行中的最大上升/下降高度（px） */
  ascent: number
  descent: number
  /** 行距（px） */
  lh: number
  /** 纯文字内容高度（不含背景内边距） */
  contentH: number
  contentW: number
}

/**
 * 文字排版度量：包围盒与实际绘制共用这一份结果，
 * 保证碰撞箱与文字本身贴合（行高只影响行间，不包裹首尾）。
 */
export function textMetrics(l: TextLayer, fontSize: number, ctx: Ctx2D): TextMetricsResult {
  ctx.save()
  ctx.font = fontString(l, fontSize)
  const spacing = (l.letterSpacing / 100) * fontSize
  const lines = l.content.split('\n')
  const widths: number[] = []
  let ascent = 0
  let descent = 0
  for (const line of lines) {
    if (!line) {
      widths.push(0)
      continue
    }
    let lw = 0
    for (const ch of line) lw += ctx.measureText(ch).width + spacing
    widths.push(Math.max(0, lw - spacing))
    const m = ctx.measureText(line)
    // 老引擎没有 actualBoundingBox*，退回到经验值
    ascent = Math.max(ascent, m.actualBoundingBoxAscent || fontSize * 0.8)
    descent = Math.max(descent, m.actualBoundingBoxDescent || fontSize * 0.24)
  }
  ctx.restore()
  const lh = fontSize * l.lineHeight
  const n = Math.max(1, lines.length)
  return {
    lines,
    widths,
    ascent,
    descent,
    lh,
    contentH: (n - 1) * lh + ascent + descent,
    contentW: Math.max(...widths, 0),
  }
}

/** 计算图层在图片坐标系中的包围盒（含旋转前的宽高）。 */
export function measureLayer(
  layer: WatermarkLayer,
  imgW: number,
  imgH: number,
  mctx: Ctx2D,
): LayerBox {
  const long = Math.max(imgW, imgH)
  const pivot = layerPivot(layer, imgW, imgH)

  if (layer.type === 'image') {
    const h = (layer.scale / 100) * long
    return { cx: pivot.x, cy: pivot.y, w: h * layer.aspect, h, rotation: layer.rotation }
  }

  const fontSize = (layer.scale / 100) * long
  const m = textMetrics(layer, fontSize, mctx)
  let w = m.contentW
  let h = m.contentH
  if (layer.background.enabled) {
    const pad = (layer.background.padding / 100) * fontSize
    w += pad * 2
    h += pad * 2
  }
  // 文字框锚点：框上 boxAnchorPoint 处对准定位点（居中时框中心 = 定位点）
  const ap = boxAnchorPoint(layer, w, h)
  return { cx: pivot.x + w / 2 - ap.x, cy: pivot.y + h / 2 - ap.y, w, h, rotation: layer.rotation }
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
