import { reactive, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import { NEUTRAL, type AdjustKey, type Adjustments } from '@/types/adjust'

const PERSIST_KEY = 'albumark.adjust.v1'

function load(): Record<AdjustKey, number> {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (raw) return { ...NEUTRAL, ...(JSON.parse(raw) as Record<AdjustKey, number>) }
  } catch {
    /* 忽略损坏数据 */
  }
  return { ...NEUTRAL }
}

export const useAdjustStore = defineStore('adjust', () => {
  const values = reactive(load())

  function set(key: AdjustKey, v: number): void {
    values[key] = v
  }

  function reset(): void {
    Object.assign(values, NEUTRAL)
  }

  /** 纯数据快照，供 Worker 使用。 */
  function snapshot(): Adjustments {
    return { ...toRaw(values) }
  }

  watch(values, () => {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(values))
    } catch {
      /* 忽略写入失败 */
    }
  })

  return { values, set, reset, snapshot }
})
