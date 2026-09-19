import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { makeTextLayer, useWatermarkStore } from './watermark'
import { toast } from './toast'
import type { WatermarkTemplate } from '@/types/watermark'

const PERSIST_KEY = 'albumark.templates.v1'

interface SavedTemplate {
  id: string
  name: string
  createdAt: number
  layers: WatermarkTemplate['layers']
  assets: WatermarkTemplate['assets']
}

/** 内置模板：每次应用生成全新 id，避免跨图状态串扰。 */
function builtinTemplates(): WatermarkTemplate[] {
  const signature = makeTextLayer({
    name: '签名',
    content: '辑印 Albumark',
    anchor: 'bottom-right',
    offsetX: -4,
    offsetY: -4,
    scale: 3.6,
    shadow: { enabled: true, blur: 18, opacity: 55, x: 0, y: 8 },
  })
  const tile = makeTextLayer({
    name: '平铺文字',
    content: '辑印 Albumark',
    anchor: 'middle-center',
    offsetX: 0,
    offsetY: 0,
    scale: 3,
    rotation: -30,
    opacity: 30,
    color: '#FFFFFF',
    shadow: { enabled: false, blur: 0, opacity: 0, x: 0, y: 0 },
    tile: { enabled: true, gapX: 140, gapY: 110 },
  })
  const exifBar = makeTextLayer({
    name: 'EXIF 参数条',
    content: '{机型}　{镜头}\n{焦距}　{光圈}　{快门}　{感光度}',
    anchor: 'bottom-left',
    offsetX: 4,
    offsetY: -4,
    scale: 2.2,
    lineHeight: 1.6,
    letterSpacing: 2,
    align: 'left',
    shadow: { enabled: false, blur: 0, opacity: 0, x: 0, y: 0 },
    background: { enabled: true, color: '#000000', opacity: 45, padding: 7, radius: 16 },
  })
  return [
    { id: 'builtin-signature', name: '右下签名', builtin: true, layers: [signature], assets: [] },
    { id: 'builtin-tile', name: '全图平铺', builtin: true, layers: [tile], assets: [] },
    { id: 'builtin-exif', name: 'EXIF 参数条', builtin: true, layers: [exifBar], assets: [] },
  ]
}

function loadSaved(): SavedTemplate[] {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (raw) return JSON.parse(raw) as SavedTemplate[]
  } catch {
    /* 忽略损坏数据 */
  }
  return []
}

export const useTemplatesStore = defineStore('templates', () => {
  const wm = useWatermarkStore()
  const saved = ref<SavedTemplate[]>(loadSaved())

  const all = computed<WatermarkTemplate[]>(() => [
    ...builtinTemplates(),
    ...saved.value.map((s) => ({
      id: s.id,
      name: s.name,
      layers: s.layers,
      assets: s.assets,
    })),
  ])

  function persist(): void {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(saved.value))
    } catch {
      toast('模板过大，仅保存到本次会话', 'error')
    }
  }

  function save(name: string): boolean {
    const data = wm.serialize()
    const t: SavedTemplate = {
      id: uid(),
      name: name.trim() || '未命名模板',
      createdAt: Date.now(),
      layers: data.layers,
      assets: data.assets,
    }
    try {
      const probe = JSON.stringify(t)
      if (probe.length > 4_500_000) return false
    } catch {
      return false
    }
    saved.value.unshift(t)
    persist()
    return true
  }

  function remove(id: string): void {
    saved.value = saved.value.filter((t) => t.id !== id)
    persist()
  }

  async function apply(id: string): Promise<void> {
    const t = all.value.find((x) => x.id === id)
    if (!t) return
    wm.applySerialized(t.layers, t.assets)
  }

  return { saved, all, save, remove, apply }
})
