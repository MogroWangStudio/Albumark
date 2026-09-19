import { reactive, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import { NEUTRAL, type AdjustKey, type Adjustments } from '@/types/adjust'

const PERSIST_KEY = 'albumark.adjust.v1'

function load(): Adjustments {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (raw) return { ...NEUTRAL, ...(JSON.parse(raw) as Partial<Adjustments>) }
  } catch {
    /* 忽略损坏数据 */
  }
  return { ...NEUTRAL }
}

function plain(a: Adjustments): Adjustments {
  return { ...toRaw(a) }
}

export const useAdjustStore = defineStore('adjust', () => {
  /** 全局调节：应用到所有未开启「单独调节」的照片 */
  const values = reactive(load()) as Adjustments
  /** 单独调节的照片：id → 独立参数（存在即为开启），随会话结束不持久化 */
  const perImage = ref<Record<string, Adjustments>>({})

  function set(key: Exclude<AdjustKey, 'curve'>, v: number): void {
    values[key] = v
  }

  function reset(): void {
    Object.assign(values, NEUTRAL)
    delete values.curve
  }

  function isIndividual(id: string | null): boolean {
    return !!id && id in perImage.value
  }

  /** 开启时从当前全局值复制一份作为起点，关闭即回到全局参数 */
  function setIndividual(id: string | null, on: boolean): void {
    if (!id) return
    const next = { ...perImage.value }
    if (on) next[id] = plain(values)
    else delete next[id]
    perImage.value = next
  }

  /** 该照片当前的生效参数：独立参数优先，否则全局 */
  function snapshotFor(id: string | null): Adjustments {
    if (id && perImage.value[id]) return plain(perImage.value[id])
    return plain(values)
  }

  /** 纯数据快照：全部照片的独立参数（键与照片 id 对应），供导出 Worker 使用 */
  function perImageSnapshot(): Record<string, Adjustments> {
    const out: Record<string, Adjustments> = {}
    for (const [id, a] of Object.entries(perImage.value)) out[id] = plain(a)
    return out
  }

  /** 单独调节模式下把这张照片还原为全局参数 */
  function resetToGlobal(id: string | null): void {
    if (id && perImage.value[id]) perImage.value[id] = plain(values)
  }

  watch(values, () => {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(values))
    } catch {
      /* 忽略写入失败 */
    }
  })

  return {
    values,
    perImage,
    set,
    reset,
    isIndividual,
    setIndividual,
    snapshotFor,
    perImageSnapshot,
    resetToGlobal,
  }
})
