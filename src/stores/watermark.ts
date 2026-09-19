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
import { migrateLayer } from '@/types/watermark'
import type { SerializedAsset } from '@/types/watermark'

export interface WatermarkAsset {
  id: string
  name: string
  blob: Blob | null
  dataUrl: string
  aspect: number
}

const PERSIST_KEY = 'albumark.watermark.v1'

/** 锚点九宫格的默认边距（相对图片宽/高的百分比）。 */
function defaultOffset(anchor: AnchorPreset): { offsetX: number; offsetY: number } {
  const col = anchor.endsWith('left') ? 1 : anchor.endsWith('center') ? 0 : -1
  const row = anchor.startsWith('top') ? 1 : anchor.startsWith('middle') ? 0 : -1
  return { offsetX: col * 4, offsetY: row * 4 }
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

  const selected = computed(
    () => layers.value.find((l) => l.id === selectedId.value) ?? null,
  )

  function update(id: string, patch: LayerPatch): void {
    const layer = layers.value.find((l) => l.id === id)
    if (layer) Object.assign(layer, patch)
  }

  function addText(patch: Partial<TextLayer> = {}): void {
    const layer = makeTextLayer(patch)
    layers.value.push(layer)
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
    layers.value.push(layer)
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
    const layer = layers.value.find((l) => l.id === layerId)
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
    const i = layers.value.findIndex((l) => l.id === id)
    if (i < 0) return
    layers.value.splice(i, 1)
    if (selectedId.value === id) selectedId.value = null
  }

  function move(index: number, dir: -1 | 1): void {
    const j = index + dir
    if (index < 0 || index >= layers.value.length || j < 0 || j >= layers.value.length) return
    const [l] = layers.value.splice(index, 1)
    layers.value.splice(j, 0, l)
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

  // 持久化当前水印配置（素材以 dataUrl 内嵌，超限则放弃）
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
      const raw = window.localStorage.getItem(PERSIST_KEY)
      if (!raw) return false
      const data = JSON.parse(raw) as { layers: WatermarkLayer[]; assets: SerializedAsset[] }
      if (!Array.isArray(data.layers) || !data.layers.length) return false
      layers.value = data.layers.map((l) => migrateLayer(l))
      for (const a of data.assets ?? []) {
        assets.value[a.id] = { ...a, blob: null }
      }
      selectedId.value = layers.value[0]?.id ?? null
      return true
    } catch {
      return false
    }
  }

  return {
    layers,
    selectedId,
    assets,
    selected,
    update,
    addText,
    addImageFile,
    replaceImageFile,
    addImageLayer,
    remove,
    move,
    positionPreset,
    plainLayers,
    assetPayloads,
    applySerialized,
    serialize,
    schedulePersist,
    hydrate,
  }
})
