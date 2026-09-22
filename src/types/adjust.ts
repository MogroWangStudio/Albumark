export interface Adjustments {
  brightness: number
  exposure: number
  contrast: number
  shadows: number
  highlights: number
  temperature: number
  tint: number
  vignette: number
  /**
   * 色调曲线：扁平化的 [x0,y0,x1,y1,…] 控制点，数值归一化到 0–1。
   * 空数组 / undefined = 恒等曲线（不调整）。
   */
  curve?: number[]
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
  vignette: 0,
}

export const ADJUST_DEFS: { key: Exclude<AdjustKey, 'curve'>; label: string }[] = [
  { key: 'exposure', label: '曝光' },
  { key: 'brightness', label: '亮度' },
  { key: 'contrast', label: '对比度' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
  { key: 'temperature', label: '色温' },
  { key: 'tint', label: '色调' },
  { key: 'vignette', label: '晕影' },
]

export function isCurveNeutral(curve?: number[]): boolean {
  return !curve || curve.length < 4
}

export function isNeutral(a: Adjustments): boolean {
  return ADJUST_DEFS.every(({ key }) => a[key] === 0) && isCurveNeutral(a.curve)
}

/* ---------- 裁剪 ---------- */

/** 归一化裁剪区域（0–1，相对原图宽高），随照片独立保存 */
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 }

/** 裁剪框最小边（归一化），防止拖成不可用的细条 */
export const CROP_MIN = 0.05

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

/** 把任意矩形收敛为合法裁剪区域：clamp 到图内、不小于最小边 */
export function clampCrop(x0: number, y0: number, x1: number, y1: number): Crop {
  const left = Math.min(Math.max(0, x0), 1 - CROP_MIN)
  const top = Math.min(Math.max(0, y0), 1 - CROP_MIN)
  const right = Math.min(Math.max(left + CROP_MIN, x1), 1)
  const bottom = Math.min(Math.max(top + CROP_MIN, y1), 1)
  return { x: left, y: top, w: right - left, h: bottom - top }
}
