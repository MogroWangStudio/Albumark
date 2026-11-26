/**
 * 画布视图平移的共享运动学：预览画布与工作室样张画布
 * 共用同一套边界钳制与回弹公式，保证两处拖动手感一致。
 */

/** Apple 式橡皮筋：越界越多阻力越大 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/**
 * 单轴平移钳制：|v| ≤ max 直接通过；硬钳制取边界值；软钳制越界部分走橡皮筋。
 * disp 为 zoom = 1 时的显示尺寸（调用方各自 fit 计算），乘以当前 zoom 得到实际
 * 显示尺寸；margin 为放大后可平移的额外边距（0 = 最多贴边，数值越大照片可被
 * 推得越远）。未放大到超出视口时不允许平移，避免适应窗口状态下拖动露底。
 */
export function clampPanAxis(
  v: number,
  disp: number,
  viewport: number,
  zoom: number,
  soft: boolean,
  margin = 0,
): number {
  const overflow = (disp * zoom - viewport) / 2
  const max = overflow > 0 ? overflow + margin : 0
  if (max === 0) return 0
  if (Math.abs(v) <= max) return v
  if (!soft) return Math.sign(v) * max
  return Math.sign(v) * (max + rubberband(Math.abs(v) - max, viewport))
}
