import type { Adjustments } from '@/types/adjust'

/**
 * 单遍像素调节管线：曝光 → 亮度 → 阴影/高光 → 色温/色调 → 晕影。
 * 直接操作 RGBA 数据，供 Web Worker 调用；所有参数取 -100 ~ 100。
 */
export function applyAdjustments(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  a: Adjustments,
): void {
  const exposure = Math.pow(2, (a.exposure / 100) * 1.2)
  const brightness = (a.brightness / 100) * 40
  const shadows = (a.shadows / 100) * 90
  const highlights = (a.highlights / 100) * 90
  const temperature = (a.temperature / 100) * 32
  const tint = (a.tint / 100) * 26
  const vignette = a.vignette / 100

  const cx = w / 2
  const cy = h / 2

  for (let y = 0, i = 0; y < h; y++) {
    const ny = vignette > 0 ? (y - cy) / cy : 0
    for (let x = 0; x < w; x++, i += 4) {
      let r = data[i]
      let g = data[i + 1]
      let b = data[i + 2]

      if (exposure !== 1) {
        r *= exposure
        g *= exposure
        b *= exposure
      }
      if (brightness !== 0) {
        r += brightness
        g += brightness
        b += brightness
      }

      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      if (shadows !== 0) {
        const wgt = (1 - l) * (1 - l)
        r += shadows * wgt
        g += shadows * wgt
        b += shadows * wgt
      }
      if (highlights !== 0) {
        const wgt = l * l
        r += highlights * wgt
        g += highlights * wgt
        b += highlights * wgt
      }
      if (temperature !== 0) {
        r += temperature
        b -= temperature
      }
      if (tint !== 0) {
        g -= tint
        r += tint * 0.4
        b += tint * 0.4
      }
      if (vignette > 0) {
        const nx = (x - cx) / cx
        const d2 = nx * nx + ny * ny
        let t = (d2 - 0.5) / 1.5
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const falloff = 1 - vignette * t * t * (3 - 2 * t)
        r *= falloff
        g *= falloff
        b *= falloff
      }

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
}
