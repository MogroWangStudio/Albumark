import { ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { cloneAdjustments, NEUTRAL, type Adjustments } from '@/types/adjust'
import { toast } from './toast'
import { useAdjustStore } from './adjust'
import { useImagesStore } from './images'

/** 一条调节预设：只存调节参数，不含水印与裁剪（那两者与构图强相关） */
export interface AdjustPreset {
  id: string
  name: string
  createdAt: number
  values: Adjustments
}

const PERSIST_KEY = 'albumark.adjustPresets.v1'

function load(): AdjustPreset[] {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as AdjustPreset[]
    if (!Array.isArray(list)) return []
    return list
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.values)
      .map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt ?? Date.now(),
        values: { ...NEUTRAL, ...p.values },
      }))
  } catch {
    return []
  }
}

export const useAdjustPresetsStore = defineStore('adjustPresets', () => {
  const adjust = useAdjustStore()
  const images = useImagesStore()
  const list = ref<AdjustPreset[]>(load())

  function persist(): void {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(list.value))
    } catch {
      toast('预设保存失败：本地存储空间不足', 'error')
    }
  }

  /** 名称去重：同名时追加序号，避免列表里两条一模一样的名字 */
  function uniqueName(raw: string): string {
    const base = raw.trim() || '未命名预设'
    if (!list.value.some((p) => p.name === base)) return base
    let i = 2
    while (list.value.some((p) => p.name === `${base} ${i}`)) i++
    return `${base} ${i}`
  }

  /** 把一份参数存为预设，返回新建的条目 */
  function save(name: string, values: Adjustments): AdjustPreset {
    const preset: AdjustPreset = {
      id: uid(),
      name: uniqueName(name),
      createdAt: Date.now(),
      values: cloneAdjustments(values),
    }
    list.value = [preset, ...list.value]
    persist()
    return preset
  }

  function remove(id: string): void {
    list.value = list.value.filter((p) => p.id !== id)
    persist()
  }

  function rename(id: string, name: string): void {
    const p = list.value.find((x) => x.id === id)
    if (!p) return
    p.name = uniqueName(name)
    persist()
  }

  /** 应用目标：多选模式下取勾选的照片，否则当前照片 */
  function targets(): string[] {
    const picked = [...images.selectedIds]
    if (images.multiSelect && picked.length) return picked
    return images.activeId ? [images.activeId] : []
  }

  /** 把预设写到指定照片（默认当前 / 所选），返回实际应用张数 */
  function apply(preset: AdjustPreset, ids: string[] = targets()): number {
    if (!ids.length) return 0
    adjust.applyToImages(ids, preset.values)
    return ids.length
  }

  /** 应用到全局：所有未开启单独调节的照片一起变化 */
  function applyToAll(preset: AdjustPreset): void {
    adjust.applyToGlobal(preset.values)
  }

  return { list, save, remove, rename, targets, apply, applyToAll }
})
