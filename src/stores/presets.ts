import { ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import type { WatermarkLayer, SerializedAsset } from '@/types/watermark'
import { useWatermarkStore } from './watermark'
import { toast } from './toast'

const PERSIST_KEY = 'albumark.presets.v1'

export interface WatermarkPreset {
  id: string
  name: string
  createdAt: number
  layers: WatermarkLayer[]
  assets: SerializedAsset[]
}

function load(): WatermarkPreset[] {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (raw) return JSON.parse(raw) as WatermarkPreset[]
  } catch {
    /* 忽略损坏数据 */
  }
  return []
}

/** 水印工作室产出的水印预设，存放于软件数据中，工作区里随时调用。 */
export const usePresetsStore = defineStore('presets', () => {
  const all = ref<WatermarkPreset[]>(load())

  function persist(): void {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(all.value))
    } catch {
      toast('预设过大，仅保存到本次会话', 'error')
    }
  }

  function save(name: string): boolean {
    const wm = useWatermarkStore()
    const data = wm.serialize()
    const p: WatermarkPreset = {
      id: uid(),
      name: name.trim() || '未命名水印',
      createdAt: Date.now(),
      layers: data.layers,
      assets: data.assets,
    }
    try {
      if (JSON.stringify(p).length > 4_500_000) return false
    } catch {
      return false
    }
    all.value.unshift(p)
    persist()
    return true
  }

  function remove(id: string): void {
    all.value = all.value.filter((p) => p.id !== id)
    persist()
  }

  function apply(id: string): void {
    const wm = useWatermarkStore()
    const p = all.value.find((x) => x.id === id)
    if (p) wm.applySerialized(p.layers, p.assets)
  }

  return { all, save, remove, apply }
})
