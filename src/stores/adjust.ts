import { computed, reactive, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import { isPlainFullCrop, NEUTRAL, type AdjustKey, type Adjustments, type Crop } from '@/types/adjust'
import { useImagesStore } from '@/stores/images'

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

  function set(key: Exclude<AdjustKey, 'curve' | 'hsl'>, v: number): void {
    values[key] = v
  }

  function reset(): void {
    Object.assign(values, NEUTRAL)
    delete values.curve
    delete values.hsl
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

  /* ---------- 裁剪：随照片独立，会话内有效（与「单独调节」同一生命周期） ---------- */

  /** 操作面板当前页：裁剪页即裁剪模式（预览显示全图与裁剪框） */
  const panel = ref<'watermark' | 'adjust' | 'crop' | 'export'>('watermark')
  /** 裁剪模式（派生自面板页）：预览显示全图与裁剪框 */
  const cropMode = computed(() => panel.value === 'crop')
  /** 照片 id → 已应用的裁剪区域 */
  const crops = ref<Record<string, Crop>>({})
  /** 编辑中的裁剪框（归一化），确认后写入 crops */
  const cropDraft = ref<Crop | null>(null)
  /** 裁剪比例预设值（CROP_RATIOS 的 value） */
  const cropRatio = ref('free')

  /** 离开裁剪页：裁剪可复原，无需确认——草稿自动应用到当前照片 */
  function exitCrop(): void {
    panel.value = 'adjust'
  }

  /** 把草稿落为某张照片的裁剪：纯整图等同清除，其余原样写入 */
  function commitCropDraft(id: string | null): void {
    const d = cropDraft.value
    if (!id || !d) return
    if (isPlainFullCrop(d)) clearCrop(id)
    else setCrop(id, d)
  }

  // 任何离开裁剪页的路径（点面板页签 / Esc）都自动保存草稿
  watch(panel, (now, prev) => {
    if (prev === 'crop' && now !== 'crop') commitCropDraft(useImagesStore().activeId)
  })

  function cropOf(id: string | null): Crop | undefined {
    return id ? crops.value[id] : undefined
  }

  function setCrop(id: string, c: Crop): void {
    crops.value = { ...crops.value, [id]: { ...c } }
  }

  function clearCrop(id: string): void {
    if (!(id in crops.value)) return
    const next = { ...crops.value }
    delete next[id]
    crops.value = next
  }

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
    panel,
    crops,
    cropMode,
    cropDraft,
    cropRatio,
    cropOf,
    setCrop,
    clearCrop,
    commitCropDraft,
    exitCrop,
  }
})
