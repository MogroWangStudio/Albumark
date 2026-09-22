import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { blobToDataUrl, dataUrlToBlob, rasterizeSvg } from '@/core/svg'
import type {
  AnchorPreset,
  ImageLayer,
  LayerPatch,
  TextLayer,
  WatermarkLayer,
} from '@/types/watermark'
import { migrateLayer, migrateOffsetsToPx } from '@/types/watermark'
import type { SerializedAsset } from '@/types/watermark'

export interface WatermarkAsset {
  id: string
  name: string
  blob: Blob | null
  dataUrl: string
  aspect: number
}

const PERSIST_KEY = 'albumark.watermark.v2'
/** 旧版存储键：偏移按长边百分比存储，读取后一次性迁移为固定像素 */
const LEGACY_PERSIST_KEY = 'albumark.watermark.v1'

/** 锚点九宫格的默认边距（像素）。 */
function defaultOffset(anchor: AnchorPreset): { offsetX: number; offsetY: number } {
  const col = anchor.endsWith('left') ? 1 : anchor.endsWith('center') ? 0 : -1
  const row = anchor.startsWith('top') ? 1 : anchor.startsWith('middle') ? 0 : -1
  return { offsetX: col * 40, offsetY: row * 40 }
}

export function makeTextLayer(patch: Partial<TextLayer> = {}): TextLayer {
  return {
    id: uid(),
    type: 'text',
    name: '文本水印',
    visible: true,
    anchor: 'bottom-right',
    ...defaultOffset('bottom-right'),
    scale: 3.6,
    rotation: 0,
    opacity: 100,
    blend: 'normal',
    tile: { enabled: false, gapX: 120, gapY: 90 },
    content: '辑印 Albumark',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontWeight: 600,
    italic: false,
    color: '#FFFFFF',
    letterSpacing: 4,
    lineHeight: 1.45,
    align: 'center',
    shadow: { enabled: true, blur: 18, opacity: 55, x: 0, y: 8 },
    stroke: { enabled: false, width: 6, color: '#000000' },
    background: { enabled: false, color: '#000000', opacity: 45, padding: 6, radius: 14 },
    ...patch,
  }
}

export const useWatermarkStore = defineStore('watermark', () => {
  const layers = ref<WatermarkLayer[]>([])
  const selectedId = ref<string | null>(null)
  const assets = ref<Record<string, WatermarkAsset>>({})
  /** 照片 id → 独立水印图层（会话级），存在即为开启；图层引用全局素材 */
  const perImage = ref<Record<string, WatermarkLayer[]>>({})
  /**
   * 当前编辑目标照片：选中带独立水印的照片时自动指向它，面板编辑其副本；
   * 其余情况为 null（编辑全局水印）。工作室恒为 null。
   */
  const editId = ref<string | null>(null)

  /** 当前生效的水印图层：预览 / 导出用（独立优先，否则全局） */
  function effectiveLayers(id: string | null): WatermarkLayer[] {
    return (id ? perImage.value[id] : undefined) ?? layers.value
  }

  /** 当前正在编辑的图层列表：全部增删改都落在这一份上 */
  function editTarget(): WatermarkLayer[] {
    return (editId.value ? perImage.value[editId.value] : undefined) ?? layers.value
  }

  function isIndividual(id: string | null): boolean {
    return !!id && id in perImage.value
  }

  /** 编辑上下文跟随当前照片：有独立水印则编辑它，否则回全局 */
  function setEditContext(id: string | null): void {
    editId.value = id && perImage.value[id] ? id : null
    selectedId.value = editTarget()[0]?.id ?? null
  }

  /** 开启时把当前生效的图层深拷贝为这张照片的独立水印，关闭即恢复全局 */
  function setIndividual(id: string | null, on: boolean): void {
    if (!id) return
    if (on) {
      perImage.value = { ...perImage.value, [id]: plainLayers() }
      editId.value = id
    } else {
      const next = { ...perImage.value }
      delete next[id]
      perImage.value = next
      if (editId.value === id) editId.value = null
    }
    selectedId.value = editTarget()[0]?.id ?? null
  }

  const selected = computed(
    () => editTarget().find((l) => l.id === selectedId.value) ?? null,
  )

  function update(id: string, patch: LayerPatch): void {
    const layer = editTarget().find((l) => l.id === id)
    if (layer) Object.assign(layer, patch)
  }

  function addText(patch: Partial<TextLayer> = {}): void {
    const layer = makeTextLayer(patch)
    editTarget().push(layer)
    selectedId.value = layer.id
  }

  function addImageLayer(assetId: string, aspect: number, name: string): void {
    const layer: ImageLayer = {
      id: uid(),
      type: 'image',
      name,
      visible: true,
      anchor: 'middle-center',
      offsetX: 0,
      offsetY: 0,
      scale: 20,
      rotation: 0,
      opacity: 100,
      blend: 'normal',
      tile: { enabled: false, gapX: 120, gapY: 90 },
      assetId,
      aspect,
    }
    editTarget().push(layer)
    selectedId.value = layer.id
  }

  async function prepImageFile(file: File): Promise<{ blob: Blob; aspect: number }> {
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      return rasterizeSvg(file)
    }
    try {
      const bmp = await createImageBitmap(file)
      const prep = { blob: file, aspect: bmp.width / bmp.height }
      bmp.close()
      return prep
    } catch {
      throw new Error('图片无法解析')
    }
  }

  async function addImageFile(file: File): Promise<void> {
    const prep = await prepImageFile(file)
    const asset: WatermarkAsset = {
      id: uid(),
      name: file.name,
      blob: prep.blob,
      dataUrl: await blobToDataUrl(prep.blob),
      aspect: prep.aspect,
    }
    assets.value[asset.id] = asset
    addImageLayer(asset.id, prep.aspect, file.name)
  }

  async function replaceImageFile(layerId: string, file: File): Promise<void> {
    const layer = editTarget().find((l) => l.id === layerId)
    if (!layer || layer.type !== 'image') return
    const prep = await prepImageFile(file)
    const asset: WatermarkAsset = {
      id: uid(),
      name: file.name,
      blob: prep.blob,
      dataUrl: await blobToDataUrl(prep.blob),
      aspect: prep.aspect,
    }
    assets.value[asset.id] = asset
    layer.assetId = asset.id
    layer.aspect = prep.aspect
    layer.name = file.name
  }

  function remove(id: string): void {
    const list = editTarget()
    const i = list.findIndex((l) => l.id === id)
    if (i < 0) return
    list.splice(i, 1)
    if (selectedId.value === id) selectedId.value = null
  }

  function move(index: number, dir: -1 | 1): void {
    const list = editTarget()
    const j = index + dir
    if (index < 0 || index >= list.length || j < 0 || j >= list.length) return
    const [l] = list.splice(index, 1)
    list.splice(j, 0, l)
  }

  /** 点击九宫格：设为定位锚点，并把偏移重置为该角落的默认边距。 */
  function positionPreset(anchor: AnchorPreset): void {
    if (!selectedId.value) return
    update(selectedId.value, { anchor, ...defaultOffset(anchor) })
  }

  /** 深拷贝为纯数据：响应式 Proxy 无法传给 Worker（结构化克隆限制）。 */
  function plainLayers(): WatermarkLayer[] {
    return toRaw(layers.value).map((l) => structuredClone(toRaw(l)))
  }

  /** 全部照片独立水印的纯数据快照，供导出 Worker 使用 */
  function perImageSnapshot(): Record<string, WatermarkLayer[]> {
    const out: Record<string, WatermarkLayer[]> = {}
    for (const [id, list] of Object.entries(perImage.value)) {
      out[id] = structuredClone(toRaw(list))
    }
    return out
  }

  /** 收集图层引用到的素材（惰性把 dataUrl 还原成 Blob 供 Worker 使用）。 */
  async function assetPayloads(layerList: WatermarkLayer[]): Promise<{ id: string; blob: Blob }[]> {
    const ids = new Set(layerList.filter((l) => l.type === 'image').map((l) => l.assetId))
    const out: { id: string; blob: Blob }[] = []
    for (const id of ids) {
      const a = assets.value[id]
      if (!a) continue
      if (!a.blob) a.blob = await dataUrlToBlob(a.dataUrl)
      out.push({ id, blob: a.blob })
    }
    return out
  }

  function applySerialized(layersData: WatermarkLayer[], assetData: SerializedAsset[]): void {
    for (const a of assetData) {
      if (!assets.value[a.id]) {
        assets.value[a.id] = { ...a, blob: null }
      }
    }
    layers.value = layersData.map((l) => migrateLayer(structuredClone(l)))
    selectedId.value = layers.value[0]?.id ?? null
  }

  function serialize(): { layers: WatermarkLayer[]; assets: SerializedAsset[] } {
    const raw = toRaw(layers.value)
    const used = new Set(raw.filter((l) => l.type === 'image').map((l) => (l as ImageLayer).assetId))
    const list: SerializedAsset[] = []
    for (const a of Object.values(assets.value)) {
      if (used.has(a.id)) list.push({ id: a.id, name: a.name, dataUrl: a.dataUrl, aspect: a.aspect })
    }
    return { layers: structuredClone(raw), assets: list }
  }

  // 持久化全局水印配置（素材以 dataUrl 内嵌，超限则放弃；独立水印随会话）
  let persistTimer: number | null = null
  function schedulePersist(): void {
    if (persistTimer) window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(persist, 500)
  }
  function persist(): void {
    try {
      const data = serialize()
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(data))
    } catch {
      /* 素材过大等情况直接放弃持久化 */
    }
  }
  function hydrate(): boolean {
    try {
      let raw = window.localStorage.getItem(PERSIST_KEY)
      let fromLegacy = false
      if (!raw) {
        raw = window.localStorage.getItem(LEGACY_PERSIST_KEY)
        fromLegacy = true
        if (!raw) return false
      }
      const data = JSON.parse(raw) as { layers: WatermarkLayer[]; assets: SerializedAsset[] }
      if (!Array.isArray(data.layers) || !data.layers.length) return false
      layers.value = data.layers.map((l) => migrateLayer(l))
      if (fromLegacy) {
        // 旧偏移为长边百分比，折算成固定像素后写入新键
        layers.value = layers.value.map(migrateOffsetsToPx)
        window.localStorage.removeItem(LEGACY_PERSIST_KEY)
      }
      for (const a of data.assets ?? []) {
        assets.value[a.id] = { ...a, blob: null }
      }
      selectedId.value = layers.value[0]?.id ?? null
      if (fromLegacy) schedulePersist()
      return true
    } catch {
      return false
    }
  }

  return {
    layers,
    selectedId,
    assets,
    perImage,
    editId,
    selected,
    effectiveLayers,
    editTarget,
    isIndividual,
    setEditContext,
    setIndividual,
    update,
    addText,
    addImageFile,
    replaceImageFile,
    addImageLayer,
    remove,
    move,
    positionPreset,
    plainLayers,
    perImageSnapshot,
    assetPayloads,
    applySerialized,
    serialize,
    schedulePersist,
    hydrate,
  }
})
