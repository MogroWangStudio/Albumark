import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { loadJson, saveJson } from '@/core/storage'
import { t } from '@/i18n'
import { makeBackgroundLayer, makeBorderLayer, makeTextLayer, useWatermarkStore } from './watermark'
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
    name: t('签名'),
    content: 'Albumark',
    anchor: 'bottom-right',
    offsetX: -40,
    offsetY: -40,
    scale: 3.6,
    shadow: { enabled: true, blur: 18, opacity: 55, x: 0, y: 8 },
  })
  const tile = makeTextLayer({
    name: t('平铺文字'),
    content: 'Albumark',
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
    name: t('EXIF 参数条'),
    // 令牌键为英文（见 core/tokens.ts TOKENS），中文写法无法解析
    content: '{Model}　{Lens}\n{FocalLength}　{Aperture}　{Shutter}　{ISO}',
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
  const thinFrame = makeBorderLayer({
    name: t('细白边框'),
    top: 28,
    right: 28,
    bottom: 28,
    left: 28,
  })
  const galleryFrame = [
    makeBorderLayer({
      name: t('画框 · 内衬'),
      top: 44,
      right: 44,
      bottom: 44,
      left: 44,
      colorTop: '#F5F1E8',
      colorRight: '#F5F1E8',
      colorBottom: '#F5F1E8',
      colorLeft: '#F5F1E8',
    }),
    makeBorderLayer({
      name: t('画框 · 外沿'),
      top: 14,
      right: 14,
      bottom: 14,
      left: 14,
      colorTop: '#211D19',
      colorRight: '#211D19',
      colorBottom: '#211D19',
      colorLeft: '#211D19',
    }),
  ]
  // 背景水印模板：BG 层默认 source 'self'（照片自身模糊填充），应用后
  // 到工作室可继续调外扩 / 画幅 / 模糊；背景层随模板 layers 一起迁移
  const blurCard = makeBackgroundLayer({
    name: t('虚化卡纸'),
    expand: 40,
    blur: 45,
    shadow: 30,
    radius: 10,
  })
  const ratioCard = makeBackgroundLayer({
    name: t('画幅卡纸'),
    ratio: '4:5',
    photoScale: 95,
    blur: 60,
    shadow: 20,
  })
  const cardSign = makeTextLayer({
    name: t('签名'),
    content: 'Albumark',
    anchor: 'bottom-center',
    offsetX: 0,
    offsetY: 34,
    scale: 2.6,
  })

  return [
    { id: 'builtin-signature', name: t('右下签名'), builtin: true, layers: [signature], assets: [] },
    { id: 'builtin-tile', name: t('全图平铺'), builtin: true, layers: [tile], assets: [] },
    { id: 'builtin-exif', name: t('EXIF 参数条'), builtin: true, layers: [exifBar], assets: [] },
    { id: 'builtin-frame-thin', name: t('细白边框'), builtin: true, layers: [thinFrame], assets: [] },
    {
      id: 'builtin-frame-gallery',
      name: t('画廊双框'),
      builtin: true,
      layers: galleryFrame,
      assets: [],
    },
    {
      id: 'builtin-bg-blur-card',
      name: t('虚化卡纸'),
      builtin: true,
      layers: [blurCard, cardSign],
      assets: [],
    },
    {
      id: 'builtin-bg-ratio-card',
      name: t('4:5 画幅卡纸'),
      builtin: true,
      layers: [ratioCard, cardSign],
      assets: [],
    },
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

function migrateTemplateLayers(tpl: SavedTemplate): SavedTemplate {
  return { ...tpl, layers: tpl.layers.map(migrateOffsetsToPx) }
}

function loadSaved(): SavedTemplate[] {
  let saved = loadJson<SavedTemplate[]>(PERSIST_KEY, [])
  if (!Array.isArray(saved)) saved = []
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
    if (!saveJson(PERSIST_KEY, saved.value)) {
      toast(t('模板过大，仅保存到本次会话'), 'error')
    }
  }

  /** 序列化体积超限（含序列化抛错）时返回 true，调用方放弃保存 */
  function overLimit(data: unknown): boolean {
    try {
      return JSON.stringify(data).length > SIZE_LIMIT
    } catch {
      return true
    }
  }

  function get(id: string): WatermarkTemplate | undefined {
    return all.value.find((tpl) => tpl.id === id)
  }

  /** 当前编辑内容存为新模板，返回新模板 id（失败返回 null） */
  function save(name: string): string | null {
    const data = wm.serialize()
    const tpl: SavedTemplate = {
      id: uid(),
      name: name.trim() || t('未命名模板'),
      createdAt: Date.now(),
      layers: data.layers,
      assets: data.assets,
    }
    if (overLimit(tpl)) return null
    saved.value.unshift(tpl)
    persist()
    return tpl.id
  }

  /** 把编辑器当前内容写回自建模板；内置模板不可覆盖 */
  function update(id: string): boolean {
    const tpl = saved.value.find((x) => x.id === id)
    if (!tpl) return false
    const data = wm.serialize()
    if (overLimit(data)) return false
    tpl.layers = data.layers
    tpl.assets = data.assets
    tpl.updatedAt = Date.now()
    persist()
    return true
  }

  function rename(id: string, name: string): void {
    const tpl = saved.value.find((x) => x.id === id)
    if (!tpl) return
    tpl.name = name.trim() || tpl.name
    tpl.updatedAt = Date.now()
    persist()
  }

  /** 复制任意模板（含内置）为新的自建模板，返回新 id */
  function duplicate(id: string): string | null {
    const src = all.value.find((x) => x.id === id)
    if (!src) return null
    const tpl: SavedTemplate = {
      id: uid(),
      name: t('{0} 副本', src.name),
      createdAt: Date.now(),
      layers: structuredClone(src.layers),
      assets: structuredClone(src.assets),
    }
    if (overLimit(tpl)) return null
    saved.value.unshift(tpl)
    persist()
    return tpl.id
  }

  /** 名称去重：导入 / 复制时避免列表出现两条同名模板 */
  function uniqueName(raw: string): string {
    const base = raw.trim() || t('未命名模板')
    if (!all.value.some((tpl) => tpl.name === base)) return base
    let i = 2
    while (all.value.some((tpl) => tpl.name === `${base} ${i}`)) i++
    return `${base} ${i}`
  }

  /** 从水印模板 zip 导入的模板：写入自建模板库（重新生成 id，重名自动追加序号） */
  function importTemplate(tpl: WatermarkTemplate): string | null {
    // 素材 id 全局共用一张表：导入时重映射，避免两个模板 zip 携带同一 id
    // 但内容不同时互相顶掉图片
    const idMap = new Map<string, string>()
    for (const a of tpl.assets) idMap.set(a.id, uid())
    const layers = structuredClone(tpl.layers).map((l) => {
      if (l.type === 'image') return { ...l, assetId: idMap.get(l.assetId) ?? l.assetId }
      if (l.type === 'background' && l.source === 'custom' && l.assetId) {
        return { ...l, assetId: idMap.get(l.assetId) ?? l.assetId }
      }
      return l
    })
    const assets = structuredClone(tpl.assets).map((a) => ({
      ...a,
      id: idMap.get(a.id) ?? a.id,
    }))
    const data: SavedTemplate = {
      id: uid(),
      name: uniqueName(tpl.name),
      createdAt: Date.now(),
      layers,
      assets,
    }
    if (overLimit(data)) return null
    saved.value.unshift(data)
    persist()
    return data.id
  }

  function remove(id: string): void {
    saved.value = saved.value.filter((tpl) => tpl.id !== id)
    persist()
  }

  async function apply(id: string): Promise<void> {
    const tpl = all.value.find((x) => x.id === id)
    if (!tpl) return
    wm.applySerialized(tpl.layers, tpl.assets)
  }

  return { saved, all, get, save, update, rename, duplicate, importTemplate, remove, apply }
})
