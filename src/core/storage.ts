/**
 * localStorage JSON 读写与防抖保存的共享工具。
 * 各 store 的持久化迁移/校验逻辑各不相同，这里只收敛读写与计时骨架。
 */

/** 读 JSON：键不存在或解析失败返回 fallback */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* 忽略损坏数据 */
  }
  return fallback
}

/** 写 JSON：返回是否成功（失败多为空间不足，提示方式由调用方决定） */
export function saveJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/**
 * 防抖保存器：schedule 重置计时器，ms 静默后执行 fn。
 * flush 只在有待执行任务时立即执行并透传 fn 的返回（异步 fn 的完成
 * Promise 也透传——调用方可以 await 保证落盘后再继续）；
 * cancel 只取消待执行任务不执行 fn（「无论有没有新改动都要写一次」的
 * 场景用 cancel + 直接调 fn 组合）。
 */
export function createDebouncedSaver(
  fn: () => void | Promise<void>,
  ms: number,
): { schedule: () => void; flush: () => void | Promise<void>; cancel: () => void } {
  let timer: number | null = null
  return {
    schedule(): void {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void fn()
      }, ms)
    },
    flush(): void | Promise<void> {
      if (!timer) return
      window.clearTimeout(timer)
      timer = null
      return fn()
    },
    cancel(): void {
      if (timer) {
        window.clearTimeout(timer)
        timer = null
      }
    },
  }
}
