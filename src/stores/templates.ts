import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { makeTextLayer, useWatermarkStore } from './watermark'
import { toast } from './toast'
import { migrateOffsetsToPx, type WatermarkTemplate } from '@/types/watermark'

const PERSIST_KEY = 'albumark.templates.v2'
/** 旧版模板存储键：偏移按长边百分比存储，读取后一次性迁移为固定像素 */
const LEGACY_TEMPLATES_KEY = 'albumark.templates.v1'
/** 旧版「水印预设」存储键：并入模板库后移除 */
const LEGACY_PRESETS_KEY = 'albumark.presets.v1'
/** 单个模板的体积上限（assets 以 dataUrl 内嵌） */
const SIZE_LIMIT = 4_500_000

interface SavedTemplate {
  id: string
  name: string
  createdAt: number
  updatedAt?: number
  layers: WatermarkTemplate['layers']
  assets: WatermarkTemplate['assets']
}

/** 内置模板：每次应用生成全新 id，避免跨图状态串扰。 */
function builtinTemplates(): WatermarkTemplate[] {
  const signature = makeTextLayer({
    name: '签名',
    content: '辑印 Albumark',
    anchor: 'bottom-right',
    offsetX: -40,
    offsetY: -40,
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
    offsetX: 40,
    offsetY: -40,
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

/** 旧版「保存为水印」（工作室预设）一次性并入模板库 */
function migrateLegacyPresets(): SavedTemplate[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_PRESETS_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as SavedTemplate[]
    window.localStorage.removeItem(LEGACY_PRESETS_KEY)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function migrateTemplateLayers(t: SavedTemplate): SavedTemplate {
  return { ...t, layers: t.layers.map(migrateOffsetsToPx) }
}

function loadSaved(): SavedTemplate[] {
  let saved: SavedTemplate[] = []
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (raw) saved = JSON.parse(raw) as SavedTemplate[]
  } catch {
    /* 忽略损坏数据 */
  }
  if (!saved.length) {
    // 旧版模板键（偏移按长边百分比存储）：读出后迁移并移除
    try {
      const raw = window.localStorage.getItem(LEGACY_TEMPLATES_KEY)
      if (raw) {
        const list = JSON.parse(raw) as SavedTemplate[]
        if (Array.isArray(list) && list.length) {
          saved = list.map(migrateTemplateLayers)
          window.localStorage.removeItem(LEGACY_TEMPLATES_KEY)
        }
      }
    } catch {
      /* 忽略损坏数据 */
    }
  }
  const legacy = migrateLegacyPresets()
  if (legacy.length) saved = [...legacy.map(migrateTemplateLayers), ...saved]
  return saved
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

  function get(id: string): WatermarkTemplate | undefined {
    return all.value.find((t) => t.id === id)
  }

  /** 当前编辑内容存为新模板，返回新模板 id（失败返回 null） */
  function save(name: string): string | null {
    const data = wm.serialize()
    const t: SavedTemplate = {
      id: uid(),
      name: name.trim() || '未命名模板',
      createdAt: Date.now(),
      layers: data.layers,
      assets: data.assets,
    }
    try {
      if (JSON.stringify(t).length > SIZE_LIMIT) return null
    } catch {
      return null
    }
    saved.value.unshift(t)
    persist()
    return t.id
  }

  /** 把编辑器当前内容写回自建模板；内置模板不可覆盖 */
  function update(id: string): boolean {
    const t = saved.value.find((x) => x.id === id)
    if (!t) return false
    const data = wm.serialize()
    try {
      if (JSON.stringify(data).length > SIZE_LIMIT) return false
    } catch {
      return false
    }
    t.layers = data.layers
    t.assets = data.assets
    t.updatedAt = Date.now()
    persist()
    return true
  }

  function rename(id: string, name: string): void {
    const t = saved.value.find((x) => x.id === id)
    if (!t) return
    t.name = name.trim() || t.name
    t.updatedAt = Date.now()
    persist()
  }

  /** 复制任意模板（含内置）为新的自建模板，返回新 id */
  function duplicate(id: string): string | null {
    const src = all.value.find((x) => x.id === id)
    if (!src) return null
    const t: SavedTemplate = {
      id: uid(),
      name: `${src.name} 副本`,
      createdAt: Date.now(),
      layers: structuredClone(src.layers),
      assets: structuredClone(src.assets),
    }
    try {
      if (JSON.stringify(t).length > SIZE_LIMIT) return null
    } catch {
      return null
    }
    saved.value.unshift(t)
    persist()
    return t.id
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

  return { saved, all, get, save, update, rename, duplicate, remove, apply }
})
