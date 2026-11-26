import type { ImageLayer, TextLayer, WatermarkLayer } from '@/types/watermark'
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

/** 九宫格点在包围盒上的坐标（含旋转）：父图层旋转时子图层跟着转。 */
function anchorOnBox(box: LayerBox, preset: AnchorPresetLike): { x: number; y: number } {
  const col = preset.endsWith('left') ? 0 : preset.endsWith('center') ? 1 : 2
  const row = preset.startsWith('top') ? 0 : preset.startsWith('middle') ? 1 : 2
  const lx = (col / 2 - 0.5) * box.w
  const ly = (row / 2 - 0.5) * box.h
  const rad = (box.rotation * Math.PI) / 180
  return {
    x: box.cx + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: box.cy + lx * Math.sin(rad) + ly * Math.cos(rad),
  }
}

type AnchorPresetLike = TextLayer['anchor']

/**
 * 图层定位点（不含 offset）：自定义锚点解析的唯一入口。
 * - image：图片九宫格；
 * - custom：图片内百分比坐标；
 * - layer：父图层包围盒上的九宫格点（父级旋转后仍贴合）。
 * 父图层缺失 / 链接成环时退回自身九宫格，保证渲染永不中断。
 */
export function layerAnchor(
  l: TextLayer | ImageLayer,
  imgW: number,
  imgH: number,
  pxScale = 1,
  layers: WatermarkLayer[] = [],
  mctx?: Ctx2D,
): { x: number; y: number } {
  return layerAnchorInner(l, imgW, imgH, pxScale, layers, mctx, new Set())
}

function layerAnchorInner(
  l: TextLayer | ImageLayer,
  imgW: number,
  imgH: number,
  pxScale: number,
  layers: WatermarkLayer[],
  mctx: Ctx2D | undefined,
  seen: Set<string>,
): { x: number; y: number } {
  const mode = l.anchorMode ?? 'image'
  if (mode === 'custom') {
    const ax = Number.isFinite(l.anchorX) ? (l.anchorX as number) : 50
    const ay = Number.isFinite(l.anchorY) ? (l.anchorY as number) : 50
    return { x: (ax / 100) * imgW, y: (ay / 100) * imgH }
  }
  if (mode === 'layer' && l.anchorParentId && mctx && !seen.has(l.anchorParentId)) {
    const parent = layers.find(
      (p): p is TextLayer | ImageLayer =>
        p.id === l.anchorParentId && (p.type === 'text' || p.type === 'image'),
    )
    if (parent) {
      const next = new Set(seen)
      next.add(l.id)
      const box = measureLayerInner(parent, imgW, imgH, mctx, pxScale, layers, next)
      return anchorOnBox(box, l.anchorParent ?? l.anchor)
    }
  }
  return anchorPoint(l.anchor, imgW, imgH)
}

/** 图层定位点：锚点 + 偏移（像素）。文字框锚点决定文字框的哪个位置对准这个点。
 *  pxScale：当前画布相对原图的折算系数——offset 是原图尺度固定像素
 *  （与边框宽度、背景偏移同一语义），预览 / 导出的画布尺寸不同时必须换算，
 *  否则水印偏移会随渲染分辨率漂移、导出与预览不一致。 */
export function layerPivot(
  l: TextLayer | ImageLayer,
  imgW: number,
  imgH: number,
  pxScale = 1,
  layers: WatermarkLayer[] = [],
  mctx?: Ctx2D,
): { x: number; y: number } {
  const a = layerAnchor(l, imgW, imgH, pxScale, layers, mctx)
  return { x: a.x + l.offsetX * pxScale, y: a.y + l.offsetY * pxScale }
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

/** 计算图层在图片坐标系中的包围盒（含旋转前的宽高）。边框 / 背景层为全画布。
 *  pxScale 供 offset 的原图尺度折算（见 layerPivot）；layers 用于解析自定义
 *  锚点的父图层。 */
export function measureLayer(
  layer: WatermarkLayer,
  imgW: number,
  imgH: number,
  mctx: Ctx2D,
  pxScale = 1,
  layers: WatermarkLayer[] = [],
): LayerBox {
  return measureLayerInner(layer, imgW, imgH, mctx, pxScale, layers, new Set())
}

function measureLayerInner(
  layer: WatermarkLayer,
  imgW: number,
  imgH: number,
  mctx: Ctx2D,
  pxScale: number,
  layers: WatermarkLayer[],
  seen: Set<string>,
): LayerBox {
  if (layer.type === 'border' || layer.type === 'background') {
    return { cx: imgW / 2, cy: imgH / 2, w: imgW, h: imgH, rotation: 0 }
  }
  const long = Math.max(imgW, imgH)
  const pivot = layerAnchorInner(layer, imgW, imgH, pxScale, layers, mctx, seen)

  if (layer.type === 'image') {
    const h = (layer.scale / 100) * long
    return {
      cx: pivot.x + layer.offsetX * pxScale,
      cy: pivot.y + layer.offsetY * pxScale,
      w: h * layer.aspect,
      h,
      rotation: layer.rotation,
    }
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
  return {
    cx: pivot.x + layer.offsetX * pxScale + w / 2 - ap.x,
    cy: pivot.y + layer.offsetY * pxScale + h / 2 - ap.y,
    w,
    h,
    rotation: layer.rotation,
  }
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

/** 选中框手柄：四角缩放点 + 顶部旋转点（坐标已是图片坐标系，含旋转）。 */
export type LayerHandleId = 'nw' | 'ne' | 'se' | 'sw' | 'rotate'

export interface LayerHandle {
  id: LayerHandleId
  x: number
  y: number
}

/**
 * 选中框手柄的唯一几何入口：预览叠加层与工作室样张共用。
 * rotateDist 为旋转手柄离包围盒上沿的距离（图片坐标），调用方按屏幕尺度折算。
 */
export function layerHandles(box: LayerBox, rotateDist: number): LayerHandle[] {
  const rad = (box.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const at = (lx: number, ly: number): { x: number; y: number } => ({
    x: box.cx + lx * cos - ly * sin,
    y: box.cy + lx * sin + ly * cos,
  })
  return [
    { id: 'nw', ...at(-box.w / 2, -box.h / 2) },
    { id: 'ne', ...at(box.w / 2, -box.h / 2) },
    { id: 'se', ...at(box.w / 2, box.h / 2) },
    { id: 'sw', ...at(-box.w / 2, box.h / 2) },
    { id: 'rotate', ...at(0, -box.h / 2 - rotateDist) },
  ]
}
