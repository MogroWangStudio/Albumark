/** 把 SVG 矢量稿栅格化为 PNG（水印图层统一走位图管线，保证跨端一致）。 */
export async function rasterizeSvg(
  svgBlob: Blob,
  targetLong = 1024,
): Promise<{ blob: Blob; aspect: number }> {
  const text = await svgBlob.text()
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG 解析失败'))
      img.src = url
    })
    const dims = svgIntrinsicSize(text, img)
    const aspect = dims.w / dims.h
    const scale = Math.max(1, targetLong / Math.max(dims.w, dims.h))
    const cw = Math.max(1, Math.round(dims.w * scale))
    const ch = Math.max(1, Math.round(dims.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(img, 0, 0, cw, ch)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png')
    })
    return { blob, aspect }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function svgIntrinsicSize(text: string, img: HTMLImageElement): { w: number; h: number } {
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { w: img.naturalWidth, h: img.naturalHeight }
  }
  const vb = text.match(/viewBox\s*=\s*["']([-\d.\s]+)["']/)
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { w: parts[2], h: parts[3] }
    }
  }
  const wAttr = text.match(/\swidth\s*=\s*["'](\d+(?:\.\d+)?)/)
  const hAttr = text.match(/\sheight\s*=\s*["'](\d+(?:\.\d+)?)/)
  if (wAttr && hAttr) return { w: Number(wAttr[1]), h: Number(hAttr[1]) }
  return { w: 512, h: 512 }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取素材失败'))
    reader.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}
