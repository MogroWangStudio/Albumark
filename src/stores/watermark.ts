import { computed, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { blobToDataUrl, dataUrlToBlob, rasterizeSvg } from '@/core/svg'
import type {
  AnchorPreset,
  BorderLayer,
  ImageLayer,
  LayerPatch,
  TextLayer,
  TextLayerPatch,
  WatermarkLayer,
} from '@/types/watermark'
import { migrateLayer, migrateOffsetsToPx } from '@/types/watermark'
import type { SerializedAsset } from '@/types/watermark'
import { useWorkspaceStore } from './workspace'

/** 图层与资产是纯 JSON 数据；structuredClone 会拒绝 Vue 的响应式 Proxy（模板对象来自 store），故用 JSON 深拷贝 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export interface WatermarkAsset {
  id: string
  name: string
  blob: Blob | null
  dataUrl: string
  aspect: number
}

/* ---------- 持久化：按工作项目分片 ----------
   水印属于「这个工作项目的排版」，不是整个软件、也不是整个工作目录的设置：
   每个工作项目一份配置（存储键带项目 id），切换项目即换用对应的一份；
   同目录下的其他项目、其他目录、以及尚未打开项目的状态都读不到这份水印。
   上一版按工作目录分片（v3）的数据不再有归属：升级后并入该目录下第一个
   打开的项目，随后删除；更早的单一全局键（v2 / v1）同样只迁移一次。 */
const PERSIST_PREFIX = 'albumark.watermark.v4:'
/** 上一版的工作目录分片，仅用于一次性迁移，迁移后立即删除 */
const DIR_PERSIST_PREFIX = 'albumark.watermark.v3:'
const LEGACY_PERSIST_KEY = 'albumark.watermark.v2'
/** 更早的存储键：偏移按长边百分比存储，读取后一次性迁移为固定像素 */
const LEGACY_V1_KEY = 'albumark.watermark.v1'
/** 旧全局配置只迁移一次，避免把同一份水印带给后续每个项目 */
const MIGRATED_KEY = 'albumark.watermark.v4:migrated'
/** 浏览器临时项目（没有磁盘路径）单独一份配置 */
export const EPHEMERAL_WATERMARK_SCOPE = '__ephemeral__'
/** 项目作用域前缀：与临时作用域、以及历史上的裸目录路径区分开 */
const PROJECT_SCOPE_PREFIX = 'p:'

interface StoredWatermark {
  layers: WatermarkLayer[]
  assets?: SerializedAsset[]
}

/** 锚点九宫格的默认边距（像素）。 */
function defaultOffset(anchor: AnchorPreset): { offsetX: number; offsetY: number } {
  const col = anchor.endsWith('left') ? 1 : anchor.endsWith('center') ? 0 : -1
  const row = anchor.startsWith('top') ? 1 : anchor.startsWith('middle') ? 0 : -1
  return { offsetX: col * 40, offsetY: row * 40 }
}

export function makeTextLayer(patch: Partial<TextLayer> = {}): TextLayer {
  const anchor = patch.anchor ?? 'bottom-right'
  return {
    id: uid(),
    type: 'text',
    name: '文本水印',
    visible: true,
    anchor,
    ...defaultOffset(anchor),
    // 文字框锚点跟随定位锚点：贴边文字向图内展开，框中心对准角落会越界
    boxAnchor: anchor,
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

export function makeBorderLayer(patch: Partial<BorderLayer> = {}): BorderLayer {
  return {
    id: uid(),
    type: 'border',
    name: '边框',
    visible: true,
    top: 24,
    right: 24,
    bottom: 24,
    left: 24,
    colorTop: '#FFFFFF',
    colorRight: '#FFFFFF',
    colorBottom: '#FFFFFF',
    colorLeft: '#FFFFFF',
    ...patch,
  }
}

export const useWatermarkStore = defineStore('watermark', () => {
  /** 工作区 store：作用域直接从它推导（store 间单向依赖，workspace 不回引水印） */
  const ws = useWorkspaceStore()
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
  /** 水印工作室沙箱：工作室内的编辑只落在草稿上，退回编辑界面即丢弃，不影响照片水印 */
  const studioActive = ref(false)
  const studioLayers = ref<WatermarkLayer[]>([])
  /**
   * 水印作用域：当前工作项目的标识（`p:<项目 id>`；浏览器临时项目为
   * EPHEMERAL_WATERMARK_SCOPE）。
   * 空串 = 尚未打开任何工作项目，此时不读也不写任何水印配置。
   */
  const scopeKey = ref('')
  /** 逐图独立水印是会话级数据，按作用域暂存：切换项目再切回来仍然保留 */
  const perImageByScope = new Map<string, Record<string, WatermarkLayer[]>>()

  /** 进入工作室：快照一份当前项目的水印作为草稿，工作室的全部编辑都只作用于草稿 */
  function enterStudio(): void {
    studioLayers.value = plainLayers()
    studioActive.value = true
    setEditContext(null)
  }

  /** 离开工作室：丢弃草稿，编辑上下文回到项目级水印 */
  function exitStudio(): void {
    studioActive.value = false
    studioLayers.value = []
    setEditContext(null)
  }

  /** 当前生效的水印图层：预览 / 导出用（单张独立优先，否则当前项目的水印） */
  function effectiveLayers(id: string | null): WatermarkLayer[] {
    return (id ? perImage.value[id] : undefined) ?? layers.value
  }

  /** 当前正在编辑的图层列表：工作室编辑草稿，面板按上下文编辑独立副本或项目级水印 */
  function editTarget(): WatermarkLayer[] {
    if (studioActive.value) return studioLayers.value
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

  /** 开启时把当前生效的图层深拷贝为这张照片的独立水印，关闭即恢复项目级水印 */
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
    if (!layer) return
    Object.assign(layer, patch)
    // 边框同步保护：链接状态下四边宽度出现不一致（模板数据、批量修改等）→ 自动断开
    if (layer.type === 'border' && layer.linked !== false) {
      if (layer.top !== layer.right || layer.right !== layer.bottom || layer.bottom !== layer.left) {
        layer.linked = false
      }
    }
  }

  function addText(patch: Partial<TextLayer> = {}): void {
    const layer = makeTextLayer(patch)
    editTarget().push(layer)
    selectedId.value = layer.id
  }

  function addBorderLayer(patch: Partial<BorderLayer> = {}): void {
    const layer = makeBorderLayer(patch)
    // 边框按「图层列表靠前者更贴近照片」叠加：新边框放在已有边框之后、其余图层之前
    const list = editTarget()
    const lastBorder = list.map((l) => l.type).lastIndexOf('border')
    list.splice(lastBorder + 1, 0, layer)
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

  /** 点击九宫格：设为定位锚点，偏移重置为该角落的默认边距；文字框锚点跟随（向图内展开）。 */
  function positionPreset(anchor: AnchorPreset): void {
    if (!selectedId.value) return
    const layer = editTarget().find((l) => l.id === selectedId.value)
    const patch: LayerPatch = { anchor, ...defaultOffset(anchor) }
    if (layer?.type === 'text') (patch as TextLayerPatch).boxAnchor = anchor
    update(selectedId.value, patch)
  }

  /** 深拷贝为纯数据：响应式 Proxy 无法传给 Worker（结构化克隆限制）。工作室时取草稿 */
  function plainLayers(): WatermarkLayer[] {
    const list = studioActive.value ? studioLayers.value : layers.value
    return toRaw(list).map((l) => structuredClone(toRaw(l)))
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
    if (studioActive.value) {
      // 工作室内应用模板只写草稿，不触碰照片正在使用的目录级水印
      studioLayers.value = layersData.map((l) => migrateLayer(deepClone(l)))
      selectedId.value = studioLayers.value[0]?.id ?? null
      return
    }
    layers.value = layersData.map((l) => migrateLayer(deepClone(l)))
    selectedId.value = layers.value[0]?.id ?? null
  }

  /**
   * 把模板图层应用到当前编辑目标（全局或独立水印副本）。
   * replace 完全覆盖，append 追加到现有图层之后。
   */
  function applyToTarget(
    layersData: WatermarkLayer[],
    assetData: SerializedAsset[],
    mode: 'replace' | 'append',
  ): void {
    for (const a of assetData) {
      if (!assets.value[a.id]) {
        assets.value[a.id] = { ...a, blob: null }
      }
    }
    const incoming = layersData.map((l) => migrateLayer(deepClone(l)))
    if (mode === 'replace' && studioActive.value) {
      // 工作室沙箱：覆盖 / 追加都只作用于草稿
      studioLayers.value = incoming
    } else if (mode === 'replace' && editId.value) {
      perImage.value = { ...perImage.value, [editId.value]: incoming }
    } else if (mode === 'replace') {
      layers.value = incoming
    } else {
      editTarget().push(...incoming)
    }
    selectedId.value = incoming[0]?.id ?? null
    // 只有项目级水印需要落盘；单张照片的独立水印属于会话数据
    if (!studioActive.value && !editId.value) schedulePersist()
  }

  /** 序列化一组图层（连同它们引用的素材）：模板保存与目录持久化共用 */
  function serializeList(list: WatermarkLayer[]): { layers: WatermarkLayer[]; assets: SerializedAsset[] } {
    const raw = toRaw(list)
    const used = new Set(raw.filter((l) => l.type === 'image').map((l) => (l as ImageLayer).assetId))
    const assetsOut: SerializedAsset[] = []
    for (const a of Object.values(assets.value)) {
      if (used.has(a.id)) assetsOut.push({ id: a.id, name: a.name, dataUrl: a.dataUrl, aspect: a.aspect })
    }
    return { layers: deepClone(raw), assets: assetsOut }
  }

  /** 保存模板时序列化当前编辑目标（可能是某张照片的独立水印） */
  function serialize(): { layers: WatermarkLayer[]; assets: SerializedAsset[] } {
    return serializeList(editTarget())
  }

  /* ---------- 持久化：只写当前工作目录的分片 ---------- */

  function scopedStorageKey(scope: string): string {
    return PERSIST_PREFIX + encodeURIComponent(scope)
  }

  function readStored(scope: string): StoredWatermark | null {
    try {
      const raw = window.localStorage.getItem(scopedStorageKey(scope))
      if (!raw) return null
      const data = JSON.parse(raw) as StoredWatermark
      return data && Array.isArray(data.layers) ? data : null
    } catch {
      return null
    }
  }

  /** 旧版全局配置：只并入第一个打开的工作项目，之后作废 */
  function takeLegacy(): StoredWatermark | null {
    try {
      if (window.localStorage.getItem(MIGRATED_KEY)) return null
      let raw = window.localStorage.getItem(LEGACY_PERSIST_KEY)
      let fromV1 = false
      if (!raw) {
        raw = window.localStorage.getItem(LEGACY_V1_KEY)
        fromV1 = Boolean(raw)
      }
      if (!raw) {
        window.localStorage.setItem(MIGRATED_KEY, '1')
        return null
      }
      const data = JSON.parse(raw) as StoredWatermark
      if (!data || !Array.isArray(data.layers)) return null
      // 先完成旧格式折算，确认没抛错再移除旧键，避免迁移失败把配置弄丢
      if (fromV1) data.layers = data.layers.map(migrateOffsetsToPx)
      window.localStorage.setItem(MIGRATED_KEY, '1')
      window.localStorage.removeItem(LEGACY_PERSIST_KEY)
      window.localStorage.removeItem(LEGACY_V1_KEY)
      return data
    } catch {
      return null
    }
  }

  /**
   * 旧全局键就地作废（不取数据）。当前项目已有自己的配置时调用——
   * 否则旧键会一直躺在原地，等某个后打开的新项目把它捡走：
   * 那正是「新项目莫名出现别人的水印」的来源。
   */
  function retireLegacy(): void {
    try {
      if (window.localStorage.getItem(MIGRATED_KEY)) return
      window.localStorage.setItem(MIGRATED_KEY, '1')
      window.localStorage.removeItem(LEGACY_PERSIST_KEY)
      window.localStorage.removeItem(LEGACY_V1_KEY)
    } catch {
      /* 存储异常时宁可少删：所有读取路径都有空值兜底 */
    }
  }

  /** 上一版按工作目录存储的分片键（目录路径本身就是旧版的 scope 值） */
  function dirStorageKey(dirPath: string): string {
    return DIR_PERSIST_PREFIX + encodeURIComponent(dirPath)
  }

  /**
   * 取走上一版的工作目录分片（并立即删除）。它是「整个目录共用一份」的旧数据，
   * 没有项目之外的归属：只并入该目录下**第一个被打开的项目**，同目录的其余项目
   * 从无水印开始——否则每个项目都会拿到同一份，跨项目串显就复现了。
   */
  function takeDirShard(): StoredWatermark | null {
    const dirPath = ws.dir?.path
    if (!dirPath) return null
    try {
      const raw = window.localStorage.getItem(dirStorageKey(dirPath))
      // 无论能否解析都不再保留：目录级配置不应流向第二个项目
      window.localStorage.removeItem(dirStorageKey(dirPath))
      if (!raw) return null
      const data = JSON.parse(raw) as StoredWatermark
      return data && Array.isArray(data.layers) ? data : null
    } catch {
      return null
    }
  }

  /** 目录级分片就地作废（当前项目已有自己的配置，或迁移已经完成） */
  function retireDirShard(): void {
    const dirPath = ws.dir?.path
    if (!dirPath) return
    try {
      window.localStorage.removeItem(dirStorageKey(dirPath))
    } catch {
      /* 少删不影响正确性：读取路径有空值兜底 */
    }
  }

  function adoptStored(data: StoredWatermark): void {
    layers.value = data.layers.map((l) => migrateLayer(deepClone(l)))
    for (const a of data.assets ?? []) {
      // 素材缓存是会话级的：同 id 已经加载过就不覆盖
      if (!assets.value[a.id]) assets.value[a.id] = { ...a, blob: null }
    }
  }

  let persistTimer: number | null = null
  function schedulePersist(): void {
    if (persistTimer) window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(persist, 500)
  }
  function persist(): void {
    // 工作室草稿不写入；没有打开项目时也没有可写的分片
    if (studioActive.value || !scopeKey.value) return
    // 项目从未存过配置、现在也没有任何图层：不落盘，不给它留一个空分片
    // （空分片还会挡住之后可能的旧数据迁移）
    if (!layers.value.length && !readStored(scopeKey.value)) return
    try {
      // 恒写「项目级」水印：正在编辑某张照片的独立水印时，不能把它顶成项目默认
      window.localStorage.setItem(scopedStorageKey(scopeKey.value), JSON.stringify(serializeList(layers.value)))
    } catch {
      /* 素材过大等情况直接放弃持久化 */
    }
  }
  /** 立即写出防抖中的水印：切目录 / 切后台 / 退出前调用，避免 500ms 窗口丢改动 */
  function flushPersist(): void {
    if (persistTimer) {
      window.clearTimeout(persistTimer)
      persistTimer = null
    }
    persist()
  }

  /**
   * 撤销 / 重做：整份替换当前项目的项目级水印与逐图独立水印。
   * 只处理照片使用中的图层，不碰工作室草稿（草稿有自己的保存语义）。
   */
  function restoreState(
    nextLayers: WatermarkLayer[],
    nextPerImage: Record<string, WatermarkLayer[]>,
  ): void {
    layers.value = nextLayers.map((l) => migrateLayer(deepClone(l)))
    const im: Record<string, WatermarkLayer[]> = {}
    for (const [id, list] of Object.entries(nextPerImage)) {
      im[id] = list.map((l) => migrateLayer(deepClone(l)))
    }
    perImage.value = im
    selectedId.value = editTarget()[0]?.id ?? null
    schedulePersist()
  }

  /**
   * 切换水印作用域（工作项目）。
   *
   * 这是「水印只属于一个工作项目」的闸门：切换时先把旧项目的改动落盘、
   * 暂存它的逐图水印，再清空运行态并载入新项目的配置。
   * 传入空串 = 当前没有打开项目：保持无水印，绝不沿用上一个项目的图层。
   * 分片数据损坏时同样落在「无水印」——绝不回退到其他项目的配置。
   */
  function setScope(next: string): void {
    const key = next || ''
    if (key === scopeKey.value) return
    if (studioActive.value) {
      // 工作室草稿没有跨项目的语义：切项目等同于离开工作室
      studioActive.value = false
      studioLayers.value = []
    }
    if (scopeKey.value) {
      flushPersist()
      perImageByScope.set(scopeKey.value, perImage.value)
    }
    scopeKey.value = key
    layers.value = []
    perImage.value = key ? (perImageByScope.get(key) ?? {}) : {}
    editId.value = null
    selectedId.value = null
    if (!key) return
    try {
      const stored = readStored(key)
      if (stored) {
        adoptStored(stored)
      } else {
        // 迁移优先级：上一版的目录分片（更近）> 更旧的单一全局键
        const inherited = takeDirShard() ?? takeLegacy()
        if (inherited) {
          adoptStored(inherited)
          // 迁移结果立即写成这个项目自己的分片，其他项目读不到
          persist()
        }
      }
      // 无论来自哪里：旧全局键与目录级分片就地作废，绝不流向之后打开的项目
      retireLegacy()
      retireDirShard()
    } catch {
      /* 分片损坏 / 迁移失败：保持无水印，也不碰任何其他项目的数据 */
    }
    selectedId.value = editTarget()[0]?.id ?? null
  }

  /**
   * 作用域绑定长在 store 内部：由当前工作项目直接推导，项目变即换配置。
   * 曾经依赖 App.vue 的组件 watch 手动同步——那条链路上任何一环脱钩
   * （store 热更新重建、监听注册晚于项目装载、后续重构改动装配顺序）
   * 都会让 scopeKey 与实际项目永久脱节、水印凭空消失或串项目。
   * watch 以 immediate 注册：store 无论何时创建，都先对齐到当前项目。
   */
  const derivedScope = computed(() => {
    const p = ws.current
    if (!p) return ''
    // 浏览器临时项目没有磁盘路径：整个会话共用一份固定作用域
    if (!p.path) return EPHEMERAL_WATERMARK_SCOPE
    return PROJECT_SCOPE_PREFIX + p.id
  })
  watch(derivedScope, (next) => setScope(next), { immediate: true })

  /** 按当前工作项目立即对齐作用域。绑定是自动的，通常无需手动调用。 */
  function syncScope(): void {
    setScope(derivedScope.value)
  }

  /**
   * 项目被删除：它的分片不再有归属，一并清除，避免残留数据在新建同名项目
   * 或复用 id 时被读回来。
   */
  function forgetProject(id: string): void {
    const key = PROJECT_SCOPE_PREFIX + id
    perImageByScope.delete(key)
    try {
      window.localStorage.removeItem(scopedStorageKey(key))
    } catch {
      /* 清不掉也不影响正确性 */
    }
    if (scopeKey.value === key) setScope('')
  }

  // 项目级水印的手动编辑（拖动、改字、增删图层）同样走防抖持久化；
  // 只观察 layers：逐图独立水印属于会话数据，不写进项目配置
  watch(layers, () => schedulePersist(), { deep: true })

  return {
    layers,
    selectedId,
    assets,
    perImage,
    editId,
    studioActive,
    /** 当前工作项目作用域（`p:<id>`；空串 = 未打开任何项目） */
    scopeKey,
    enterStudio,
    exitStudio,
    selected,
    effectiveLayers,
    editTarget,
    isIndividual,
    setEditContext,
    setIndividual,
    update,
    addText,
    addBorderLayer,
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
    applyToTarget,
    serialize,
    schedulePersist,
    flushPersist,
    restoreState,
    setScope,
    syncScope,
    forgetProject,
  }
})
