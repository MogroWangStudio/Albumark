export interface Adjustments {
  brightness: number
  exposure: number
  shadows: number
  highlights: number
  temperature: number
  tint: number
  vignette: number
}

export type AdjustKey = keyof Adjustments

export const NEUTRAL: Adjustments = {
  brightness: 0,
  exposure: 0,
  shadows: 0,
  highlights: 0,
  temperature: 0,
  tint: 0,
  vignette: 0,
}

export const ADJUST_DEFS: { key: AdjustKey; label: string }[] = [
  { key: 'exposure', label: '曝光' },
  { key: 'brightness', label: '亮度' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
  { key: 'temperature', label: '色温' },
  { key: 'tint', label: '色调' },
  { key: 'vignette', label: '晕影' },
]

export function isNeutral(a: Adjustments): boolean {
  return ADJUST_DEFS.every(({ key }) => a[key] === 0)
}
