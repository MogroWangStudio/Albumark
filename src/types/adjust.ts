export interface Adjustments {
  brightness: number
  exposure: number
  contrast: number
  shadows: number
  highlights: number
  temperature: number
  tint: number
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
  dehaze: 0,
  clarity: 0,
  sharpen: 0,
  grain: 0,
}

export const ADJUST_DEFS: { key: Exclude<AdjustKey, 'curve'>; label: string }[] = [
  { key: 'exposure', label: '曝光' },
  { key: 'brightness', label: '亮度' },
  { key: 'contrast', label: '对比度' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
  { key: 'temperature', label: '色温' },
  { key: 'tint', label: '色调' },
  { key: 'dehaze', label: '去雾' },
  { key: 'clarity', label: '清晰度' },
  { key: 'sharpen', label: '锐化' },
  { key: 'grain', label: '颗粒' },
  { key: 'vignette', label: '晕影' },
]

export function isCurveNeutral(curve?: number[]): boolean {
  return !curve || curve.length < 4
}

export function isNeutral(a: Adjustments): boolean {
  return ADJUST_DEFS.every(({ key }) => a[key] === 0) && isCurveNeutral(a.curve)
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
 * 经典几何：短边受两条对角线约束时长边受限；否则按投影公式求解。
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
    const x = 0.5 * sideShort
    if (widthIsLonger) {
      wr = x / sinA
      hr = x / cosA
    } else {
      wr = x / cosA
      hr = x / sinA
    }
  } else {
    const cos2a = cosA * cosA - sinA * sinA
    wr = (sideLong * cosA - sideShort * sinA) / cos2a
    hr = (sideShort * cosA - sideLong * sinA) / cos2a
  }
  const long = { w: wr, h: hr }
  return widthIsLonger ? long : { w: long.h, h: long.w }
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
