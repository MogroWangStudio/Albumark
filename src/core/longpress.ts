/**
 * 触屏长按手势：按住不动约半秒触发回调，移动（滚动）或松手即取消。
 * 只认 pointerType === 'touch'——鼠标路径零影响（桌面用菜单按钮）。
 * 触发后拦截紧随的合成 click，否则菜单弹出的同时会点开卡片本身。
 */

const LONG_PRESS_MS = 500
/** 位移超过该值（CSS px）视为滚动手势，取消长按 */
const MOVE_THRESHOLD = 10

export interface LongPressHandlers {
  onPointerdown: (e: PointerEvent) => void
  onPointermove: (e: PointerEvent) => void
  onPointerup: (e: PointerEvent) => void
  onPointercancel: (e: PointerEvent) => void
  /** capture 阶段拦截长按触发的合成 click */
  onClickCapture: (e: MouseEvent) => void
}

export function useLongPress(onLongPress: (e: PointerEvent) => void): LongPressHandlers {
  let timer: number | null = null
  let startX = 0
  let startY = 0
  /** 长按已触发：用于拦下随后合成的 click */
  let fired = false

  function cancel(): void {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  return {
    onPointerdown(e: PointerEvent): void {
      if (e.pointerType !== 'touch') return
      startX = e.clientX
      startY = e.clientY
      cancel()
      // 事件对象在计时器里仍然可读（坐标与 target）：调用方借此定位长按目标
      timer = window.setTimeout(() => {
        timer = null
        fired = true
        // 轻震反馈菜单弹出（与动作同帧；无振动能力的环境静默跳过）
        navigator.vibrate?.(10)
        onLongPress(e)
      }, LONG_PRESS_MS)
    },
    onPointermove(e: PointerEvent): void {
      if (timer === null) return
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_THRESHOLD) cancel()
    },
    onPointerup(): void {
      cancel()
    },
    onPointercancel(): void {
      cancel()
    },
    onClickCapture(e: MouseEvent): void {
      if (!fired) return
      fired = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
}
