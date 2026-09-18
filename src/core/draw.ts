import type { TextLayer, WatermarkLayer } from '@/types/watermark'
import { fontString, measureLayer, type Ctx2D, type LayerBox } from './layout'

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
  for (const layer of layers) {
    if (!layer.visible) continue
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
          drawOne(ctx, layer, box, assets, x - box.cx, y - box.cy)
        }
      }
    } else {
      drawOne(ctx, layer, box, assets, 0, 0)
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
): void {
  ctx.save()
  ctx.translate(box.cx + dx, box.cy + dy)
  ctx.rotate((box.rotation * Math.PI) / 180)
  if (layer.type === 'image') {
    const bmp = assets.get(layer.assetId)
    if (bmp) ctx.drawImage(bmp, -box.w / 2, -box.h / 2, box.w, box.h)
  } else {
    drawText(ctx, layer, box)
  }
  ctx.restore()
}

function drawText(ctx: Ctx2D, layer: TextLayer, box: LayerBox): void {
  const long = Math.max(ctx.canvas.width, ctx.canvas.height)
  const fontSize = (layer.scale / 100) * long
  const spacing = (layer.letterSpacing / 100) * fontSize
  const lines = layer.content.split('\n')

  ctx.font = fontString(layer, fontSize)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  const lh = fontSize * layer.lineHeight
  let pad = 0
  if (layer.background.enabled) {
    pad = (layer.background.padding / 100) * fontSize
    const prevAlpha = ctx.globalAlpha
    ctx.globalAlpha = prevAlpha * (layer.background.opacity / 100)
    ctx.fillStyle = layer.background.color
    roundRectFill(ctx, -box.w / 2, -box.h / 2, box.w, box.h, (layer.background.radius / 100) * fontSize)
    ctx.globalAlpha = prevAlpha
  }

  const alignX = (lineW: number): number => {
    if (layer.align === 'left') return -box.w / 2 + pad
    if (layer.align === 'right') return box.w / 2 - pad - lineW
    return -lineW / 2
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const chars = [...line]
    const widths = chars.map((ch) => ctx.measureText(ch).width)
    const lineW = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1)
    let x = alignX(lineW)
    const y = -box.h / 2 + pad + lh * i + lh / 2

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
      x += widths[c] + spacing
    }
  }
  ctx.shadowColor = 'transparent'
}
