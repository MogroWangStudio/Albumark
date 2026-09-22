import type { TextLayer, WatermarkLayer } from '@/types/watermark'
import {
  fontString,
  measureLayer,
  textMetrics,
  type Ctx2D,
  type LayerBox,
} from './layout'

export type AssetMap = Map<string, ImageBitmap>

function roundRectFill(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
  ctx.fill()
}

export function drawLayers(
  ctx: Ctx2D,
  imgW: number,
  imgH: number,
  layers: WatermarkLayer[],
  assets: AssetMap,
): void {
  const long = Math.max(imgW, imgH)
  for (const layer of layers) {
    // 边框层在 Worker 里扩展画布，不在此绘制
    if (layer.type === 'border' || !layer.visible) continue
    const box = measureLayer(layer, imgW, imgH, ctx)
    ctx.save()
    ctx.globalAlpha = layer.opacity / 100
    ctx.globalCompositeOperation =
      layer.blend === 'normal' ? 'source-over' : (layer.blend as GlobalCompositeOperation)

    if (layer.tile.enabled) {
      const stepX = Math.max(1, box.w * (1 + layer.tile.gapX / 100))
      const stepY = Math.max(1, box.h * (1 + layer.tile.gapY / 100))
      // 网格保证包含图层自身的中心位置，选中框与预览保持一致
      const startX = box.cx - Math.ceil((box.cx + box.w) / stepX) * stepX
      const startY = box.cy - Math.ceil((box.cy + box.h) / stepY) * stepY
      for (let x = startX; x < imgW + box.w; x += stepX) {
        for (let y = startY; y < imgH + box.h; y += stepY) {
          drawOne(ctx, layer, box, assets, x - box.cx, y - box.cy, long)
        }
      }
    } else {
      drawOne(ctx, layer, box, assets, 0, 0, long)
    }
    ctx.restore()
  }
}

function drawOne(
  ctx: Ctx2D,
  layer: WatermarkLayer,
  box: LayerBox,
  assets: AssetMap,
  dx: number,
  dy: number,
  long: number,
): void {
  ctx.save()
  ctx.translate(box.cx + dx, box.cy + dy)
  ctx.rotate((box.rotation * Math.PI) / 180)
  if (layer.type === 'image') {
    const bmp = assets.get(layer.assetId)
    if (bmp) ctx.drawImage(bmp, -box.w / 2, -box.h / 2, box.w, box.h)
  } else if (layer.type === 'text') {
    drawText(ctx, layer, box, long)
  }
  ctx.restore()
}

function drawText(ctx: Ctx2D, layer: TextLayer, box: LayerBox, long: number): void {
  const fontSize = (layer.scale / 100) * long
  const m = textMetrics(layer, fontSize, ctx)

  ctx.font = fontString(layer, fontSize)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  let pad = 0
  if (layer.background.enabled) {
    pad = (layer.background.padding / 100) * fontSize
    const prevAlpha = ctx.globalAlpha
    ctx.globalAlpha = prevAlpha * (layer.background.opacity / 100)
    ctx.fillStyle = layer.background.color
    roundRectFill(ctx, -box.w / 2, -box.h / 2, box.w, box.h, (layer.background.radius / 100) * fontSize)
    ctx.globalAlpha = prevAlpha
  }

  // 首行基线从内容区顶部起排；行高只作用于行与行之间，包围盒与文字贴合
  const contentLeft = -box.w / 2 + pad
  const top = -box.h / 2 + pad

  for (let i = 0; i < m.lines.length; i++) {
    const lineW = m.widths[i]
    if (!m.lines[i] || lineW <= 0) continue
    let x = contentLeft
    if (layer.align === 'right') x = contentLeft + (m.contentW - lineW)
    else if (layer.align === 'center') x = contentLeft + (m.contentW - lineW) / 2
    const y = top + m.lh * i + m.ascent

    if (layer.shadow.enabled) {
      const sh = layer.shadow
      ctx.shadowColor = `rgba(0, 0, 0, ${sh.opacity / 100})`
      ctx.shadowBlur = (sh.blur / 100) * fontSize
      ctx.shadowOffsetX = (sh.x / 100) * fontSize
      ctx.shadowOffsetY = (sh.y / 100) * fontSize
    } else {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }

    const chars = [...m.lines[i]]
    for (let c = 0; c < chars.length; c++) {
      if (layer.stroke.enabled) {
        ctx.shadowColor = 'transparent'
        ctx.strokeStyle = layer.stroke.color
        ctx.lineWidth = Math.max(1, (layer.stroke.width / 100) * fontSize * 2)
        ctx.strokeText(chars[c], x, y)
        if (layer.shadow.enabled) {
          const sh = layer.shadow
          ctx.shadowColor = `rgba(0, 0, 0, ${sh.opacity / 100})`
          ctx.shadowBlur = (sh.blur / 100) * fontSize
          ctx.shadowOffsetX = (sh.x / 100) * fontSize
          ctx.shadowOffsetY = (sh.y / 100) * fontSize
        }
      }
      ctx.fillStyle = layer.color
      ctx.fillText(chars[c], x, y)
      x += ctx.measureText(chars[c]).width + (layer.letterSpacing / 100) * fontSize
    }
  }
  ctx.shadowColor = 'transparent'
}
