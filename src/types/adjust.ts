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
   * 色调曲线：扁平化的 [x0,y0,x1,y1,…] 控制点，数值归一化到 0–1。
   * 空数组 / undefined = 恒等曲线（不调整）。
   */
  curve?: number[]
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
  'curve' | 'hsl' | 'denoise' | 'denoiseMethod' | 'vignetteRadius' | 'vignetteFeather' | 'vignetteShape'
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
    JSON.stringify(a.hsl ?? null) === JSON.stringify(b.hsl ?? null)
  )
}

export function isNeutral(a: Adjustments): boolean {
  return sameAdjustments(a, NEUTRAL)
}

/* ---------- 裁剪 ---------- */

/**
 * 归一化裁剪区域（0–1，相对「翻转 + 旋转后」的源图），随照片独立保存。
 * rot 为拉直角度（度，-45–45），flip 为轴镜像：渲染时先翻转再旋转，最后取样矩形。
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

/** 矫正角度上限（度） */
export const CROP_ROT_MAX = 45

export function cropRot(c?: Pick<Crop, 'rot'>): number {
  return c?.rot ? Math.min(CROP_ROT_MAX, Math.max(-CROP_ROT_MAX, c.rot)) : 0
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
 * 旋转 θ 后完全落在原内容内的最大轴对齐矩形（拉直的保守内接框）。
 * 经典几何（rotatedRectWithMaxArea）：短边受两条对角线约束时按半约束求解，
 * 否则按投影公式（全约束）求解；返回 (宽, 高) 始终对应原内容的方向——
 * 竖图的内接矩形保持竖向，拉直不会突然转为横向。
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

/** 比例预设：ratio 为像素宽高比（w/h），null = 自由 */
export const CROP_RATIOS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'free', label: '自由', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
]

export function cropRatioOf(value: string): number | null {
  return CROP_RATIOS.find((r) => r.value === value)?.ratio ?? null
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function isFullCrop(c: Crop): boolean {
  return c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999
}

/** 翻转 / 拉直之外的纯矩形部分是否为整图 */
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
