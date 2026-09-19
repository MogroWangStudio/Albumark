import type { Adjustments } from '@/types/adjust'
import { isCurveNeutral } from '@/types/adjust'

/* ---------- 色调曲线 ---------- */

interface CurvePt {
  x: number
  y: number
}

/** 扁平数组 → 控制点；不足两个点视为恒等。 */
export function curvePoints(curve?: number[]): CurvePt[] {
  const pts: CurvePt[] = []
  if (curve) {
    for (let i = 0; i + 1 < curve.length; i += 2) {
      pts.push({ x: clamp01(curve[i]), y: clamp01(curve[i + 1]) })
    }
  }
  pts.sort((a, b) => a.x - b.x)
  return pts
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 单调三次样条（Fritsch–Carlson）采样成 256 项查找表。
 * 单调插值保证曲线不过冲，暗部/亮部不会被人为拉出脏色。
 */
export function buildCurveLut(curve?: number[]): Uint8Array | null {
  if (isCurveNeutral(curve)) return null
  const pts = curvePoints(curve)
  if (pts.length < 2) return null
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y })
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: pts[pts.length - 1].y })
  // 端点 y 合法化后仍可能恒等：全为对角线时返回 null 跳过逐像素开销
  if (pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1) {
    return null
  }

  const n = pts.length
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6)
    slope.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1e-6))
  }
  const m: number[] = new Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * slope[i]
      m[i + 1] = t * b * slope[i]
    }
  }

  const lut = new Uint8Array(256)
  let seg = 0
  for (let v = 0; v < 256; v++) {
    const x = v / 255
    while (seg < n - 2 && x > pts[seg + 1].x) seg++
    const h = dx[seg]
    const t = (x - pts[seg].x) / h
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    const y =
      h00 * pts[seg].y + h10 * h * m[seg] + h01 * pts[seg + 1].y + h11 * h * m[seg + 1]
    lut[v] = Math.round(clamp01(y) * 255)
  }
  return lut
}

/**
 * 单遍像素调节管线：曝光 → 亮度 → 对比度 → 阴影/高光 → 色温/色调 → 晕影 → 曲线。
 * 直接操作 RGBA 数据，供 Web Worker 调用；滑杆参数取 -100 ~ 100，曲线为 0–1 控制点。
 */
export function applyAdjustments(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  a: Adjustments,
): void {
  const exposure = Math.pow(2, (a.exposure / 100) * 1.2)
  const brightness = (a.brightness / 100) * 40
  const contrast = Math.pow(2, a.contrast / 100)
  const shadows = (a.shadows / 100) * 90
  const highlights = (a.highlights / 100) * 90
  const temperature = (a.temperature / 100) * 32
  const tint = (a.tint / 100) * 26
  const vignette = a.vignette / 100
  const lut = buildCurveLut(a.curve)

  const cx = w / 2
  const cy = h / 2
  const mid = 127.5

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
      if (contrast !== 1) {
        r = (r - mid) * contrast + mid
        g = (g - mid) * contrast + mid
        b = (b - mid) * contrast + mid
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
      if (lut) {
        r = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0]
        g = lut[g < 0 ? 0 : g > 255 ? 255 : g | 0]
        b = lut[b < 0 ? 0 : b > 255 ? 255 : b | 0]
      }

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
}
