export interface Adjustments {
  brightness: number
  exposure: number
  contrast: number
  shadows: number
  highlights: number
  temperature: number
  tint: number
  /** 自然饱和度：低饱和像素提升更多，高饱和区域基本不动 */
  vibrance: number
  /** 饱和度：全画面线性增减 */
  saturation: number
  vignette: number
  /** 去雾：拉黑场 + 提对比，减轻灰蒙感 */
  dehaze: number
  /** 清晰度：大半径局部对比度 */
  clarity: number
  /** 锐化：小半径细节强化 */
  sharpen: number
  /** 颗粒：亮度加权噪点 */
  grain: number
  /**
   * 合成（RGB）色调曲线：扁平化的 [x0,y0,x1,y1,…] 控制点，数值归一化到 0–1。
   * 空数组 / undefined = 恒等曲线（不调整）。旧数据只有这一条曲线，保留兼容。
   */
  curve?: number[]
  /**
   * 分通道曲线：r/g/b 为单通道，rgb 为合成曲线（在单通道之后应用）。
   * 与 curve 同时存在时，curve 作为合成曲线的旧值参与合并（见 core/adjust）。
   */
  curves?: Curves
  /** HSL 分色调整：8 色带各自的色相 / 饱和度 / 亮度偏移（-100~100）；undefined = 全部中性 */
  hsl?: HslShift
  /** 降噪强度（0-100）；undefined / 0 = 关闭 */
  denoise?: number
  /** 降噪算法；缺省为「边缘保持」 */
  denoiseMethod?: DenoiseMethod
  /** 晕影起始半径（0-100，相对角落距离的百分比）；缺省 50 */
  vignetteRadius?: number
  /** 晕影羽化过渡宽度（0-100）；缺省 50 */
  vignetteFeather?: number
  /** 晕影形状：椭圆随画幅 / 正圆；缺省椭圆 */
  vignetteShape?: 'ellipse' | 'circle'
}

/** 降噪算法：平滑（快速模糊）/ 边缘保持（联合双边）/ 中值（去孤点噪斑） */
export type DenoiseMethod = 'smooth' | 'edge' | 'median'

export const DENOISE_METHODS: { value: DenoiseMethod; label: string }[] = [
  { value: 'smooth', label: '平滑' },
  { value: 'edge', label: '边缘保持' },
  { value: 'median', label: '中值' },
]
export const DENOISE_DEFAULT: DenoiseMethod = 'edge'
/** 晕影参数缺省值：与旧版固定曲线的观感一致 */
export const VIGNETTE_DEFAULTS = { radius: 50, feather: 50, shape: 'ellipse' as const }

/** 8 色带 [红, 橙, 黄, 绿, 青, 蓝, 紫, 洋红] 的分色偏移 */
export interface HslShift {
  h: number[]
  s: number[]
  l: number[]
}

/** 曲线通道：rgb 为合成通道（最后应用），r/g/b 为单通道 */
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b'

/** 四条曲线各自的控制点（0–1 扁平数组），缺省即恒等 */
export interface Curves {
  rgb?: number[]
  r?: number[]
  g?: number[]
  b?: number[]
}

export const CURVE_CHANNELS: { value: CurveChannel; label: string; hint: string }[] = [
  { value: 'rgb', label: 'RGB', hint: '合成通道' },
  { value: 'r', label: 'R', hint: '红色通道' },
  { value: 'g', label: 'G', hint: '绿色通道' },
  { value: 'b', label: 'B', hint: '蓝色通道' },
]

export type AdjustKey = keyof Adjustments

export const NEUTRAL: Adjustments = {
  brightness: 0,
  exposure: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  vignette: 0,
  dehaze: 0,
  clarity: 0,
  sharpen: 0,
  grain: 0,
}

/** HSL 色带：hue 为色相中心（度），swatch 用于 UI 色点 */
export const HSL_BANDS: { label: string; hue: number; swatch: string }[] = [
  { label: '红', hue: 0, swatch: '#e5484d' },
  { label: '橙', hue: 30, swatch: '#f76b15' },
  { label: '黄', hue: 60, swatch: '#f5d90a' },
  { label: '绿', hue: 120, swatch: '#46a758' },
  { label: '青', hue: 180, swatch: '#00a2c7' },
  { label: '蓝', hue: 240, swatch: '#3e63dd' },
  { label: '紫', hue: 270, swatch: '#8e4ec6' },
  { label: '洋红', hue: 300, swatch: '#d6409f' },
]

export function neutralHsl(): HslShift {
  return { h: [0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 0, 0, 0, 0], l: [0, 0, 0, 0, 0, 0, 0, 0] }
}

export function isHslNeutral(hsl?: HslShift): boolean {
  if (!hsl) return true
  return !hsl.h.some((v) => v !== 0) && !hsl.s.some((v) => v !== 0) && !hsl.l.some((v) => v !== 0)
}

/** 统一滑杆列表的数值键：排除曲线 / HSL 与带子选项的可选参数字段 */
export type SliderKey = Exclude<
  AdjustKey,
  | 'curve'
  | 'curves'
  | 'hsl'
  | 'denoise'
  | 'denoiseMethod'
  | 'vignetteRadius'
  | 'vignetteFeather'
  | 'vignetteShape'
>

export const ADJUST_DEFS: { key: SliderKey; label: string }[] = [
  { key: 'exposure', label: '曝光' },
  { key: 'brightness', label: '亮度' },
  { key: 'contrast', label: '对比度' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
  { key: 'temperature', label: '色温' },
  { key: 'tint', label: '色调' },
  { key: 'vibrance', label: '自然饱和度' },
  { key: 'saturation', label: '饱和度' },
  { key: 'dehaze', label: '去雾' },
  { key: 'clarity', label: '清晰度' },
  { key: 'sharpen', label: '锐化' },
  { key: 'grain', label: '颗粒' },
]

export function isCurveNeutral(curve?: number[]): boolean {
  return !curve || curve.length < 4
}

/** 四条曲线是否全部恒等 */
export function isCurvesNeutral(curves?: Curves): boolean {
  if (!curves) return true
  return (
    isCurveNeutral(curves.rgb) &&
    isCurveNeutral(curves.r) &&
    isCurveNeutral(curves.g) &&
    isCurveNeutral(curves.b)
  )
}

/** 深拷贝一份纯数据调节参数（预设、独立调节都用它，避免把 Proxy 带进 Worker） */
export function cloneAdjustments(a: Adjustments): Adjustments {
  const out: Adjustments = { ...a }
  if (a.curve) out.curve = [...a.curve]
  if (a.curves) {
    out.curves = {
      rgb: a.curves.rgb ? [...a.curves.rgb] : undefined,
      r: a.curves.r ? [...a.curves.r] : undefined,
      g: a.curves.g ? [...a.curves.g] : undefined,
      b: a.curves.b ? [...a.curves.b] : undefined,
    }
  }
  if (a.hsl) out.hsl = { h: [...a.hsl.h], s: [...a.hsl.s], l: [...a.hsl.l] }
  return out
}

/** 两份调节参数是否完全一致（可选字段按各自缺省值参与比较） */
export function sameAdjustments(a: Adjustments, b: Adjustments): boolean {
  if (!ADJUST_DEFS.every(({ key }) => a[key] === b[key])) return false
  if (a.vignette !== b.vignette) return false
  if ((a.vignetteRadius ?? VIGNETTE_DEFAULTS.radius) !== (b.vignetteRadius ?? VIGNETTE_DEFAULTS.radius))
    return false
  if ((a.vignetteFeather ?? VIGNETTE_DEFAULTS.feather) !== (b.vignetteFeather ?? VIGNETTE_DEFAULTS.feather))
    return false
  if ((a.vignetteShape ?? VIGNETTE_DEFAULTS.shape) !== (b.vignetteShape ?? VIGNETTE_DEFAULTS.shape))
    return false
  if ((a.denoise ?? 0) !== (b.denoise ?? 0)) return false
  if ((a.denoise ?? 0) > 0 && (a.denoiseMethod ?? DENOISE_DEFAULT) !== (b.denoiseMethod ?? DENOISE_DEFAULT))
    return false
  return (
    JSON.stringify(a.curve ?? []) === JSON.stringify(b.curve ?? []) &&
    JSON.stringify(a.curves ?? null) === JSON.stringify(b.curves ?? null) &&
    JSON.stringify(a.hsl ?? null) === JSON.stringify(b.hsl ?? null)
  )
}

export function isNeutral(a: Adjustments): boolean {
  return sameAdjustments(a, NEUTRAL)
}

/* ---------- 裁剪 ---------- */

/**
 * 归一化裁剪区域（0–1，相对「翻转 + 旋转后」的源图），随照片独立保存。
 * rot 为旋转角度（度，-359–360），flip 为轴镜像：渲染时先翻转再旋转，最后取样矩形。
 */
export interface Crop {
  x: number
  y: number
  w: number
  h: number
  rot?: number
  flipH?: boolean
  flipV?: boolean
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 }

/** 裁剪框最小边（归一化），防止拖成不可用的细条 */
export const CROP_MIN = 0.05

/** 旋转角度范围（度）：整圈可调，下限取 -359 免得与「没转」在数值上混淆 */
export const CROP_ROT_MIN = -359
export const CROP_ROT_MAX = 360

export function cropRot(c?: Pick<Crop, 'rot'>): number {
  const r = c?.rot
  if (!r) return 0
  return Math.min(CROP_ROT_MAX, Math.max(CROP_ROT_MIN, r))
}

/** 是否真的转过了：±360 视为未旋转（三角函数在那里会留下极小的浮点残差） */
export function isCropRotated(c?: Pick<Crop, 'rot'>): boolean {
  const rad = (cropRot(c) * Math.PI) / 180
  return Math.abs(Math.sin(rad)) > 1e-9 || Math.abs(Math.cos(rad) - 1) > 1e-9
}

/** 「翻转 + 旋转」后的源图尺寸（θ 的轴对齐包围盒）。 */
export function cropSourceSize(
  w0: number,
  h0: number,
  c?: Pick<Crop, 'rot' | 'flipH' | 'flipV'>,
): { w: number; h: number } {
  const rad = (cropRot(c) * Math.PI) / 180
  if (!c?.flipH && !c?.flipV && rad === 0) return { w: w0, h: h0 }
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return { w: w0 * cos + h0 * sin, h: w0 * sin + h0 * cos }
}

/** 最终输出尺寸：变换后源图中裁剪矩形的像素尺寸。 */
export function croppedSize(w0: number, h0: number, c?: Crop): { w: number; h: number } {
  const s = cropSourceSize(w0, h0, c)
  if (!c) return { w: w0, h: h0 }
  return { w: Math.max(1, Math.round(c.w * s.w)), h: Math.max(1, Math.round(c.h * s.h)) }
}

/**
 * 旋转 θ 后完全落在原内容内的最大轴对齐矩形（旋转后的最大内接框）。
 * 经典几何（rotatedRectWithMaxArea）：短边受两条对角线约束时按半约束求解，
 * 否则按投影公式（全约束）求解；返回 (宽, 高) 始终对应原内容的方向——
 * 竖图的内接矩形保持竖向，旋转不会突然转为横向。
 */
export function rotatedInnerRect(w0: number, h0: number, deg: number): { w: number; h: number } {
  if (w0 <= 0 || h0 <= 0) return { w: 0, h: 0 }
  const rad = (deg * Math.PI) / 180
  const widthIsLonger = w0 >= h0
  const sideLong = widthIsLonger ? w0 : h0
  const sideShort = widthIsLonger ? h0 : w0
  const sinA = Math.abs(Math.sin(rad))
  const cosA = Math.abs(Math.cos(rad))
  let wr: number
  let hr: number
  if (sideShort <= 2 * sinA * cosA * sideLong || Math.abs(sinA - cosA) < 1e-10) {
    // 半约束：原内容的一条边被两个角点触到
    const x = 0.5 * sideShort
    wr = widthIsLonger ? x / sinA : x / cosA
    hr = widthIsLonger ? x / cosA : x / sinA
  } else {
    // 全约束：内接矩形触到原内容的三条边
    const cos2a = cosA * cosA - sinA * sinA
    wr = (w0 * cosA - h0 * sinA) / cos2a
    hr = (h0 * cosA - w0 * sinA) / cos2a
  }
  return { w: wr, h: hr }
}

/* ---------- 裁剪框几何：旋转后的图片是一块斜着的四边形 ---------- */

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CropPoint {
  x: number
  y: number
}

/** 旋转后图片内容的四角（归一化，顺时针）；未旋转时即单位方形 */
export type CropQuad = [CropPoint, CropPoint, CropPoint, CropPoint]

/**
 * 缩放后的安全边距：旋转画布的边界由抗锯齿像素画出，裁剪框贴着它取样
 * 会把半透明的边缘像素（JPEG 上表现为一道暗边）带进成片，因此旋转状态下
 * 把「可裁区域」向内让约 1.5 源像素。未旋转时不缩，保留整图即整图的语义。
 */
function quadSafetyScale(
  w0: number,
  h0: number,
  c?: Pick<Crop, 'rot' | 'flipH' | 'flipV'>,
): { sx: number; sy: number } {
  if (!isCropRotated(c) || w0 <= 0 || h0 <= 0) return { sx: 1, sy: 1 }
  const src = cropSourceSize(w0, h0, c)
  return {
    sx: Math.max(0.9, 1 - 1.5 / Math.max(1, src.w)),
    sy: Math.max(0.9, 1 - 1.5 / Math.max(1, src.h)),
  }
}

/** 旋转（+ 翻转）后图片内容在归一化包围盒中的四角。 */
export function cropQuad(
  w0: number,
  h0: number,
  c?: Pick<Crop, 'rot' | 'flipH' | 'flipV'>,
): CropQuad {
  const src = cropSourceSize(w0, h0, c)
  const s = quadSafetyScale(w0, h0, c)
  const rad = (cropRot(c) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = Math.max(1e-6, w0) / 2
  const hh = Math.max(1e-6, h0) / 2
  const fx = c?.flipH ? -1 : 1
  const fy = c?.flipV ? -1 : 1
  const sw = Math.max(1e-6, src.w)
  const sh = Math.max(1e-6, src.h)
  const corner = (lx: number, ly: number): CropPoint => {
    const X = lx * fx
    const Y = ly * fy
    return {
      x: 0.5 + ((cos * X - sin * Y) / sw) * s.sx,
      y: 0.5 + ((sin * X + cos * Y) / sh) * s.sy,
    }
  }
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)]
}

/** 点是否在凸四边形内（含边界；容差按归一化尺度取极小值） */
function pointInQuad(p: CropPoint, quad: CropQuad, eps = 1e-9): boolean {
  let pos = false
  let neg = false
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross > eps) pos = true
    else if (cross < -eps) neg = true
    if (pos && neg) return false
  }
  return true
}

/** 矩形是否完整落在图片内：矩形与图片都凸，判四角即可 */
export function rectInQuad(r: CropRect, quad: CropQuad): boolean {
  return (
    pointInQuad({ x: r.x, y: r.y }, quad) &&
    pointInQuad({ x: r.x + r.w, y: r.y }, quad) &&
    pointInQuad({ x: r.x, y: r.y + r.h }, quad) &&
    pointInQuad({ x: r.x + r.w, y: r.y + r.h }, quad)
  )
}

function lerpRect(a: CropRect, b: CropRect, t: number): CropRect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  }
}

/**
 * 把目标矩形沿「起点 → 目标」的线段收敛到图片内，返回最接近目标的可放位置。
 *
 * 可行域是凸的：图片每条边对矩形的四角各给出一个线性不等式，所以从起点出发
 * 在线段上二分就能取到临界点——拖动时框会贴着图片边界停下，而不是被整体拖回
 * 某一个固定区域（旧实现只允许在居中内接框内活动）。
 */
export function fitRectInQuad(
  start: CropRect,
  target: CropRect,
  quad: CropQuad,
  steps = 20,
): CropRect {
  if (rectInQuad(target, quad)) return target
  let lo = 0
  let hi = 1
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2
    if (rectInQuad(lerpRect(start, target, mid), quad)) lo = mid
    else hi = mid
  }
  return lerpRect(start, target, lo)
}

/** 以给定中心等比缩放矩形，求仍能放下的最大比例（1 = 原样放得下） */
export function fitScaleInQuad(
  cx: number,
  cy: number,
  w: number,
  h: number,
  quad: CropQuad,
  steps = 20,
): number {
  const at = (s: number): CropRect => ({
    x: cx - (w * s) / 2,
    y: cy - (h * s) / 2,
    w: w * s,
    h: h * s,
  })
  if (rectInQuad(at(1), quad)) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2
    if (rectInQuad(at(mid), quad)) lo = mid
    else hi = mid
  }
  return lo
}

/** 旋转后的最大内接矩形（归一化、居中）：角度变化后收框的参照物 */
export function inscribedCropRect(
  w0: number,
  h0: number,
  c?: Pick<Crop, 'rot' | 'flipH' | 'flipV'>,
): CropRect {
  if (!isCropRotated(c) || w0 <= 0 || h0 <= 0) return { x: 0, y: 0, w: 1, h: 1 }
  const src = cropSourceSize(w0, h0, c)
  const s = quadSafetyScale(w0, h0, c)
  const inner = rotatedInnerRect(w0, h0, cropRot(c))
  const w = Math.min(1, (inner.w / Math.max(1e-6, src.w)) * s.sx)
  const h = Math.min(1, (inner.h / Math.max(1e-6, src.h)) * s.sy)
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

/**
 * 把矩形收进图片：已经放得下就原样返回，否则从内接框朝它滑动取最接近的
 * 可行位置——旋转角变化后原来的框可能越界，收框时尽量保住用户框好的构图。
 */
export function containCropRect(
  rect: CropRect,
  w0: number,
  h0: number,
  c?: Pick<Crop, 'rot' | 'flipH' | 'flipV'>,
): CropRect {
  const quad = cropQuad(w0, h0, c)
  if (rectInQuad(rect, quad)) return rect
  const ref = inscribedCropRect(w0, h0, c)
  const fit = fitRectInQuad(ref, rect, quad)
  const bumped = { ...fit, w: Math.max(CROP_MIN, fit.w), h: Math.max(CROP_MIN, fit.h) }
  return rectInQuad(bumped, quad) ? bumped : ref
}

/**
 * 平移裁剪框：整块移动时用，贴边后允许沿边滑动。
 *
 * 只在「起点 → 目标」连线上二分会让对角线拖动发粘：斜着往上走撞到斜边后，
 * 明明还能继续往右挪，框却整个停住。这里先沿连线收敛到可行点，再逐轴把
 * 剩下的位移补齐（两轴顺序各试一遍，取离目标更近的那个）——手感变成
 * 「这一边撞到边界，另一边继续走」。
 */
export function moveRectInQuad(
  start: CropRect,
  target: CropRect,
  quad: CropQuad,
  steps = 20,
): CropRect {
  if (rectInQuad(target, quad)) return target
  const base = fitRectInQuad(start, target, quad, steps)
  const gapX = target.x - start.x
  const gapY = target.y - start.y
  const slide = (first: 'x' | 'y'): CropRect => {
    let cur = { ...base }
    for (const axis of first === 'x' ? (['x', 'y'] as const) : (['y', 'x'] as const)) {
      const gap = (axis === 'x' ? gapX : gapY) - (cur[axis] - start[axis])
      if (Math.abs(gap) < 1e-9) continue
      const from = { ...cur }
      let lo = 0
      let hi = 1
      for (let i = 0; i < steps; i++) {
        const mid = (lo + hi) / 2
        if (rectInQuad({ ...from, [axis]: from[axis] + gap * mid }, quad)) lo = mid
        else hi = mid
      }
      cur = { ...from, [axis]: from[axis] + gap * lo }
    }
    return cur
  }
  const a = slide('x')
  const b = slide('y')
  const miss = (r: CropRect): number => Math.abs(r.x - target.x) + Math.abs(r.y - target.y)
  return miss(a) <= miss(b) ? a : b
}

/** 比例预设：ratio 为像素宽高比（w/h），null = 自由 */export const CROP_RATIOS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'free', label: '自由', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
]

export function cropRatioOf(value: string): number | null {
  // 自定义比例：custom:W:H（用户键入的宽高数值），W/H 均为正数才有效
  if (value.startsWith('custom:')) {
    const parts = value.split(':')
    if (parts.length !== 3) return null
    const w = Number(parts[1])
    const h = Number(parts[2])
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null
  }
  return CROP_RATIOS.find((r) => r.value === value)?.ratio ?? null
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function isFullCrop(c: Crop): boolean {
  return c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999
}

/** 翻转 / 旋转之外的纯矩形部分是否为整图 */
export function isPlainFullCrop(c: Crop): boolean {
  return isFullCrop(c) && !cropRot(c) && !c.flipH && !c.flipV
}

/** 把任意矩形收敛为合法裁剪区域：clamp 到图内、不小于最小边 */
export function clampCrop(x0: number, y0: number, x1: number, y1: number): Crop {
  const left = Math.min(Math.max(0, x0), 1 - CROP_MIN)
  const top = Math.min(Math.max(0, y0), 1 - CROP_MIN)
  const right = Math.min(Math.max(left + CROP_MIN, x1), 1)
  const bottom = Math.min(Math.max(top + CROP_MIN, y1), 1)
  return { x: left, y: top, w: right - left, h: bottom - top }
}
