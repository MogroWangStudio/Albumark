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

/* ---------- 局部对比度：可分离盒模糊（清晰度 / 锐化共用） ---------- */

/** 单通道盒模糊：横向 + 纵向两次滑动窗口，返回每通道模糊副本。 */
function boxBlurRGB(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w * 3
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k)) * 3 + c]
      for (let x = 0; x < w; x++) {
        tmp[row + x * 3 + c] = acc * norm
        const add = src[row + Math.min(w - 1, x + r + 1) * 3 + c]
        const sub = src[row + Math.max(0, x - r) * 3 + c]
        acc += add - sub
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c]
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = acc * norm
        const add = tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c]
        const sub = tmp[(Math.max(0, y - r) * w + x) * 3 + c]
        acc += add - sub
      }
    }
  }
  return out
}

/** 像素数据转浮点 RGB（模糊输入）。 */
function toRGBFloat(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array((data.length / 4) * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[j] = data[i]
    out[j + 1] = data[i + 1]
    out[j + 2] = data[i + 2]
  }
  return out
}

/**
 * 单遍像素调节管线：曝光 → 亮度 → 对比度 → 阴影/高光 → 色温/色调 → 去雾 →
 * 清晰度 → 锐化 → 晕影 → 曲线 → 颗粒。
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
  const dehaze = a.dehaze / 100
  const clarity = a.clarity / 100
  const sharpen = a.sharpen / 100
  const grain = a.grain / 100
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
      // 去雾：按雾量拉黑场再补一点对比，减掉大气灰蒙
      if (dehaze > 0) {
        const lift = dehaze * 46
        const gain = 1 + dehaze * 0.35
        r = (r - lift) * gain + lift * 0.18
        g = (g - lift) * gain + lift * 0.18
        b = (b - lift) * gain + lift * 0.18
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

  // 清晰度：大半径局部对比度；锐化：小半径细节强化。均用 unsharp 结构，只在非零时付出模糊代价
  if (clarity !== 0 || sharpen !== 0) {
    const rgb = toRGBFloat(data)
    if (clarity !== 0) {
      const blur = boxBlurRGB(rgb, w, h, Math.max(3, Math.round(Math.min(w, h) * 0.02)))
      const k = clarity * 0.9
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        data[i] = clamp255(rgb[j] + (rgb[j] - blur[j]) * k)
        data[i + 1] = clamp255(rgb[j + 1] + (rgb[j + 1] - blur[j + 1]) * k)
        data[i + 2] = clamp255(rgb[j + 2] + (rgb[j + 2] - blur[j + 2]) * k)
      }
    }
    if (sharpen !== 0) {
      const base = toRGBFloat(data)
      const blur = boxBlurRGB(base, w, h, 1)
      const k = sharpen * 1.4
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        data[i] = clamp255(base[j] + (base[j] - blur[j]) * k)
        data[i + 1] = clamp255(base[j + 1] + (base[j + 1] - blur[j + 1]) * k)
        data[i + 2] = clamp255(base[j + 2] + (base[j + 2] - blur[j + 2]) * k)
      }
    }
  }

  // 颗粒：亮度加权的伪随机噪点（坐标 hash，逐帧稳定）
  if (grain > 0) {
    const strength = grain * 44
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        const hash = ((x * 374761393 + y * 668265263) ^ (x * y * 1274126177)) >>> 0
        const n = ((hash % 1024) / 1023 - 0.5) * strength
        const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
        // 暗部颗粒更弱，亮部更明显
        const wgt = 0.45 + l * 0.75
        data[i] = clamp255(data[i] + n * wgt)
        data[i + 1] = clamp255(data[i + 1] + n * wgt)
        data[i + 2] = clamp255(data[i + 2] + n * wgt)
      }
    }
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
