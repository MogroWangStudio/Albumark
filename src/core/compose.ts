import { clamp01, cropRot, type Crop } from '@/types/adjust'
import type { BorderLayer } from '@/types/watermark'

/**
 * 合成照片的几何缩略图：翻转 / 拉直 → 裁剪取样 → 逐层加边框，
 * 与 Worker 的输出构图一致（不含调色与文字 / 图片水印）。失败返回 null。
 */
export async function composeThumb(
  blob: Blob,
  crop: Crop | undefined,
  borders: BorderLayer[],
  longEdge = 240,
): Promise<Blob | null> {
  try {
    let src: ImageBitmap | OffscreenCanvas = await createImageBitmap(blob)
    const rot = cropRot(crop)
    const flipH = !!crop?.flipH
    const flipV = !!crop?.flipV
    if (flipH || flipV || rot !== 0) {
      const w0 = src.width
      const h0 = src.height
      const rad = (rot * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const t = new OffscreenCanvas(
        Math.max(1, Math.round(w0 * cos + h0 * sin)),
        Math.max(1, Math.round(w0 * sin + h0 * cos)),
      )
      const tctx = t.getContext('2d') as OffscreenCanvasRenderingContext2D
      tctx.translate(t.width / 2, t.height / 2)
      tctx.rotate(rad)
      tctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      tctx.drawImage(src, -w0 / 2, -h0 / 2)
      src = t
    }
    const sx = crop ? Math.round(clamp01(crop.x) * src.width) : 0
    const sy = crop ? Math.round(clamp01(crop.y) * src.height) : 0
    const sw = crop ? Math.max(1, Math.round(clamp01(crop.w) * src.width)) : src.width
    const sh = crop ? Math.max(1, Math.round(clamp01(crop.h) * src.height)) : src.height

    let framed = new OffscreenCanvas(sw, sh)
    const bctx = framed.getContext('2d') as OffscreenCanvasRenderingContext2D
    bctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    let fw = sw
    let fh = sh
    for (const b of borders) {
      const next = new OffscreenCanvas(fw + b.left + b.right, fh + b.top + b.bottom)
      const nctx = next.getContext('2d') as OffscreenCanvasRenderingContext2D
      nctx.fillStyle = b.colorTop
      nctx.fillRect(0, 0, next.width, b.top)
      nctx.fillStyle = b.colorBottom
      nctx.fillRect(0, fh + b.top, next.width, b.bottom)
      nctx.fillStyle = b.colorLeft
      nctx.fillRect(0, b.top, b.left, fh)
      nctx.fillStyle = b.colorRight
      nctx.fillRect(fw + b.left, b.top, b.right, fh)
      nctx.drawImage(framed, b.left, b.top)
      framed = next
      fw = next.width
      fh = next.height
    }

    const s = Math.min(1, longEdge / Math.max(fw, fh))
    const oc = new OffscreenCanvas(Math.max(1, Math.round(fw * s)), Math.max(1, Math.round(fh * s)))
    const octx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(framed, 0, 0, oc.width, oc.height)
    return await oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  } catch {
    return null
  }
}
