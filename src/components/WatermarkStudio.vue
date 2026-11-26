<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, Check, Download, ImagePlus, Plus, RotateCcw, Save } from 'lucide-vue-next'
import LayerEditor from '@/components/LayerEditor.vue'
import TemplateManager from '@/components/TemplateManager.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { type AssetMap } from '@/core/draw'
import { backgroundAspect, layoutBackgroundFrame } from '@/core/bg'
import { loadSampleBitmap, paintComposed, SAMPLE_VARIANTS, type SampleOrientation } from '@/core/sample'
import { hitTest, layerAnchor, layerHandles, layerPivot, measureLayer } from '@/core/layout'
import { clampPanAxis, rubberband } from '@/core/viewmotion'
import { pickBinaryFile, saveBinaryFile, isTauri } from '@/core/platform'
import { packWatermarkTemplate, TEMPLATE_MIME, watermarkFileName } from '@/core/watermarkFile'
import { resolveTokens, SAMPLE_EXIF } from '@/core/tokens'
import { useI18n } from '@/i18n'
import { toast } from '@/stores/toast'
import { useSettingsStore } from '@/stores/settings'
import { useTemplatesStore } from '@/stores/templates'
import { useWatermarkStore } from '@/stores/watermark'
import type { BackgroundLayer, ImageLayer, TextLayer, WatermarkLayer, WatermarkTemplate } from '@/types/watermark'

const emit = defineEmits<{ back: [] }>()

const wm = useWatermarkStore()
const settings = useSettingsStore()
const templates = useTemplatesStore()
const { t } = useI18n()

/* ---------- 两级视图：模板管理（默认）⇄ 模板编辑 ---------- */

const mode = ref<'manage' | 'edit'>('manage')
/** 正在编辑的模板 id；null 表示尚未保存的新模板 */
const editingId = ref<string | null>(null)
const showSave = ref(false)
const saveName = ref('')

const editingBuiltin = computed(
  () => !!editingId.value && !!templates.get(editingId.value)?.builtin,
)
const editingName = computed(() =>
  editingId.value ? (templates.get(editingId.value)?.name ?? t('未命名模板')) : t('新建模板'),
)

/** 打开一个模板进入编辑（加载其图层与素材） */
function openEdit(id: string): void {
  void templates.apply(id)
  editingId.value = id
  mode.value = 'edit'
}

/** 新建空白模板：清空编辑器后进入编辑，保存时命名 */
function openCreate(): void {
  wm.applySerialized([], [])
  editingId.value = null
  mode.value = 'edit'
}

function backToManage(): void {
  mode.value = 'manage'
}

/** 保存：自建模板写回；内置模板与新建模板走「另存为」 */
function saveEdit(): void {
  if (editingId.value && !editingBuiltin.value) {
    if (templates.update(editingId.value)) toast(t('已保存「{0}」', editingName.value), 'success')
    else toast(t('模板过大，保存失败'), 'error')
    return
  }
  startSaveAs()
}

/** 另存为：弹出名称栏，把当前编辑内容存为新模板 */
function startSaveAs(): void {
  saveName.value = editingBuiltin.value ? t('{0} 副本', editingName.value) : ''
  showSave.value = true
}

async function saveAsNew(): Promise<void> {
  const name = saveName.value.trim()
  if (!name) return
  const id = templates.save(name)
  if (!id) {
    toast(t('模板过大，保存失败'), 'error')
    return
  }
  showSave.value = false
  saveName.value = ''
  editingId.value = id
  toast(t('已保存模板「{0}」', name), 'success')
}

/** 导出当前编辑内容为单个 .zip 模板（不要求先保存，便于快速分享草稿） */
async function exportEditing(): Promise<void> {
  const data = wm.serialize()
  const meta = editingId.value ? templates.get(editingId.value) : undefined
  const tpl: WatermarkTemplate = {
    id: editingId.value ?? 'current',
    name: meta?.name ?? editingName.value,
    createdAt: meta?.createdAt ?? Date.now(),
    layers: data.layers,
    assets: data.assets,
  }
  try {
    const saved = await saveBinaryFile(watermarkFileName(tpl.name), packWatermarkTemplate(tpl), {
      label: t('水印模板 (.zip)'),
      extensions: ['zip'],
      mime: TEMPLATE_MIME,
      sub: 'watermarks',
    })
    if (saved) toast(t('已导出模板「{0}」', tpl.name), 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : t('导出模板失败'), 'error')
  }
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const boxEl = ref<HTMLDivElement | null>(null)
/** 画布上悬停/拖动到图层时的抓取光标 */
const grabbing = ref(false)

let sampleBmp: ImageBitmap | null = null
const assetBmps: AssetMap = new Map()
let rafPending = false

/* ---------- 测试画幅：常见比例 + 自定义长宽 ----------
   两张品牌底图分别作为横 / 竖样张；选定比例后用「cover」裁切铺满目标画布，
   水印坐标系随之切换。竖构图是水印最容易翻车的场景，1:1 / 4:5 / 自定义
   长宽让贴边文字与锚点在真实交付画幅上先过一遍。 */
export type TestRatio = '16:9' | '9:16' | '1:1' | '4:5' | '3:2' | 'custom'

const RATIO_DIMS: Record<Exclude<TestRatio, 'custom'>, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1440, h: 1440 },
  '4:5': { w: 1440, h: 1800 },
  '3:2': { w: 1800, h: 1200 },
}

const ratio = ref<TestRatio>('16:9')
const customW = ref(1920)
const customH = ref(1080)
const testW = ref(1920)
const testH = ref(1080)
const sampleW = computed(() => testW.value)
const sampleH = computed(() => testH.value)
/** 源样张缓存（按横 / 竖选择）与最终裁剪结果缓存（按尺寸） */
const sourceBmps = new Map<SampleOrientation, ImageBitmap>()
const sampleBmps = new Map<string, ImageBitmap>()
/** 自定义测试图片：非空时完全取代内置横 / 竖样张 */
let customSource: ImageBitmap | null = null
let customKey = ''
let customSeq = 0
const hasCustomSample = ref(false)
const customFileInput = ref<HTMLInputElement | null>(null)

function sourceOrientation(): SampleOrientation {
  return testH.value > testW.value ? 'portrait' : 'landscape'
}

async function ensureSampleBitmap(): Promise<ImageBitmap> {
  const key = `${customSource ? `c:${customKey}` : sourceOrientation()}:${testW.value}x${testH.value}`
  const cached = sampleBmps.get(key)
  if (cached) return cached
  let src: ImageBitmap
  if (customSource) {
    src = customSource
  } else {
    const o = sourceOrientation()
    let loaded = sourceBmps.get(o)
    if (!loaded) {
      loaded = await loadSampleBitmap(SAMPLE_VARIANTS[o])
      sourceBmps.set(o, loaded)
    }
    src = loaded
  }
  // cover 裁切：保持样张原比例，裁掉多余部分铺满目标画布
  const canvas = document.createElement('canvas')
  canvas.width = testW.value
  canvas.height = testH.value
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const scale = Math.max(canvas.width / src.width, canvas.height / src.height)
  const dw = src.width * scale
  const dh = src.height * scale
  ctx.drawImage(src, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
  const bmp = await createImageBitmap(canvas)
  // 自定义长宽反复试时会不断生成新位图：只留最近 5 份，超出的立即释放
  if (sampleBmps.size >= 5) {
    const oldest = sampleBmps.keys().next().value
    if (oldest) {
      sampleBmps.get(oldest)?.close()
      sampleBmps.delete(oldest)
    }
  }
  sampleBmps.set(key, bmp)
  return bmp
}

function clearSampleCache(): void {
  for (const b of sampleBmps.values()) b.close()
  sampleBmps.clear()
}

/** 载入用户自己的测试图片：工作室里用真实照片检验水印观感 */
async function setCustomSample(blob: Blob): Promise<void> {
  try {
    const bmp = await createImageBitmap(blob)
    customSource?.close()
    customSource = bmp
    customKey = `${++customSeq}:${bmp.width}x${bmp.height}`
    hasCustomSample.value = true
    clearSampleCache()
    sampleBmp = null
    await applyTestSize(testW.value, testH.value)
  } catch {
    toast(t('图片无法解析'), 'error')
  }
}

function chooseTestImage(): void {
  if (isTauri) {
    void pickTestImage()
    return
  }
  customFileInput.value?.click()
}

async function pickTestImage(): Promise<void> {
  const picked = await pickBinaryFile(
    t('选择测试图片'),
    ['jpg', 'jpeg', 'png', 'webp'],
    t('图片文件（JPG/PNG/WEBP）'),
  )
  if (!picked) return
  const ext = picked.name.toLowerCase().split('.').pop()
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  await setCustomSample(
    new Blob([picked.bytes.slice().buffer as ArrayBuffer], { type }),
  )
}

async function onCustomFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await setCustomSample(file)
}

/** 恢复内置样张 */
async function resetSample(): Promise<void> {
  customSource?.close()
  customSource = null
  customKey = ''
  hasCustomSample.value = false
  clearSampleCache()
  sampleBmp = null
  await applyTestSize(testW.value, testH.value)
}

/** 切换测试画幅：重取样张位图、复位缩放与平移（画幅变了，旧视图没有意义） */
let orientSeq = 0
async function applyTestSize(w: number, h: number): Promise<void> {
  const safeW = Number.isFinite(w) ? w : testW.value
  const safeH = Number.isFinite(h) ? h : testH.value
  const cw = Math.min(4096, Math.max(160, Math.round(safeW)))
  const ch = Math.min(4096, Math.max(160, Math.round(safeH)))
  testW.value = cw
  testH.value = ch
  stopViewAnim()
  viewZoom.value = 1
  viewPan.x = 0
  viewPan.y = 0
  // 连续快速切换时只认最后一次：较早的 await 返回后不再覆盖画布位图
  const seq = ++orientSeq
  sampleBmp = null
  const bmp = await ensureSampleBitmap()
  if (seq !== orientSeq) return
  sampleBmp = bmp
  redraw()
}

function selectRatio(next: TestRatio): void {
  ratio.value = next
  if (next === 'custom') {
    customW.value = testW.value
    customH.value = testH.value
    void applyTestSize(customW.value, customH.value)
    return
  }
  const dims = RATIO_DIMS[next]
  customW.value = dims.w
  customH.value = dims.h
  void applyTestSize(dims.w, dims.h)
}

function applyCustomSize(): void {
  void applyTestSize(customW.value, customH.value)
}

/** 最近一次绘制到画布的映射（设备像素），命中测试与拖拽换算用 */
const vmap = { scale: 1, ox: 0, oy: 0, dpr: 1 }
/** 水印坐标系尺寸（照片区域；背景模式不含背景外扩，供面板字号换算与命中） */
const wmSpace = reactive({ w: 1920, h: 1080 })

function hasVisibleBackground(): boolean {
  return wm.editTarget().some((l) => l.type === 'background' && l.visible)
}

/** 选中框手柄的屏幕尺度：四角缩放点 + 顶部旋转点 */
const HANDLE_HIT_CSS = 14
const HANDLE_SIZE_CSS = 10
const ROTATE_GAP_CSS = 26

function clampN(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function normDeg(v: number): number {
  let r = v
  while (r > 180) r -= 360
  while (r <= -180) r += 360
  return r
}

let mctx: CanvasRenderingContext2D | null = null
function measureContext(): CanvasRenderingContext2D {
  if (!mctx) {
    mctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  }
  return mctx
}

function resolvedLayers(): WatermarkLayer[] {
  // 样张没有真实元数据：令牌按示例值解析，模板预览接近成品观感
  return wm.plainLayers().map((l) =>
    l.type === 'text' ? { ...l, content: resolveTokens(l.content, SAMPLE_EXIF, '样张') } : l,
  )
}

/** 含边框 / 背景外扩的最终画布尺寸（照片区域仍是样张尺寸，随横 / 竖屏切换） */
const frameSize = computed(() => {
  const layers = wm.editTarget()
  // 背景水印决定画布：按其布局参数扩展（与导出同一 layoutBackgroundFrame）
  const bg = layers.find((l): l is BackgroundLayer => l.type === 'background' && l.visible)
  if (bg) {
    const layout = layoutBackgroundFrame(
      bg,
      sampleW.value,
      sampleH.value,
      backgroundAspect(bg, sampleW.value, sampleH.value),
      1,
    )
    return { w: layout.frameW, h: layout.frameH }
  }
  let l = 0
  let r = 0
  let t = 0
  let b = 0
  for (const layer of layers) {
    if (layer.type === 'border' && layer.visible) {
      l += layer.left
      r += layer.right
      t += layer.top
      b += layer.bottom
    }
  }
  return { w: sampleW.value + l + r, h: sampleH.value + t + b }
})

function redraw(): void {
  const canvas = canvasEl.value
  if (!canvas || !sampleBmp) return
  // 画布 CSS 尺寸由样式锁定铺满容器（见 .sample），改写 canvas.width 不会反过来影响布局
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cw = Math.max(1, Math.round(rect.width * dpr))
  const ch = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  // 画布（照片 + 边框）按容器适应并居中，再叠加视图缩放与平移（放大后可平移查看边缘）
  const frame = frameSize.value
  const baseFit = Math.min(rect.width / frame.w, rect.height / frame.h)
  const fit = baseFit * viewZoom.value
  const ox = (rect.width * dpr - frame.w * fit) / 2 + viewPan.x * dpr
  const oy = (rect.height * dpr - frame.h * fit) / 2 + viewPan.y * dpr
  ctx.translate(ox, oy)
  ctx.scale(fit, fit)
  const composed = paintComposed(
    ctx,
    sampleBmp,
    sampleW.value,
    sampleH.value,
    resolvedLayers(),
    assetBmps,
  )
  const { photoX, photoY } = composed
  const bgMode = hasVisibleBackground()
  // 水印坐标系始终是照片区域：背景水印只是外部装饰，不参与锚点计算
  wmSpace.w = bgMode ? composed.photoW : sampleW.value
  wmSpace.h = bgMode ? composed.photoH : sampleH.value

  // 选中图层：描边框 + 锚点十字，画在水印坐标系（照片区域）
  // 强调色随主题取自令牌。与绘制共用令牌解析后的副本，父级锚点才与成品一致
  const resolved = resolvedLayers()
  const sel = wm.selected
    ? (resolved.find(
        (l): l is TextLayer | ImageLayer =>
          l.id === wm.selected!.id && l.type !== 'border' && l.type !== 'background',
      ) ?? null)
    : null
  if (sel) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffa72f'
    ctx.save()
    ctx.translate(photoX, photoY)
    const box = measureLayer(sel, wmSpace.w, wmSpace.h, measureContext(), 1, resolved)
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.95
    ctx.lineWidth = 1.5 / fit
    ctx.setLineDash([5 / fit, 4 / fit])
    ctx.strokeRect(box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h)
    const a = layerAnchor(sel, wmSpace.w, wmSpace.h, 1, resolved, measureContext())
    ctx.setLineDash([])
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1 / fit
    const r = 7 / fit
    ctx.beginPath()
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
    ctx.moveTo(a.x - r * 1.8, a.y)
    ctx.lineTo(a.x + r * 1.8, a.y)
    ctx.moveTo(a.x, a.y - r * 1.8)
    ctx.lineTo(a.x, a.y + r * 1.8)
    ctx.stroke()

    // 缩放 / 旋转手柄：与预览叠加层同一 layerHandles 几何
    const ipp = dpr / fit // 每个 CSS 像素对应的图片像素
    const handles = layerHandles(box, ROTATE_GAP_CSS * ipp)
    const half = (HANDLE_SIZE_CSS * ipp) / 2
    const rad = (box.rotation * Math.PI) / 180
    const topMid = {
      x: box.cx + (box.h / 2) * Math.sin(rad),
      y: box.cy - (box.h / 2) * Math.cos(rad),
    }
    const rot = handles.find((h) => h.id === 'rotate')!
    ctx.setLineDash([])
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1 * ipp
    ctx.beginPath()
    ctx.moveTo(topMid.x, topMid.y)
    ctx.lineTo(rot.x, rot.y)
    ctx.stroke()
    ctx.globalAlpha = 0.95
    ctx.fillStyle = accent
    for (const h of handles) {
      if (h.id === 'rotate') {
        ctx.beginPath()
        ctx.arc(h.x, h.y, half * 1.15, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillRect(h.x - half, h.y - half, half * 2, half * 2)
      }
    }
    ctx.restore()
  }
  vmap.scale = fit
  // 指针换算基于水印坐标系原点（始终是照片区域原点）
  vmap.ox = ox + photoX * fit
  vmap.oy = oy + photoY * fit
  vmap.dpr = dpr
}

/** 先同步重绘保证即时反馈，素材位图缺 cargo 时加载后再补一帧 */
function scheduleRedraw(): void {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    redraw()
    void syncAssets().then(redraw)
  })
}

async function syncAssets(): Promise<void> {
  const list = wm.editTarget()
  const needed = new Set<string>()
  for (const l of list) {
    if (l.type === 'image') needed.add((l as { assetId: string }).assetId)
    else if (l.type === 'background' && l.visible && l.source === 'custom' && l.assetId)
      needed.add(l.assetId)
  }
  for (const key of [...assetBmps.keys()]) {
    if (!needed.has(key)) {
      assetBmps.get(key)?.close()
      assetBmps.delete(key)
    }
  }
  const missing = [...needed].filter((id) => !assetBmps.has(id))
  if (!missing.length) return
  const payloads = await wm.assetPayloads(list)
  for (const p of payloads) {
    if (!assetBmps.has(p.id)) {
      try {
        assetBmps.set(p.id, await createImageBitmap(p.blob))
      } catch {
        /* 跳过无效素材 */
      }
    }
  }
}

/* ---------- 样张视图变换：滚轮缩放 / 拖拽平移 / 双指捏合 / 双击复位 ---------- */

const MAX_ZOOM = 8
const DBL_TAP_ZOOM = 2.5
/** 视图缩放：1 = 适应容器 */
const viewZoom = ref(1)
/** 平移（CSS px，相对容器中心） */
const viewPan = reactive({ x: 0, y: 0 })
let viewAnim = 0

/** 样张在当前容器下 zoom=1 的显示尺寸（CSS px） */
function fitSize(rect: DOMRect): { w: number; h: number } {
  const frame = frameSize.value
  const fit = Math.min(rect.width / frame.w, rect.height / frame.h)
  return { w: frame.w * fit, h: frame.h * fit }
}

function hardClampPan(): void {
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!rect) return
  const d = fitSize(rect)
  viewPan.x = clampPanAxis(viewPan.x, d.w, rect.width, viewZoom.value, false)
  viewPan.y = clampPanAxis(viewPan.y, d.h, rect.height, viewZoom.value, false)
}

function stopViewAnim(): void {
  if (viewAnim) {
    cancelAnimationFrame(viewAnim)
    viewAnim = 0
  }
}

/** 视图状态动画（回弹/复位共用），始终从当前值出发，随时可被新手势打断 */
function animateViewTo(tz: number, tpx: number, tpy: number): void {
  stopViewAnim()
  const sz = viewZoom.value
  const spx = viewPan.x
  const spy = viewPan.y
  const t0 = performance.now()
  const dur = 240
  const step = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    viewZoom.value = sz + (tz - sz) * e
    viewPan.x = spx + (tpx - spx) * e
    viewPan.y = spy + (tpy - spy) * e
    redraw()
    if (k < 1) viewAnim = requestAnimationFrame(step)
    else viewAnim = 0
  }
  viewAnim = requestAnimationFrame(step)
}

function onZoomWheel(e: WheelEvent): void {
  if (!sampleBmp) return
  e.preventDefault()
  stopViewAnim()
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!rect) return
  const z0 = viewZoom.value
  // 触控板捏合带 ctrlKey，增量小、更细腻
  const k = e.ctrlKey ? 0.01 : 0.0016
  const z1 = Math.min(MAX_ZOOM, Math.max(1, z0 * Math.exp(-e.deltaY * k)))
  if (z1 === z0) return
  // 锚点缩放：光标下的样张点保持不动
  const rcx = e.clientX - rect.left - rect.width / 2
  const rcy = e.clientY - rect.top - rect.height / 2
  viewPan.x = rcx - ((rcx - viewPan.x) / z0) * z1
  viewPan.y = rcy - ((rcy - viewPan.y) / z0) * z1
  viewZoom.value = z1
  hardClampPan()
  redraw()
}

/* ---------- 样张画布上的指针手势 ---------- */

interface PointerState {
  x: number
  y: number
  downT: number
  moved: boolean
}
const pointers = new Map<number, PointerState>()

type Gesture =
  | { type: 'idle' }
  | { type: 'layer'; id: string; startClient: { x: number; y: number }; startCx: number; startCy: number }
  | {
      type: 'scale'
      id: string
      center: { x: number; y: number }
      startDist: number
      startScale: number
      minScale: number
      maxScale: number
    }
  | {
      type: 'rotate'
      id: string
      center: { x: number; y: number }
      startAngle: number
      startRotation: number
    }
  | { type: 'pan'; startPan: { x: number; y: number }; startClient: { x: number; y: number } }
  | {
      type: 'pinch'
      startDist: number
      startZoom: number
      startMid: { x: number; y: number }
      startPan: { x: number; y: number }
    }

let gesture: Gesture = { type: 'idle' }

/**
 * 拖动吸附状态（图片坐标系，按轴记忆）：进入吸附 8px 容差、脱离需再超
 * 6px——没有这段滞回，手指在吸附线边缘微动时「吸住与释放」逐帧翻转，
 * 位置 0~8px 高频跳变（拖动抖动）。与预览画布同一套参数与语义。
 */
const SNAP_HYSTERESIS = 6
let dragSnap: { x: number | null; y: number | null } = { x: null, y: null }
let lastTap: { t: number; x: number; y: number } | null = null

function toImagePx(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = canvasEl.value!
  const rect = canvas.getBoundingClientRect()
  const dx = (clientX - rect.left) * vmap.dpr
  const dy = (clientY - rect.top) * vmap.dpr
  return { x: (dx - vmap.ox) / vmap.scale, y: (dy - vmap.oy) / vmap.scale }
}

function pinchInfo(): { dist: number; mid: { x: number; y: number } } {
  const pts = [...pointers.values()]
  const [a, b] = pts
  const rect = canvasEl.value!.getBoundingClientRect()
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mid: {
      x: (a.x + b.x) / 2 - rect.left - rect.width / 2,
      y: (a.y + b.y) / 2 - rect.top - rect.height / 2,
    },
  }
}

function onPointerDown(e: PointerEvent): void {
  const canvas = canvasEl.value
  if (!canvas || !sampleBmp || !vmap.scale) return
  stopViewAnim()
  // 自定义锚点拾取：本次点击只落锚点
  if (wm.pickingAnchor) {
    const p = toImagePx(e.clientX, e.clientY)
    wm.placeCustomAnchor((p.x / wmSpace.w) * 100, (p.y / wmSpace.h) * 100)
    return
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, downT: performance.now(), moved: false })
  canvas.setPointerCapture(e.pointerId)

  if (pointers.size === 2) {
    // 第二根手指落下：进行中的手势一律转为捏合
    const { dist, mid } = pinchInfo()
    gesture = {
      type: 'pinch',
      startDist: dist,
      startZoom: viewZoom.value,
      startMid: mid,
      startPan: { x: viewPan.x, y: viewPan.y },
    }
    grabbing.value = false
    return
  }
  if (pointers.size > 2) return

  const p = toImagePx(e.clientX, e.clientY)
  const list = resolvedLayers()
  // 选中框手柄优先于图层本体：拖动四角改尺寸，拖动顶部圆点改角度
  const sel = wm.selected
  if (sel && sel.type !== 'border' && sel.type !== 'background') {
    const resolvedSel =
      list.find(
        (l): l is TextLayer | ImageLayer =>
          l.id === sel.id && l.type !== 'border' && l.type !== 'background',
      ) ?? (sel as TextLayer | ImageLayer)
    const box = measureLayer(resolvedSel, wmSpace.w, wmSpace.h, measureContext(), 1, list)
    const cssPerImg = vmap.scale / vmap.dpr
    const handles = layerHandles(box, ROTATE_GAP_CSS / cssPerImg)
    const tol = HANDLE_HIT_CSS / cssPerImg
    const hitHandle = handles.find((h) => Math.hypot(p.x - h.x, p.y - h.y) <= tol)
    const layer = wm.editTarget().find((l) => l.id === sel.id)
    if (hitHandle && layer && layer.type !== 'border' && layer.type !== 'background') {
      if (hitHandle.id === 'rotate') {
        gesture = {
          type: 'rotate',
          id: layer.id,
          center: { x: box.cx, y: box.cy },
          startAngle: Math.atan2(p.y - box.cy, p.x - box.cx),
          startRotation: layer.rotation,
        }
      } else {
        const startDist = Math.hypot(p.x - box.cx, p.y - box.cy) || 1
        gesture = {
          type: 'scale',
          id: layer.id,
          center: { x: box.cx, y: box.cy },
          startDist,
          startScale: layer.scale,
          minScale: 0.5,
          maxScale: layer.type === 'text' ? 40 : 100,
        }
      }
      grabbing.value = true
      return
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    // 边框 / 背景层覆盖全画布、无独立位置，只能从图层列表选中
    if (l.type === 'border' || l.type === 'background' || !l.visible) continue
    const box = measureLayer(l, wmSpace.w, wmSpace.h, measureContext(), 1, list)
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      const c = layerPivot(l, wmSpace.w, wmSpace.h, 1, list, measureContext())
      dragSnap = { x: null, y: null }
      gesture = {
        type: 'layer',
        id: l.id,
        startClient: { x: e.clientX, y: e.clientY },
        startCx: c.x,
        startCy: c.y,
      }
      grabbing.value = true
      return
    }
  }
  wm.selectedId = null
  gesture = { type: 'pan', startPan: { x: viewPan.x, y: viewPan.y }, startClient: { x: e.clientX, y: e.clientY } }
}

function onPointerMove(e: PointerEvent): void {
  const pt = pointers.get(e.pointerId)
  if (!pt) {
    onCursorMove(e)
    return
  }
  const dx = e.clientX - pt.x
  const dy = e.clientY - pt.y
  if (Math.abs(dx) + Math.abs(dy) > 3) pt.moved = true
  pt.x = e.clientX
  pt.y = e.clientY

  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const { dist, mid } = pinchInfo()
    const raw = gesture.startZoom * (dist / gesture.startDist)
    // 捏合允许短暂越过边界，松手回弹
    let z = raw
    if (z < 1) z = 1 - rubberband(1 - z, MAX_ZOOM - 1)
    else if (z > MAX_ZOOM) z = MAX_ZOOM + rubberband(z - MAX_ZOOM, MAX_ZOOM - 1)
    viewZoom.value = z
    // 捏合中点下的样张点保持不动（1:1 跟手）
    const u = {
      x: (gesture.startMid.x - gesture.startPan.x) / gesture.startZoom,
      y: (gesture.startMid.y - gesture.startPan.y) / gesture.startZoom,
    }
    viewPan.x = mid.x - u.x * z
    viewPan.y = mid.y - u.y * z
    redraw()
    return
  }

  if (gesture.type === 'scale' || gesture.type === 'rotate') {
    const p = toImagePx(e.clientX, e.clientY)
    const g = gesture
    if (g.type === 'scale') {
      const dist = Math.hypot(p.x - g.center.x, p.y - g.center.y) || 1
      const scale = clampN(g.startScale * (dist / g.startDist), g.minScale, g.maxScale)
      wm.update(g.id, { scale })
    } else {
      const cur = Math.atan2(p.y - g.center.y, p.x - g.center.x)
      let delta = cur - g.startAngle
      if (delta > Math.PI) delta -= Math.PI * 2
      else if (delta < -Math.PI) delta += Math.PI * 2
      wm.update(g.id, { rotation: Math.round(normDeg(g.startRotation + (delta * 180) / Math.PI) * 10) / 10 })
    }
    return
  }

  if (gesture.type === 'layer') {
    const gid = gesture.id
    const layer = wm.editTarget().find((l) => l.id === gid)
    if (!layer || layer.type === 'border' || layer.type === 'background') return
    const dpx = ((e.clientX - gesture.startClient.x) * vmap.dpr) / vmap.scale
    const dpy = ((e.clientY - gesture.startClient.y) * vmap.dpr) / vmap.scale
    let cx = gesture.startCx + dpx
    let cy = gesture.startCy + dpy
    // 吸附样张中线与安全边距（背景模式下以整幅画布为基准）
    if (settings.wmSnap) {
      const sw = wmSpace.w
      const sh = wmSpace.h
      const t = 8 / (vmap.scale / vmap.dpr)
      const leave = (8 + SNAP_HYSTERESIS) / (vmap.scale / vmap.dpr)
      // 磁滞：已吸附的轴脱离要超出容差再 6px，否则手指在吸附线边缘微动时
      // 「吸住与释放」逐帧翻转，表现为拖动抖动（与预览画布同一修复）
      for (const axis of ['x', 'y'] as const) {
        const pos = axis === 'x' ? cx : cy
        const snap = dragSnap[axis]
        if (snap !== null) {
          if (Math.abs(pos - snap) > leave) dragSnap[axis] = null
          else if (axis === 'x') cx = snap
          else cy = snap
        }
      }
      for (const axis of ['x', 'y'] as const) {
        if (dragSnap[axis] !== null) continue
        const pos = axis === 'x' ? cx : cy
        const lines = axis === 'x' ? [sw / 2, sw * 0.04, sw * 0.96] : [sh / 2, sh * 0.04, sh * 0.96]
        for (const v of lines) {
          if (Math.abs(pos - v) < t) {
            dragSnap[axis] = v
            if (axis === 'x') cx = v
            else cy = v
            break
          }
        }
      }
    }
    const a = layerAnchor(layer, wmSpace.w, wmSpace.h, 1, resolvedLayers(), measureContext())
    // 拖动中浮点平滑，松手（onPointerUp）统一取整
    wm.update(layer.id, {
      offsetX: cx - a.x,
      offsetY: cy - a.y,
    })
    return
  }

  if (gesture.type === 'pan') {
    const rect = canvasEl.value?.getBoundingClientRect()
    if (!rect) return
    const d = fitSize(rect)
    viewPan.x = clampPanAxis(
      gesture.startPan.x + (e.clientX - gesture.startClient.x),
      d.w,
      rect.width,
      viewZoom.value,
      true,
    )
    viewPan.y = clampPanAxis(
      gesture.startPan.y + (e.clientY - gesture.startClient.y),
      d.h,
      rect.height,
      viewZoom.value,
      true,
    )
    redraw()
  }
}

function settleHandleGesture(g: Gesture): void {
  if (g.type !== 'scale' && g.type !== 'rotate') return
  const layer = wm.editTarget().find((l) => l.id === g.id)
  if (!layer || layer.type === 'border' || layer.type === 'background') return
  if (g.type === 'scale') wm.update(g.id, { scale: Math.round(layer.scale * 10) / 10 })
  else wm.update(g.id, { rotation: Math.round(normDeg(layer.rotation)) })
}

function onPointerUp(e: PointerEvent): void {
  const pt = pointers.get(e.pointerId)
  pointers.delete(e.pointerId)
  const g = gesture

  if (g.type === 'pinch') {
    if (pointers.size < 2) {
      gesture = { type: 'idle' }
      // 松手回弹：缩放回到合法区间，平移回到边界内
      const tz = Math.min(MAX_ZOOM, Math.max(1, viewZoom.value))
      const rect = canvasEl.value?.getBoundingClientRect()
      let tx = viewPan.x
      let ty = viewPan.y
      if (rect) {
        const d = fitSize(rect)
        tx = clampPanAxis(viewPan.x, d.w, rect.width, viewZoom.value, false)
        ty = clampPanAxis(viewPan.y, d.h, rect.height, viewZoom.value, false)
      }
      if (
        Math.abs(tz - viewZoom.value) > 0.001 ||
        Math.abs(tx - viewPan.x) > 0.5 ||
        Math.abs(ty - viewPan.y) > 0.5
      ) {
        animateViewTo(tz, tx, ty)
      }
    }
    return
  }

  if (pointers.size > 0) {
    if (g.type === 'layer') {
      // 多指接管：本手势结束，位移量取整落库
      const l = wm.editTarget().find((x) => x.id === g.id)
      if (l && 'offsetX' in l && 'offsetY' in l) {
        wm.update(g.id, { offsetX: Math.round(l.offsetX), offsetY: Math.round(l.offsetY) })
      }
    } else settleHandleGesture(g)
    if (g.type === 'layer' || g.type === 'scale' || g.type === 'rotate') {
      gesture = { type: 'idle' }
      grabbing.value = false
    }
    return
  }

  if (g.type === 'layer') {
    grabbing.value = false
    // 拖动中浮点平滑，结束时取整落库
    const l = wm.editTarget().find((x) => x.id === g.id)
    if (l && 'offsetX' in l && 'offsetY' in l) {
      wm.update(g.id, { offsetX: Math.round(l.offsetX), offsetY: Math.round(l.offsetY) })
    }
  }
  settleHandleGesture(g)
  if (g.type === 'scale' || g.type === 'rotate') grabbing.value = false
  gesture = { type: 'idle' }

  // 双击空白处：放大 ⇄ 复位（落在水印上时双击属于图层操作，不触发）
  const now = performance.now()
  const isTap = !!pt && !pt.moved && now - pt.downT < 300
  if (
    isTap &&
    g.type === 'pan' &&
    lastTap &&
    now - lastTap.t < 340 &&
    Math.hypot(pt!.x - lastTap.x, pt!.y - lastTap.y) < 28
  ) {
    lastTap = null
    if (viewZoom.value > 1.01) {
      animateViewTo(1, 0, 0)
    } else {
      const rect = canvasEl.value?.getBoundingClientRect()
      if (rect) {
        const rcx = pt!.x - rect.left - rect.width / 2
        const rcy = pt!.y - rect.top - rect.height / 2
        const u = { x: (rcx - viewPan.x) / viewZoom.value, y: (rcy - viewPan.y) / viewZoom.value }
        const z0 = viewZoom.value
        const p0 = { x: viewPan.x, y: viewPan.y }
        viewZoom.value = DBL_TAP_ZOOM
        viewPan.x = rcx - u.x * DBL_TAP_ZOOM
        viewPan.y = rcy - u.y * DBL_TAP_ZOOM
        hardClampPan()
        const target = { x: viewPan.x, y: viewPan.y }
        viewZoom.value = z0
        viewPan.x = p0.x
        viewPan.y = p0.y
        animateViewTo(DBL_TAP_ZOOM, target.x, target.y)
      }
    }
    return
  }
  if (isTap && g.type === 'pan' && pt) lastTap = { t: now, x: pt.x, y: pt.y }

  // 平移结束：越界回弹
  if (g.type === 'pan') {
    const rect = canvasEl.value?.getBoundingClientRect()
    if (!rect) return
    const d = fitSize(rect)
    const tx = clampPanAxis(viewPan.x, d.w, rect.width, viewZoom.value, false)
    const ty = clampPanAxis(viewPan.y, d.h, rect.height, viewZoom.value, false)
    if (Math.abs(tx - viewPan.x) > 0.5 || Math.abs(ty - viewPan.y) > 0.5) {
      animateViewTo(viewZoom.value, tx, ty)
    }
  }
}

function onLeave(): void {
  if (gesture.type !== 'layer') grabbing.value = false
}

function onCursorMove(e: PointerEvent): void {
  if (!sampleBmp || !vmap.scale) return
  const p = toImagePx(e.clientX, e.clientY)
  const list = resolvedLayers()
  // 手柄上显示抓取光标（与图层本体一致，避免指针「看起来不能拖」）
  const sel = wm.selected
  if (sel && sel.type !== 'border' && sel.type !== 'background') {
    const resolvedSel =
      list.find(
        (l): l is TextLayer | ImageLayer =>
          l.id === sel.id && l.type !== 'border' && l.type !== 'background',
      ) ?? (sel as TextLayer | ImageLayer)
    const box = measureLayer(resolvedSel, wmSpace.w, wmSpace.h, measureContext(), 1, list)
    const cssPerImg = vmap.scale / vmap.dpr
    const handles = layerHandles(box, ROTATE_GAP_CSS / cssPerImg)
    if (handles.some((h) => Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE_HIT_CSS / cssPerImg)) {
      grabbing.value = true
      return
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    if (l.type === 'border' || !l.visible) continue
    if (hitTest(measureLayer(l, wmSpace.w, wmSpace.h, measureContext(), 1, list), p.x, p.y)) {
      grabbing.value = true
      return
    }
  }
  grabbing.value = false
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  // 工作室在沙箱草稿上编辑：离开时草稿丢弃，不影响项目照片的水印
  wm.enterStudio()
  sampleBmp = await ensureSampleBitmap()
  ro = new ResizeObserver(() => redraw())
  if (boxEl.value) ro.observe(boxEl.value)
  redraw()
})

onBeforeUnmount(() => {
  wm.exitStudio()
  ro?.disconnect()
  stopViewAnim()
  sampleBmp = null
  customSource?.close()
  customSource = null
  for (const b of sampleBmps.values()) b.close()
  sampleBmps.clear()
  for (const b of sourceBmps.values()) b.close()
  sourceBmps.clear()
  for (const b of assetBmps.values()) b.close()
  assetBmps.clear()
})

// 图层任何变化（含应用预设替换数组、拖动偏移）都即时重绘
watch([() => wm.editTarget(), () => wm.selectedId], scheduleRedraw, { deep: true })

// 编辑器从隐藏转为可见时画布尺寸从 0 就绪，重绘一帧
watch(mode, async (m) => {
  if (m !== 'edit') return
  await nextTick()
  redraw()
})
</script>

<template>
  <div class="studio">
    <header class="head material" data-tauri-drag-region>
      <template v-if="mode === 'manage'">
        <AppButton variant="ghost" size="sm" @click="emit('back')"><ArrowLeft :size="14" />{{ t('返回') }}</AppButton>
        <h1>{{ t('水印工作室') }}</h1>
        <span class="flex" />
        <AppButton size="sm" variant="primary" @click="openCreate"><Plus :size="13" />{{ t('新建模板') }}</AppButton>
      </template>
      <template v-else>
        <AppButton variant="ghost" size="sm" @click="backToManage"><ArrowLeft :size="14" />{{ t('模板库') }}</AppButton>
        <h1 class="edit-title" :title="t(editingName)">{{ t(editingName) }}</h1>
        <span v-if="editingBuiltin" class="badge">{{ t('内置 · 保存将另存为副本') }}</span>
        <span class="flex" />
        <AppButton size="sm" @click="saveEdit"><Save :size="13" />{{ editingBuiltin ? t('另存为副本') : t('保存') }}</AppButton>
        <AppButton size="sm" variant="ghost" @click="exportEditing">
          <Download :size="13" />{{ t('导出模板') }}
        </AppButton>
        <AppButton v-if="!editingBuiltin && editingId" size="sm" variant="ghost" @click="startSaveAs">
          <Check :size="13" />{{ t('另存为新模板') }}
        </AppButton>
      </template>
    </header>

    <div v-if="showSave" class="save-bar">
      <input
        v-model="saveName"
        class="text-input"
        :placeholder="t('模板名称')"
        @keyup.enter="saveAsNew"
      />
      <AppButton size="sm" variant="primary" @click="saveAsNew">{{ t('保存') }}</AppButton>
      <AppButton size="sm" variant="ghost" @click="showSave = false">{{ t('取消') }}</AppButton>
    </div>

    <!-- 模板管理：卡片列出全部模板（默认视图） -->
    <Transition name="pane" mode="out-in">
      <TemplateManager v-if="mode === 'manage'" @edit="openEdit" @create="openCreate" />
    </Transition>

    <!-- 模板编辑器：v-show 常驻，画布状态与视图变换在切换间保留 -->
    <div v-show="mode === 'edit'" class="body">
      <div ref="boxEl" class="preview">
        <!-- 测试画幅：常见比例 + 自定义长宽；竖构图是水印最容易翻车的场景 -->
        <div class="orient material ratio-panel" role="group" :aria-label="t('测试画幅')">
          <span class="ratio-label">{{ t('测试画幅') }}</span>
          <select
            class="ratio-select"
            :value="ratio"
            @change="selectRatio(($event.target as HTMLSelectElement).value as TestRatio)"
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="3:2">3:2</option>
            <option value="custom">{{ t('自定义') }}</option>
          </select>
          <template v-if="ratio === 'custom'">
            <input
              v-model.number="customW"
              class="ratio-input"
              type="number"
              min="160"
              max="4096"
              :aria-label="t('宽度')"
            />
            <span class="ratio-x">×</span>
            <input
              v-model.number="customH"
              class="ratio-input"
              type="number"
              min="160"
              max="4096"
              :aria-label="t('高度')"
            />
            <button class="ratio-apply" @click="applyCustomSize">{{ t('应用') }}</button>
          </template>
          <span v-else class="ratio-size">{{ sampleW }}×{{ sampleH }}</span>
          <button class="ratio-apply" :title="t('用一张自己的照片检查水印')" @click="chooseTestImage">
            <ImagePlus :size="12" />{{ t('测试图片…') }}
          </button>
          <button
            v-if="hasCustomSample"
            class="ratio-apply"
            :title="t('回到内置横 / 竖样张')"
            @click="resetSample"
          >
            <RotateCcw :size="12" />{{ t('恢复样张') }}
          </button>
        </div>
        <input
          ref="customFileInput"
          type="file"
          accept="image/*"
          hidden
          @change="onCustomFile"
        />
        <canvas
          ref="canvasEl"
          class="sample"
          :class="{ grab: grabbing }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @pointerleave="onLeave"
          @wheel="onZoomWheel"
        />
      </div>
      <aside class="editor material">
        <LayerEditor :img-w="wmSpace.w" :img-h="wmSpace.h" :exif="SAMPLE_EXIF" base-name="样张" :show-templates="false" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.studio {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(46px + var(--safe-top));
  /* 左侧让出 macOS 原生红绿灯（其余平台为 0） */
  padding: var(--safe-top) calc(14px + var(--safe-right)) 0
    calc(14px + var(--traffic-light-inset) + var(--safe-left));
  flex: none;
  border-bottom: 1px solid var(--line);
}
h1 {
  font-size: calc(14px * var(--ui-zoom, 1));
  font-weight: 600;
}
.edit-title {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  height: 20px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text-3);
  font-size: calc(11px * var(--ui-zoom, 1));
  white-space: nowrap;
}
/* 管理页 ⇄ 编辑页的内部切换：轻微纵向推移的交叉淡入 */
.pane-enter-active {
  transition: opacity 200ms var(--ease-soft), transform 200ms var(--ease-soft);
}
.pane-leave-active {
  transition: opacity 130ms var(--ease), transform 130ms var(--ease);
}
.pane-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.pane-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.flex {
  flex: 1;
}
.save-bar {
  display: flex;
  gap: 6px;
  padding: 10px calc(14px + var(--safe-right)) 0 calc(14px + var(--safe-left));
}
.text-input {
  flex: 1;
  max-width: 280px;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 340px;
  min-height: 0;
}
.preview {
  position: relative;
  min-width: 0;
  min-height: 0;
  /* 中性工作台底色：比页面底色略沉一档，样张轮廓清晰，也不再靠白色圆角卡片衬托 */
  background: color-mix(in srgb, var(--canvas) 88%, var(--text) 12%);
}
/* 测试画幅：浮在样张上方，材质底保证任何照片上都可读 */
.orient {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
}
.ratio-label {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  white-space: nowrap;
}
.ratio-select {
  height: calc(24px * var(--ui-zoom, 1));
  padding: 0 4px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text-2);
  font-size: calc(11.5px * var(--ui-zoom, 1));
}
.ratio-select:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.ratio-input {
  width: 58px;
  height: calc(24px * var(--ui-zoom, 1));
  padding: 0 5px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  font-variant-numeric: tabular-nums;
}
.ratio-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.ratio-x,
.ratio-size {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ratio-apply {
  height: calc(24px * var(--ui-zoom, 1));
  padding: 0 8px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
/* 画布铺满容器（四周留边），缩放与平移都发生在画布内部的绘制变换里。
   不加圆角与投影：样张本身就是照片，多余的白底圆角卡片会干扰对水印的判断 */
.sample {
  position: absolute;
  inset: 20px;
  width: calc(100% - 40px);
  height: calc(100% - 40px);
  display: block;
  touch-action: none;
  cursor: default;
}
.sample.grab {
  cursor: grab;
}
.editor {
  border-left: 1px solid var(--line);
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 12px;
  min-height: 0;
}
@media (max-width: 900px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr minmax(200px, 46%);
  }
  .editor {
    border-left: none;
    border-top: 1px solid var(--line);
  }
}
</style>
