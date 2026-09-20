/**
 * rAF 弹簧动画：默认临界阻尼（无过冲），动量交互可带轻微 bounce 与初速。
 * 参数沿用 Apple 的约定：response 为大致到达秒数（settle 由物理决定，非固定时长），
 * bounce 0 = 阻尼比 1（临界）；0.2 ≈ 阻尼比 0.8，只用于手势本身带动量的场景。
 */
export interface SpringHandle {
  stop(): void
}

export interface SpringOptions {
  response?: number
  bounce?: number
  /** 初始速度（单位/秒），用于手势释放的速度衔接 */
  velocity?: number
  onUpdate: (value: number) => void
  onSettle?: () => void
}

export function springTo(from: number, to: number, opts: SpringOptions): SpringHandle {
  const response = opts.response ?? 0.4
  const zeta = 1 - (opts.bounce ?? 0)
  const k = ((2 * Math.PI) / response) ** 2
  const c = 2 * zeta * Math.sqrt(k)
  let x = from
  let v = opts.velocity ?? 0
  let raf = 0
  let last = performance.now()
  let stopped = false

  const step = (t: number): void => {
    if (stopped) return
    // 钳制帧间隔：切后台回来时避免一次大步长发散
    const dt = Math.min(0.032, Math.max(0.001, (t - last) / 1000))
    last = t
    const a = -k * (x - to) - c * v
    v += a * dt
    x += v * dt
    if (Math.abs(x - to) < 0.01 && Math.abs(v) < 0.01) {
      opts.onUpdate(to)
      opts.onSettle?.()
      return
    }
    opts.onUpdate(x)
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)

  return {
    stop(): void {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
    },
  }
}

/** Apple 的动量投影：按释放速度预测自然停靠点，再吸附到最近的合法目标 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return (velocity / 1000) * (decelerationRate / (1 - decelerationRate))
}
