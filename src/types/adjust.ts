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
