import type { Adjustments, Curves, HslShift } from '@/types/adjust'
import {
  DENOISE_DEFAULT,
  isCurveNeutral,
  isCurvesNeutral,
  isHslNeutral,
  VIGNETTE_DEFAULTS,
} from '@/types/adjust'

/** HSL 色带中心（度），与 HSL_BANDS 一致：红 橙 黄 绿 青 蓝 紫 洋红 */
const HUE_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300]
/** 跨色带的过渡宽度（度）：色带中心之间做线性交叉淡化，避免硬边 */
const HUE_LUT_SIZE = 360

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

/* ---------- 分通道曲线 ---------- */

type CurveLuts = {
  r: Uint8Array | null
  g: Uint8Array | null
  b: Uint8Array | null
  rgb: Uint8Array | null
}

/**
 * 四条曲线的查找表。应用顺序与 Photoshop 一致：先单通道、后合成通道。
 * 旧数据只有 curve（合成曲线）：curves.rgb 缺省时用它顶上，老照片的色调不丢。
 */
function buildCurveLuts(a: Adjustments): CurveLuts | null {
  const c: Curves | undefined = a.curves
  const rgbCurve = c?.rgb ?? a.curve
  if (isCurvesNeutral(c) && isCurveNeutral(rgbCurve)) return null
  const luts: CurveLuts = {
    r: isCurveNeutral(c?.r) ? null : buildCurveLut(c?.r),
    g: isCurveNeutral(c?.g) ? null : buildCurveLut(c?.g),
    b: isCurveNeutral(c?.b) ? null : buildCurveLut(c?.b),
    rgb: isCurveNeutral(rgbCurve) ? null : buildCurveLut(rgbCurve),
  }
  if (!luts.r && !luts.g && !luts.b && !luts.rgb) return null
  return luts
}

/* ---------- HSL 分色 ---------- */

/**
 * 把「8 色带的色相 / 饱和度 / 亮度偏移」烘焙成 360° 查找表（每度 dh, ds, dl）。
 * 逐像素再做一次插值即可，避免每个像素都跑一遍色带匹配。
 * 权重按相邻色带中心线性交叉 + smoothstep，色带中心全量生效、中点各半。
 */
function buildHueShiftLut(hs: HslShift): Float32Array {
  const lut = new Float32Array(HUE_LUT_SIZE * 3)
  const at = (arr: number[] | undefined, i: number): number => arr?.[i] ?? 0
  for (let h = 0; h < HUE_LUT_SIZE; h++) {
    let seg = 7
    for (let i = 0; i < 7; i++) {
      if (h >= HUE_CENTERS[i] && h < HUE_CENTERS[i + 1]) {
        seg = i
        break
      }
    }
    const next = seg === 7 ? 0 : seg + 1
    const span = (seg === 7 ? 360 : HUE_CENTERS[next]) - HUE_CENTERS[seg]
    const tRaw = span > 0 ? (h - HUE_CENTERS[seg]) / span : 0
    const t = tRaw * tRaw * (3 - 2 * tRaw)
    const w0 = 1 - t
    const w1 = t
    lut[h * 3] = (w0 * at(hs.h, seg) + w1 * at(hs.h, next)) * 0.75
    lut[h * 3 + 1] = (w0 * at(hs.s, seg) + w1 * at(hs.s, next)) / 100
    lut[h * 3 + 2] = (w0 * at(hs.l, seg) + w1 * at(hs.l, next)) / 100
  }
  return lut
}

/* ---------- 白平衡取样 ---------- */

/**
 * 取样色 → 色温 / 色调滑杆的增量（-100~100 单位）。
 *
 * 引擎里色温把 ±32×(v/100) 加到 R、反向加到 B；色调把 ∓26×(v/100) 从 G 减去，
 * 并以 0.4 倍补到 R/B。设增量为 ΔT、ΔI（0–255 加量），要令三个通道相等：
 *   r + ΔT + 0.4ΔI = g − ΔI = b − ΔT + 0.4ΔI
 * 解得 ΔT = (b − r) / 2、ΔI = (2g − r − b) / 2.8。
 * 因为取样值已包含当前色温/色调，增量叠加在现值上即完成一次「点哪儿哪儿变中性」。
 */
export function whiteBalanceDelta(r: number, g: number, b: number): { temperature: number; tint: number } {
  return {
    temperature: ((b - r) / 2 / 32) * 100,
    tint: ((2 * g - r - b) / 2.8 / 26) * 100,
  }
}

/* ---------- 影调核心：曝光 / 亮度 / 对比度 / 阴影 / 高光 ---------- */

const TONE_SIZE = 1024

function smoothstep01(v: number): number {
  const t = v < 0 ? 0 : v > 1 ? 1 : v
  return t * t * (3 - 2 * t)
}

/** 对比度强度上限：tanh 曲线在中灰处的斜率约 1.65，两端收敛为 0.3，不做硬切 */
const CONTRAST_K = 3.0

/**
 * 对比度：tanh 家族的 S 曲线（负值走它的反函数）。
 * 相比 smoothstep，两端导数不为 0——不会在纯黑 / 纯白附近堆出一段斜率极大的
 * 过渡（那正是暗部色带的来源）；端点仍严格固定在 0 / 1。
 */
function contrastCurve(t: number, c: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const s = c * CONTRAST_K
  if (c > 0) {
    return 0.5 + (0.5 * Math.tanh((t - 0.5) * s)) / Math.tanh(s / 2)
  }
  // 负对比度 = 正曲线的反函数：把两端平滑地收向中灰
  const k = Math.tanh(-s / 2)
  return 0.5 + Math.atanh((2 * t - 1) * k) / -s
}

/**
 * 曝光曲线：线性提亮，接近白点后走软肩。
 * 肩部的拐点随曝光量移动——e ≤ 1 时整段恒等，所以参数全中性时这条曲线
 * 不会偷偷改变照片；e > 1 时只有将被打到 255 以上的部分被压回，呈现胶片式
 * 高光滚降，而不是一刀切的白块。
 */
function exposureCurve(x: number, e: number): number {
  if (e <= 1) return x * e
  const knee = 1 - 0.35 * Math.min(1, (e - 1) / 0.5)
  const y = x * e
  if (y <= knee) return y
  return knee + (1 - knee) * (1 - Math.exp(-(y - knee) / (1 - knee)))
}

/**
 * 影调查找表：输入亮度 0–1 → 输出亮度 0–1。
 *
 * 五项控制在亮度域串成一条单调曲线：
 * 曝光（软肩）→ 亮度（端点不动的 gamma）→ 对比度（平滑 S 曲线，不再是
 * 围绕中灰的线性乘法——高对比不会把暗部压死、把高光推爆）→
 * 阴影 / 高光（各带互补蒙版的 gamma，中间调基本不动）。
 * 逐像素只查一次表、按比例缩放 RGB，速度快且不会逐通道运算串色。
 * 末尾强制单调：任何参数组合都不允许曲线出现反向段（会在暗部形成脏色带）。
 */
function buildToneLut(a: Adjustments): Float32Array {
  const e = Math.pow(2, (a.exposure / 100) * 1.2)
  // 曝光 > 1 时把软肩曲线归一化：纯白仍落在纯白，不因滚降被压掉一级
  const top = e > 1 ? exposureCurve(1, e) : 1
  const bright = a.brightness / 100
  const contrast = a.contrast / 100
  const shadows = a.shadows / 100
  const highlights = a.highlights / 100
  const lut = new Float32Array(TONE_SIZE)
  for (let i = 0; i < TONE_SIZE; i++) {
    const x = i / (TONE_SIZE - 1)
    let t = exposureCurve(x, e) / top
    // 亮度：0 仍为 0、1 仍为 1，只抬 / 压中间调，不会给黑位抹灰
    if (bright !== 0) t = Math.pow(t, 1 / (1 + bright * 0.5))
    // 对比度：S 曲线（或反 S 曲线），端点固定、全程平滑
    if (contrast !== 0) t = contrastCurve(t, contrast)
    // 阴影：0.62 以下按降幂蒙版生效，纯黑保持纯黑
    if (shadows !== 0) {
      const m = 1 - smoothstep01(t / 0.62)
      t += (Math.pow(t, 1 / (1 + shadows * 0.55)) - t) * m
    }
    // 高光：0.35 以上按升幂蒙版生效，纯白保持纯白（不制造灰白）
    if (highlights !== 0) {
      const m = smoothstep01((t - 0.35) / 0.65)
      t += (Math.pow(t, 1 / (1 + highlights * 0.55)) - t) * m
    }
    lut[i] = t < 0 ? 0 : t > 1 ? 1 : t
  }
  for (let i = 1; i < TONE_SIZE; i++) {
    if (lut[i] < lut[i - 1]) lut[i] = lut[i - 1]
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
 * 单遍像素调节管线：影调（曝光 → 亮度 → 对比度 → 阴影/高光，一次查表）→
 * 色温/色调 → 自然饱和度/饱和度 → HSL 分色 → 去雾 → 晕影 →
 * 分通道曲线 → 合成曲线 → 降噪 → 清晰度 → 锐化 → 颗粒。
 * 直接操作 RGBA 数据，供 Web Worker 调用；滑杆参数取 -100 ~ 100，曲线为 0–1 控制点。
 */
export function applyAdjustments(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  a: Adjustments,
): void {
  const temperature = (a.temperature / 100) * 32
  const tint = (a.tint / 100) * 26
  const vignette = a.vignette / 100
  // 晕影：半径 = 压暗起始位置（角落距离的百分比），羽化 = 过渡宽度
  const vStart = 0.25 + (Math.min(100, Math.max(0, a.vignetteRadius ?? VIGNETTE_DEFAULTS.radius)) / 100) * 0.5
  const vWidth = Math.max(0.1 + (Math.min(100, Math.max(0, a.vignetteFeather ?? VIGNETTE_DEFAULTS.feather)) / 100) * 0.8, 1e-3)
  const vInvW = 1 / vWidth
  const vCircle = (a.vignetteShape ?? VIGNETTE_DEFAULTS.shape) === 'circle'
  const dehaze = a.dehaze / 100
  const clarity = a.clarity / 100
  const sharpen = a.sharpen / 100
  const grain = a.grain / 100
  const luts = buildCurveLuts(a)
  // 影调：仅五项中有任意非中性时才建表（全中性时整条管线对亮度恒等）
  const toneOn =
    a.exposure !== 0 ||
    a.brightness !== 0 ||
    a.contrast !== 0 ||
    a.shadows !== 0 ||
    a.highlights !== 0
  const tone = toneOn ? buildToneLut(a) : null

  // 自然饱和度 + 饱和度：以 luma 为轴缩放色度；自然饱和度对低饱和像素加权更大
  const vib = (a.vibrance / 100) * 1.6
  const satMul = 1 + a.saturation / 100
  const colorOn = satMul !== 1 || vib !== 0
  // HSL 分色：仅在给出非中性偏移时进入逐像素 RGB↔HSL 的开销
  const hueLut = isHslNeutral(a.hsl) ? null : buildHueShiftLut(a.hsl as HslShift)

  const cx = w / 2
  const cy = h / 2
  const vInvDenom = 1 / Math.max(cx, cy)

  for (let y = 0, i = 0; y < h; y++) {
    const dy = y - cy
    const ny = vignette > 0 ? dy / cy : 0
    const dy2 = vignette > 0 && vCircle ? dy * dy : 0
    for (let x = 0; x < w; x++, i += 4) {
      let r = data[i]
      let g = data[i + 1]
      let b = data[i + 2]

      // 影调：按亮度查表，RGB 等比跟随——只改明暗，色相与色度关系保持不变。
      // 查表值做线性插值，避免 1024 级台阶在渐变天空上现出条带。
      if (tone) {
        const l0 = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        if (l0 > 1e-4) {
          const x = l0 >= 1 ? TONE_SIZE - 1 : l0 * (TONE_SIZE - 1)
          const i0 = x | 0
          const i1 = i0 < TONE_SIZE - 1 ? i0 + 1 : i0
          const t = tone[i0] + (tone[i1] - tone[i0]) * (x - i0)
          if (t !== l0) {
            const f = t / l0
            r *= f
            g *= f
            b *= f
          }
        }
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
      // 自然饱和度 / 饱和度：向 luma 轴缩放色度，自然饱和度在低饱和像素上权重更高
      if (colorOn) {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        let f = satMul
        if (vib !== 0) {
          const cmx = r > g ? (r > b ? r : b) : g > b ? g : b
          const cmn = r < g ? (r < b ? r : b) : g < b ? g : b
          f *= 1 + vib * (1 - (cmx - cmn) / 255)
        }
        r = lum + (r - lum) * f
        g = lum + (g - lum) * f
        b = lum + (b - lum) * f
      }
      // HSL 分色：先把通道夹回 0–255 再算 HSL。
      // 曝光 / 亮度可能把通道推到域外，旧版直接拿越界值求 S，
      // 会得到负饱和 → 色度被算成 0 → 像素抹成纯白（表现为「HSL 有时不生效」）。
      if (hueLut) {
        const rr = r < 0 ? 0 : r > 255 ? 255 : r
        const gg = g < 0 ? 0 : g > 255 ? 255 : g
        const bb = b < 0 ? 0 : b > 255 ? 255 : b
        const hmx = rr > gg ? (rr > bb ? rr : bb) : gg > bb ? gg : bb
        const hmn = rr < gg ? (rr < bb ? rr : bb) : gg < bb ? gg : bb
        const d = hmx - hmn
        if (d > 2) {
          const L = (hmx + hmn) / 510
          let hue: number
          if (hmx === rr) hue = 60 * (((gg - bb) / d) % 6)
          else if (hmx === gg) hue = 60 * ((bb - rr) / d + 2)
          else hue = 60 * ((rr - gg) / d + 4)
          if (hue < 0) hue += 360
          if (hue >= 360) hue -= 360
          const den = 1 - Math.abs(2 * L - 1)
          const S = den > 1e-4 ? Math.min(1, d / 255 / den) : 0
          // 查表并按度内位置线性插值，避免 1° 台阶
          const h0 = hue | 0
          const h1 = h0 >= HUE_LUT_SIZE - 1 ? 0 : h0 + 1
          const fr = hue - h0
          const dh = hueLut[h0 * 3] + (hueLut[h1 * 3] - hueLut[h0 * 3]) * fr
          const ds = hueLut[h0 * 3 + 1] + (hueLut[h1 * 3 + 1] - hueLut[h0 * 3 + 1]) * fr
          const dl = hueLut[h0 * 3 + 2] + (hueLut[h1 * 3 + 2] - hueLut[h0 * 3 + 2]) * fr
          if (dh !== 0 || ds !== 0 || dl !== 0) {
            const h2 = (hue + dh + 360) % 360
            const sd = ds < -1 ? -1 : ds > 1 ? 1 : ds
            const s2 = Math.min(1, Math.max(0, S * (1 + sd)))
            const l2 = Math.min(1, Math.max(0, L + dl * 0.55))
            // HSL → RGB
            const c = (1 - Math.abs(2 * l2 - 1)) * s2
            const hp = h2 / 60
            const xx = c * (1 - Math.abs((hp % 2) - 1))
            let r1 = 0
            let g1 = 0
            let b1 = 0
            if (hp < 1) {
              r1 = c
              g1 = xx
            } else if (hp < 2) {
              r1 = xx
              g1 = c
            } else if (hp < 3) {
              g1 = c
              b1 = xx
            } else if (hp < 4) {
              g1 = xx
              b1 = c
            } else if (hp < 5) {
              r1 = xx
              b1 = c
            } else {
              r1 = c
              b1 = xx
            }
            const m2 = l2 - c / 2
            r = (r1 + m2) * 255
            g = (g1 + m2) * 255
            b = (b1 + m2) * 255
          }
        }
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
        // 距离归一到角落 = 1：椭圆随画幅，正圆按长边一半为半径
        const dxp = x - cx
        const dn = vCircle
          ? Math.sqrt(dxp * dxp + dy2) * vInvDenom
          : Math.sqrt((dxp / cx) * (dxp / cx) + ny * ny) * 0.70710678
        let t = (dn - vStart) * vInvW
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const falloff = 1 - vignette * t * t * (3 - 2 * t)
        r *= falloff
        g *= falloff
        b *= falloff
      }
      // 曲线：单通道先行，合成通道收尾（与 Photoshop 的复合曲线顺序一致）
      if (luts) {
        if (luts.r) r = luts.r[r < 0 ? 0 : r > 255 ? 255 : r | 0]
        if (luts.g) g = luts.g[g < 0 ? 0 : g > 255 ? 255 : g | 0]
        if (luts.b) b = luts.b[b < 0 ? 0 : b > 255 ? 255 : b | 0]
        if (luts.rgb) {
          r = luts.rgb[r < 0 ? 0 : r > 255 ? 255 : r | 0]
          g = luts.rgb[g < 0 ? 0 : g > 255 ? 255 : g | 0]
          b = luts.rgb[b < 0 ? 0 : b > 255 ? 255 : b | 0]
        }
      }

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }

  // 降噪：在细节增强（清晰度/锐化）之前进行，避免增强放大噪点
  const dnK = (a.denoise ?? 0) / 100
  if (dnK > 0) denoiseImage(data, w, h, dnK, a.denoiseMethod ?? DENOISE_DEFAULT)

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

  // 颗粒：亮度加权的胶片噪点。坐标先经 murmur 风格整型混淆再取值——
  // 直接对线性组合取模会把乘积式的低字节结构暴露成重复的对角纹路（接缝感）；
  // 32 位输出拆两个半字相加得三角分布，比均匀噪声更接近胶片颗粒
  if (grain > 0) {
    const strength = grain * 58
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        let h32 = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x9e3779b9, 0x85ebca6b)) | 0
        h32 = Math.imul(h32 ^ (h32 >>> 15), 0x2c1b3c6d)
        h32 = Math.imul(h32 ^ (h32 >>> 12), 0x297a2d39)
        h32 = (h32 ^ (h32 >>> 15)) | 0
        const n = (((h32 >>> 16) + (h32 & 0xffff)) / 131071 - 0.5) * strength
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

/* ---------- 降噪 ---------- */

type DenoiseMethod = 'smooth' | 'edge' | 'median'

/**
 * 降噪调度：强度 k ∈ 0–1。
 * - 平滑：两遍盒模糊近似高斯，半径随强度增大，按强度与原图混合
 * - 边缘保持：联合双边滤波的可分离近似（色度以亮度为参考，保色不产生彩斑）
 * - 中值：3×3 逐通道中值，对孤点噪斑 / 椒盐噪最有效，按强度与原图混合
 */
function denoiseImage(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  k: number,
  method: DenoiseMethod,
): void {
  if (method === 'median') medianDenoise(data, w, h, k)
  else if (method === 'edge') bilateralDenoise(data, w, h, k)
  else smoothDenoise(data, w, h, k)
}

/** 平滑：两遍盒模糊近似高斯（半径 1–3 随强度），lerp 回原图 */
function smoothDenoise(data: Uint8ClampedArray, w: number, h: number, k: number): void {
  const r = k >= 0.66 ? 3 : k >= 0.33 ? 2 : 1
  const blur = boxBlurRGB(boxBlurRGB(toRGBFloat(data), w, h, r), w, h, r)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    data[i] = clamp255(data[i] + (blur[j] - data[i]) * k)
    data[i + 1] = clamp255(data[i + 1] + (blur[j + 1] - data[i + 1]) * k)
    data[i + 2] = clamp255(data[i + 2] + (blur[j + 2] - data[i + 2]) * k)
  }
}

/**
 * 边缘保持：联合双边滤波的可分离近似。空间高斯 σ=1.6、半径 3，
 * 值域权重以亮度差查表（σ 随强度 5→35），色度跟随亮度权重 —— 保边且不产生彩斑。
 */
function bilateralDenoise(data: Uint8ClampedArray, w: number, h: number, k: number): void {
  const r = 3
  const sigmaR = 5 + k * 30
  const rangeLut = new Float32Array(256)
  for (let v = 0; v < 256; v++) rangeLut[v] = Math.exp(-(v * v) / (2 * sigmaR * sigmaR))
  const spatial = [0.172, 0.458, 0.823, 1, 0.823, 0.458, 0.172] // exp(-d²/2), σ=1.6，归一化在权重和里完成
  const n = w * h
  const src = toRGBFloat(data)
  const luma = new Float32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    luma[i] = 0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2]
  }
  const mid = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  // 水平 → 垂直两遍；值域参考统一用原图亮度（联合双边）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const lc = luma[idx]
      let wa = 0
      let r0 = 0
      let g0 = 0
      let b0 = 0
      for (let d = -r; d <= r; d++) {
        const xx = Math.min(w - 1, Math.max(0, x + d))
        const j = (y * w + xx) * 3
        const wt = spatial[d + 3] * rangeLut[Math.abs(luma[y * w + xx] - lc) | 0]
        wa += wt
        r0 += src[j] * wt
        g0 += src[j + 1] * wt
        b0 += src[j + 2] * wt
      }
      const j = idx * 3
      mid[j] = r0 / wa
      mid[j + 1] = g0 / wa
      mid[j + 2] = b0 / wa
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const idx = y * w + x
      const lc = luma[idx]
      let wa = 0
      let r0 = 0
      let g0 = 0
      let b0 = 0
      for (let d = -r; d <= r; d++) {
        const yy = Math.min(h - 1, Math.max(0, y + d))
        const j = (yy * w + x) * 3
        const wt = spatial[d + 3] * rangeLut[Math.abs(luma[yy * w + x] - lc) | 0]
        wa += wt
        r0 += mid[j] * wt
        g0 += mid[j + 1] * wt
        b0 += mid[j + 2] * wt
      }
      const j = idx * 3
      out[j] = r0 / wa
      out[j + 1] = g0 / wa
      out[j + 2] = b0 / wa
    }
  }
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    data[i] = clamp255(data[i] + (out[j] - data[i]) * k)
    data[i + 1] = clamp255(data[i + 1] + (out[j + 1] - data[i + 1]) * k)
    data[i + 2] = clamp255(data[i + 2] + (out[j + 2] - data[i + 2]) * k)
  }
}

/** 中值：3×3 逐通道中值滤波（插入排序取中位），lerp 回原图 */
function medianDenoise(data: Uint8ClampedArray, w: number, h: number, k: number): void {
  const src = data.slice()
  const win = new Array<number>(9)
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      for (let c = 0; c < 3; c++) {
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx))
            win[n++] = src[(yy * w + xx) * 4 + c]
          }
        }
        for (let a = 1; a < 9; a++) {
          const v = win[a]
          let b = a - 1
          while (b >= 0 && win[b] > v) {
            win[b + 1] = win[b]
            b--
          }
          win[b + 1] = v
        }
        const med = win[4]
        data[i + c] = clamp255(src[i + c] + (med - src[i + c]) * k)
      }
    }
  }
}
