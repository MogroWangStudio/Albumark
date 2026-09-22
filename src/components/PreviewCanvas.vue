<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ChevronUp } from 'lucide-vue-next'
import type { WatermarkLayer } from '@/types/watermark'
import { clamp01, CROP_MIN, cropRatioOf, cropRot, cropSourceSize, FULL_CROP, rotatedInnerRect, type Crop } from '@/types/adjust'
import { anchorPoint, hitTest, layerPivot, measureLayer } from '@/core/layout'
import { drawLayers, type AssetMap } from '@/core/draw'
import { renderClient } from '@/core/renderer'
import { resolveTokens } from '@/core/tokens'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { useSettingsStore } from '@/stores/settings'
import { useWatermarkStore } from '@/stores/watermark'

const props = withDefaults(
  defineProps<{
    /** 悬浮面板占用的水平宽度（CSS px），0 = 面板未展开 */
    panelInset?: number
    /** 面板吸附在哪一侧：可用区域让到另一侧 */
    panelSide?: 'left' | 'right'
  }>(),
  { panelInset: 0, panelSide: 'right' },
)

const emit = defineEmits<{ ctx: [e: MouseEvent] }>()

const images = useImagesStore()
const wm = useWatermarkStore()
const adjust = useAdjustStore()
const settings = useSettingsStore()

const MAX_ZOOM = 12
const DBL_TAP_ZOOM = 2.5

/** 预览质量 → 精修长边上限 / 草稿长边上限 / 叠加层 DPR 上限 */
const PERF: Record<string, { final: number; draft: number; dprCap: number }> = {
  high: { final: 1600, draft: 720, dprCap: 2 },
  balanced: { final: 1200, draft: 560, dprCap: 1.5 },
  eco: { final: 880, draft: 440, dprCap: 1 },
}

const frame = ref<HTMLDivElement | null>(null)
const cvBase = ref<HTMLCanvasElement | null>(null)
const cvOverlay = ref<HTMLCanvasElement | null>(null)

const view = reactive({ w: 0, h: 0, dpr: 1 })
/**
 * 可用区域（CSS px，相对 frame）：悬浮面板展开时让出其一侧，
 * 图片的适应与居中都以这块区域为基准，面板收起后平滑归位。
 */
const avail = reactive({ x: 0, y: 0, w: 0, h: 0 })
let availAnim = 0
/** 视图缩放：minZoom（安全区）= 适应窗口 */
const zoom = ref(1)
/** 平移（CSS px，相对可用区域中心） */
const pan = reactive({ x: 0, y: 0 })

/** 最近一次绘制结果在画布（设备像素）中的映射，用于命中测试与选框换算。 */
const resultMap = reactive({ w: 0, h: 0, scale: 1, ox: 0, oy: 0 })

const selRect = ref<{
  left: number
  top: number
  width: number
  height: number
  rotate: number
} | null>(null)
/** 吸附参考线（图片坐标系中的 x/y），拖动中显示 */
const snapLines = ref<{ x?: number; y?: number } | null>(null)

let mctx: CanvasRenderingContext2D | null = null
let srcBitmap: ImageBitmap | null = null
let srcId: string | null = null
/** 合成结果位图缓存：缩放/平移只重绘，不重新渲染 */
let resultBmp: ImageBitmap | null = null
let baseSeq = 0
let finalTimer: number | null = null
let settleTimer: number | null = null
let overlayRaf = false
let viewAnim = 0
let ro: ResizeObserver | null = null
/** 水印素材位图缓存：叠加层在主线程直接绘制 */
const assetBmps: AssetMap = new Map()

const active = computed(() => images.active)
const hasSelection = computed(() => !!wm.selectedId)
const minZoom = computed(() => Math.min(1, Math.max(0.3, settings.minZoom)))
const perf = computed(() => PERF[settings.previewQuality] ?? PERF.high!)

/* ---------- 可用区域：悬浮面板让位，中心偏移到剩余空白 ---------- */

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function targetAvail(): Rect {
  const maxInset = Math.max(0, view.w - 80)
  const inset = Math.min(Math.max(0, props.panelInset), maxInset)
  if (inset <= 0) return { x: 0, y: 0, w: view.w, h: view.h }
  return props.panelSide === 'left'
    ? { x: inset, y: 0, w: view.w - inset, h: view.h }
    : { x: 0, y: 0, w: view.w - inset, h: view.h }
}

/** 面板展开/收起/换边时可用区域平滑过渡（可被下一次变化接管） */
function startAvailAnim(target: Rect): void {
  if (availAnim) cancelAnimationFrame(availAnim)
  const from = { x: avail.x, y: avail.y, w: avail.w, h: avail.h }
  const t0 = performance.now()
  const dur = 220
  const step = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    avail.x = from.x + (target.x - from.x) * e
    avail.y = from.y + (target.y - from.y) * e
    avail.w = from.w + (target.w - from.w) * e
    avail.h = from.h + (target.h - from.h) * e
    drawBase()
    drawOverlay()
    if (k < 1) availAnim = requestAnimationFrame(step)
    else {
      availAnim = 0
      // 让位动画结束后按新基准收紧一次，避免图片停到面板底下
      hardClampPan()
      drawBase()
      drawOverlay()
    }
  }
  availAnim = requestAnimationFrame(step)
}

const availCx = (): number => avail.x + avail.w / 2
const availCy = (): number => avail.y + avail.h / 2

watch(
  [() => props.panelInset, () => props.panelSide, () => view.w, () => view.h],
  () => {
    const t = targetAvail()
    // 首次（或从无到有）直接就位，之后的变化平滑过渡
    if (!view.w || avail.w <= 0) {
      Object.assign(avail, t)
      return
    }
    startAvailAnim(t)
  },
  { immediate: true },
)

/* ---------- 缩放预设 ---------- */

const zoomMenuOpen = ref(false)

const ZOOM_PRESETS: { label: string; value: number | 'fit' }[] = [
  { label: '50%', value: 0.5 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '适应窗口', value: 'fit' },
]

/** 提供给右键菜单等外部调用 */
function setZoom(z: number): void {
  zoomMenuOpen.value = false
  stopViewAnim()
  zoom.value = Math.min(MAX_ZOOM, Math.max(minZoom.value, z))
  hardClampPan()
  drawBase()
  drawOverlay()
  scheduleHiRes()
}

function fitView(): void {
  zoomMenuOpen.value = false
  stopViewAnim()
  animateViewTo(1, 0, 0)
}

function applyPreset(v: number | 'fit'): void {
  if (v === 'fit') fitView()
  else setZoom(v)
}

defineExpose({ fitView, setZoom, resetView })

function closeZoomMenu(): void {
  zoomMenuOpen.value = false
}
function onZoomKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') zoomMenuOpen.value = false
}
watch(zoomMenuOpen, (v) => {
  if (v) {
    window.setTimeout(() => document.addEventListener('click', closeZoomMenu), 0)
    document.addEventListener('keydown', onZoomKey)
  } else {
    document.removeEventListener('click', closeZoomMenu)
    document.removeEventListener('keydown', onZoomKey)
  }
})

function measureContext(): CanvasRenderingContext2D {
  if (!mctx) {
    mctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  }
  return mctx
}

function resolvedLayer(l: WatermarkLayer): WatermarkLayer {
  if (l.type !== 'text') return l
  const a = active.value
  return { ...l, content: resolveTokens(l.content, a?.exif, a?.baseName) }
}

function resolvedLayers(): WatermarkLayer[] {
  // 先取纯数据副本，再做令牌替换（响应式 Proxy 无法直接用于克隆）；
  // 用当前照片生效的图层（单独水印优先，否则全局）
  const a = active.value
  const list = wm.effectiveLayers(a?.id ?? null)
  return list.map((l) =>
    l.type === 'text'
      ? { ...l, content: resolveTokens(l.content, a?.exif, a?.baseName) }
      : l,
  )
}

/* ---------- 分层渲染：Worker 只负责底图（解码+调节），水印叠加层在主线程 ---------- */

function scheduleBase(): void {
  if (!active.value) return
  void renderBase(true)
  if (finalTimer) window.clearTimeout(finalTimer)
  finalTimer = window.setTimeout(() => void renderBase(false), 160)
}

function scheduleOverlay(): void {
  if (overlayRaf) return
  overlayRaf = true
  requestAnimationFrame(() => {
    overlayRaf = false
    // 素材齐备时同步绘制（即时反馈）；缺素材先画已有内容，加载后补一帧
    if (!hasMissingAssets()) {
      drawBase()
      drawOverlay()
      return
    }
    void syncAssets().then(() => {
      drawBase()
      drawOverlay()
    })
  })
}

function hasMissingAssets(): boolean {
  const list = resolvedLayers()
  return list.some((l) => l.type === 'image' && !assetBmps.has((l as { assetId: string }).assetId))
}

async function ensureBitmap(): Promise<ImageBitmap | null> {
  const a = active.value
  if (!a || !a.blob) return null
  if (srcBitmap && srcId === a.id) return srcBitmap
  if (srcBitmap) {
    srcBitmap.close()
    srcBitmap = null
    srcId = null
  }
  try {
    srcBitmap = await createImageBitmap(a.blob)
    srcId = a.id
    return srcBitmap
  } catch {
    return null
  }
}

async function renderBase(draft: boolean): Promise<void> {
  const a = active.value
  if (!a || !cvBase.value) return
  const bmp = await ensureBitmap()
  if (!bmp) return
  const seq = ++baseSeq
  const viewLong = Math.max(view.w, view.h) * view.dpr || 800
  const maxLong = draft
    ? Math.min(perf.value.draft, viewLong)
    : Math.min(perf.value.final, viewLong)
  srcBitmap = null // 即将转移给 Worker
  try {
    // 裁剪编辑中渲染「变换后全图」（框外要可见），确认后按矩形取样；
    // 翻转与拉直在两种状态下都生效
    const d = adjust.cropMode ? adjust.cropDraft : undefined
    const crop = adjust.cropMode
      ? { x: 0, y: 0, w: 1, h: 1, rot: d?.rot, flipH: d?.flipH, flipV: d?.flipV }
      : adjust.cropOf(a.id)
    const res = await renderClient.renderPreview(
      bmp,
      [],
      [],
      adjust.snapshotFor(a.id),
      maxLong,
      crop,
    )
    if (seq !== baseSeq) return
    srcBitmap = res.srcBack
    srcId = a.id
    if (resultBmp) resultBmp.close()
    resultBmp = res.bitmap
    drawBase()
    drawOverlay()
  } catch {
    srcBitmap = null
    srcId = null
  }
}

/** 保持素材位图缓存与图层引用一致（异步加载缺失项后重绘叠加层）。 */
async function syncAssets(): Promise<void> {
  const needed = new Set(
    resolvedLayers()
      .filter((l) => l.type === 'image')
      .map((l) => (l as { assetId: string }).assetId),
  )
  let dirty = false
  for (const key of [...assetBmps.keys()]) {
    if (!needed.has(key)) {
      assetBmps.get(key)?.close()
      assetBmps.delete(key)
      dirty = true
    }
  }
  const missing = [...needed].filter((id) => !assetBmps.has(id))
  if (missing.length) {
    const payloads = await wm.assetPayloads(wm.layers)
    for (const p of payloads) {
      if (!assetBmps.has(p.id)) {
        try {
          assetBmps.set(p.id, await createImageBitmap(p.blob))
        } catch {
          /* 无效素材跳过 */
        }
      }
    }
    dirty = true
  }
  if (dirty) drawOverlay()
}

/** 把缓存的结果位图绘制到底图画布，并更新映射。 */
function drawBase(): void {
  const canvas = cvBase.value
  const bmp = resultBmp
  if (!canvas || !bmp) return
  const dpr = view.dpr || 1
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // 适应与居中都基于可用区域：面板占住一侧时，中心偏移到剩余空白
  const fit = Math.min((avail.w * dpr) / bmp.width, (avail.h * dpr) / bmp.height)
  const scale = fit * zoom.value
  const ox = avail.x * dpr + (avail.w * dpr - bmp.width * scale) / 2 + pan.x * dpr
  const oy = avail.y * dpr + (avail.h * dpr - bmp.height * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)
  // 投影让照片贴在纯白/纯黑底上仍有层次
  const light = document.documentElement.dataset.theme === 'light'
  ctx.save()
  ctx.shadowColor = light ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 22 / scale
  ctx.shadowOffsetY = 5 / scale
  ctx.drawImage(bmp, 0, 0)
  ctx.restore()
  // 1px 细描边：极浅照片在纯白底上也能看清边界
  ctx.strokeStyle = light ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1 / scale
  ctx.strokeRect(0, 0, bmp.width, bmp.height)
  resultMap.w = bmp.width
  resultMap.h = bmp.height
  resultMap.scale = scale
  resultMap.ox = ox
  resultMap.oy = oy
}

/** 水印叠加层：主线程矢量绘制，拖动时只重绘这一层，不再经过 Worker。 */
function drawOverlay(): void {
  const canvas = cvOverlay.value
  const bmp = resultBmp
  if (!canvas || !bmp) return
  const dpr = Math.min(view.dpr || 1, perf.value.dprCap)
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const fit = Math.min((avail.w * dpr) / bmp.width, (avail.h * dpr) / bmp.height)
  const scale = fit * zoom.value
  const ox = avail.x * dpr + (avail.w * dpr - bmp.width * scale) / 2 + pan.x * dpr
  const oy = avail.y * dpr + (avail.h * dpr - bmp.height * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)

  const layers = resolvedLayers()
  const draft = adjust.cropMode ? adjust.cropDraft : null
  if (draft) {
    // 水印画进裁剪框坐标系：预览位置与应用裁剪后完全一致
    const sx = draft.x * bmp.width
    const sy = draft.y * bmp.height
    const sw = Math.max(1, draft.w * bmp.width)
    const sh = Math.max(1, draft.h * bmp.height)
    ctx.save()
    ctx.beginPath()
    ctx.rect(sx, sy, sw, sh)
    ctx.clip()
    ctx.translate(sx, sy)
    drawLayers(ctx, sw, sh, layers, assetBmps)
    ctx.restore()
  } else {
    drawLayers(ctx, bmp.width, bmp.height, layers, assetBmps)
  }

  if (draft) {
    drawCropChrome(ctx, draft, scale, dpr)
    selRect.value = null
    return
  }

  // 吸附参考线
  const snap = snapLines.value
  if (snap) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 167, 47, 0.9)'
    ctx.lineWidth = 1 / scale
    ctx.setLineDash([6 / scale, 4 / scale])
    if (snap.x !== undefined) {
      ctx.beginPath()
      ctx.moveTo(snap.x, 0)
      ctx.lineTo(snap.x, bmp.height)
      ctx.stroke()
    }
    if (snap.y !== undefined) {
      ctx.beginPath()
      ctx.moveTo(0, snap.y)
      ctx.lineTo(bmp.width, snap.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 选中图层的锚点十字
  const sel = wm.selected
  if (sel) {
    const a = anchorPoint(sel.anchor, bmp.width, bmp.height)
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 167, 47, 0.75)'
    ctx.lineWidth = 1 / scale
    const r = 7 / scale
    ctx.beginPath()
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
    ctx.moveTo(a.x - r * 1.8, a.y)
    ctx.lineTo(a.x + r * 1.8, a.y)
    ctx.moveTo(a.x, a.y - r * 1.8)
    ctx.lineTo(a.x, a.y + r * 1.8)
    ctx.stroke()
    ctx.restore()
  }

  updateSelRect()
}

/** 裁剪覆盖层：框外压暗、三分网格、白色边框与角标、裁剪后像素尺寸。 */
function drawCropChrome(ctx: CanvasRenderingContext2D, d: Crop, scale: number, oDpr: number): void {
  const W = resultMap.w
  const H = resultMap.h
  const x0 = d.x * W
  const y0 = d.y * H
  const x1 = (d.x + d.w) * W
  const y1 = (d.y + d.h) * H

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 0, W, y0)
  ctx.fillRect(0, y1, W, H - y1)
  ctx.fillRect(0, y0, x0, y1 - y0)
  ctx.fillRect(x1, y0, W - x1, y1 - y0)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 1 / scale
  ctx.beginPath()
  for (let i = 1; i <= 2; i++) {
    const gx = x0 + ((x1 - x0) * i) / 3
    const gy = y0 + ((y1 - y0) * i) / 3
    ctx.moveTo(gx, y0)
    ctx.lineTo(gx, y1)
    ctx.moveTo(x0, gy)
    ctx.lineTo(x1, gy)
  }
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.lineWidth = 1.5 / scale
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)

  // 四角 L 形与四边中点短线：握点暗示
  const arm = Math.min(18 / scale, (x1 - x0) / 3, (y1 - y0) / 3)
  const notch = Math.min(10 / scale, (x1 - x0) / 4, (y1 - y0) / 4)
  ctx.lineWidth = 2.5 / scale
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0)
  ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm)
  ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1)
  ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm)
  ctx.moveTo((x0 + x1) / 2, y0); ctx.lineTo((x0 + x1) / 2, y0 + notch)
  ctx.moveTo((x0 + x1) / 2, y1); ctx.lineTo((x0 + x1) / 2, y1 - notch)
  ctx.moveTo(x0, (y0 + y1) / 2); ctx.lineTo(x0 + notch, (y0 + y1) / 2)
  ctx.moveTo(x1, (y0 + y1) / 2); ctx.lineTo(x1 - notch, (y0 + y1) / 2)
  ctx.stroke()
  ctx.restore()

  // 裁剪后尺寸（原图像素）：按叠加层自身密度绘制，保证任何缩放下字号一致。
  // 图片坐标 → 底图设备像素（resultMap）→ 乘 k（叠加层/底图密度比）→ 叠加层像素
  const a = active.value
  if (!a?.width || !a.height) return
  const k = oDpr / (view.dpr || 1)
  const cx = (resultMap.ox + ((x0 + x1) / 2) * scale) * k
  const devY = (resultMap.oy + y0 * scale) * k
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const text = `${Math.round(d.w * a.width)} × ${Math.round(d.h * a.height)}`
  ctx.font = `600 ${10.5 * oDpr}px ${getComputedStyle(document.documentElement).fontFamily}`
  const tw = ctx.measureText(text).width
  const chipW = tw + 14 * oDpr
  const chipH = 19 * oDpr
  const bx = cx - chipW / 2
  const by = devY + 8 * oDpr
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
  ctx.beginPath()
  ctx.roundRect(bx, by, chipW, chipH, chipH / 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, by + chipH / 2 + 0.5 * oDpr)
  ctx.restore()
}

function updateSelRect(): void {
  const sel = wm.selected
  if (!sel || !resultMap.w) {
    selRect.value = null
    return
  }
  const box = measureLayer(sel, resultMap.w, resultMap.h, measureContext())
  const dpr = view.dpr || 1
  const s = resultMap.scale
  selRect.value = {
    left: (resultMap.ox + (box.cx - box.w / 2) * s) / dpr,
    top: (resultMap.oy + (box.cy - box.h / 2) * s) / dpr,
    width: (box.w * s) / dpr,
    height: (box.h * s) / dpr,
    rotate: box.rotation,
  }
}

function toImagePx(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = cvBase.value!
  const dpr = view.dpr || 1
  const rect = canvas.getBoundingClientRect()
  const dx = (clientX - rect.left) * dpr
  const dy = (clientY - rect.top) * dpr
  return { x: (dx - resultMap.ox) / resultMap.scale, y: (dy - resultMap.oy) / resultMap.scale }
}

/* ---------- 视图变换：缩放 / 平移 / 橡皮筋 ---------- */

/** Apple 式橡皮筋：越界越多阻力越大 */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

function clampPanAxis(v: number, disp: number, viewport: number, soft: boolean): number {
  const max = Math.max(0, (disp * zoom.value - viewport) / 2)
  if (max === 0) return 0
  if (Math.abs(v) <= max) return v
  if (!soft) return Math.sign(v) * max
  return Math.sign(v) * (max + rubberband(Math.abs(v) - max, viewport))
}

/** 图像在当前 zoom 下的显示尺寸（CSS px） */
function displaySize(): { w: number; h: number } {
  if (!resultBmp) return { w: avail.w, h: avail.h }
  const dpr = view.dpr || 1
  const fit = Math.min((avail.w * dpr) / resultBmp.width, (avail.h * dpr) / resultBmp.height) / dpr
  return { w: resultBmp.width * fit, h: resultBmp.height * fit }
}

function hardClampPan(): void {
  const d = displaySize()
  pan.x = clampPanAxis(pan.x, d.w, avail.w, false)
  pan.y = clampPanAxis(pan.y, d.h, avail.h, false)
}

function stopViewAnim(): void {
  if (viewAnim) {
    cancelAnimationFrame(viewAnim)
    viewAnim = 0
  }
}

function animateViewTo(tz: number, tpx: number, tpy: number): void {
  stopViewAnim()
  const sz = zoom.value
  const spx = pan.x
  const spy = pan.y
  const t0 = performance.now()
  const dur = 260
  const step = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    zoom.value = sz + (tz - sz) * e
    pan.x = spx + (tpx - spx) * e
    pan.y = spy + (tpy - spy) * e
    drawBase()
    drawOverlay()
    if (k < 1) viewAnim = requestAnimationFrame(step)
    else {
      viewAnim = 0
      scheduleHiRes()
    }
  }
  viewAnim = requestAnimationFrame(step)
}

/** 以某点（视口 CSS 坐标）为锚改变缩放，保持该点下的图像位置不动 */
function zoomAt(cx: number, cy: number, nextZoom: number): void {
  const z0 = zoom.value
  const z1 = Math.min(MAX_ZOOM, Math.max(minZoom.value, nextZoom))
  if (z1 === z0) return
  const rcx = cx - availCx()
  const rcy = cy - availCy()
  pan.x = rcx - ((rcx - pan.x) / z0) * z1
  pan.y = rcy - ((rcy - pan.y) / z0) * z1
  zoom.value = z1
  hardClampPan()
  drawBase()
  drawOverlay()
}

function onWheel(e: WheelEvent): void {
  if (!resultBmp) return
  e.preventDefault()
  stopViewAnim()
  const rect = cvBase.value!.getBoundingClientRect()
  // 触控板捏合带 ctrlKey，增量小、更细腻
  const k = e.ctrlKey ? 0.01 : 0.0016
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoom.value * Math.exp(-e.deltaY * k))
  scheduleHiRes()
}

/** 中键按下时阻止 Chromium 的自动滚动光标 */
function onMouseDown(e: MouseEvent): void {
  if (e.button === 1) e.preventDefault()
}

/* ---------- 指针手势：图层拖拽 / 平移 / 双指捏合 / 双击 ---------- */

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
  | { type: 'pan'; startPan: { x: number; y: number }; startClient: { x: number; y: number } }
  | {
      type: 'pinch'
      startDist: number
      startZoom: number
      startMid: { x: number; y: number }
      startPan: { x: number; y: number }
    }
  | {
      type: 'crop'
      handle: CropHandle
      startCrop: Crop
      startNx: number
      startNy: number
    }

type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

let gesture: Gesture = { type: 'idle' }
let lastTap: { t: number; x: number; y: number } | null = null

function relCenter(clientX: number, clientY: number): { x: number; y: number } {
  const rect = cvBase.value!.getBoundingClientRect()
  return { x: clientX - rect.left - availCx(), y: clientY - rect.top - availCy() }
}

function pinchInfo(): { dist: number; mid: { x: number; y: number } } {
  const pts = [...pointers.values()]
  const [a, b] = pts
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mid: { x: (a.x + b.x) / 2 - availCx(), y: (a.y + b.y) / 2 - availCy() },
  }
}

/** 拖动中的吸附：把图层中心吸附到图片中线、安全边距线与其他图层中心。 */
function applySnap(cx: number, cy: number, excludeId: string): { cx: number; cy: number; lines: { x?: number; y?: number } } {
  const out: { cx: number; cy: number; lines: { x?: number; y?: number } } = { cx, cy, lines: {} }
  if (!settings.wmSnap || !resultMap.w) return out
  const dpr = view.dpr || 1
  const cssPerImg = resultMap.scale / dpr
  const threshold = 8 / cssPerImg // 8 CSS px 容差（图片 px）
  const imgW = resultMap.w
  const imgH = resultMap.h
  const xs: number[] = [imgW / 2, imgW * 0.04, imgW * 0.96]
  const ys: number[] = [imgH / 2, imgH * 0.04, imgH * 0.96]
  for (const l of resolvedLayers()) {
    if (l.id === excludeId || !l.visible) continue
    const c = layerPivot(l, imgW, imgH)
    xs.push(c.x)
    ys.push(c.y)
  }
  let best = threshold
  for (const x of xs) {
    const d = Math.abs(cx - x)
    if (d < best) {
      best = d
      out.cx = x
      out.lines.x = x
    }
  }
  best = threshold
  for (const y of ys) {
    const d = Math.abs(cy - y)
    if (d < best) {
      best = d
      out.cy = y
      out.lines.y = y
    }
  }
  return out
}

/* ---------- 裁剪：框几何 ---------- */

/** 拉直（rot≠0）时框的活动范围：变换后源图中不含透明角落的内接矩形（归一化）。 */
function cropBounds(): { x0: number; y0: number; x1: number; y1: number } {
  const d = adjust.cropDraft
  const a = active.value
  if (!d || !a?.width || !a.height || !cropRot(d)) {
    return { x0: 0, y0: 0, x1: 1, y1: 1 }
  }
  const inner = rotatedInnerRect(a.width, a.height, cropRot(d))
  const src = cropSourceSize(a.width, a.height, d)
  const w = inner.w / src.w
  const h = inner.h / src.h
  return { x0: (1 - w) / 2, y0: (1 - h) / 2, x1: (1 + w) / 2, y1: (1 + h) / 2 }
}

/** 把矩形收敛到活动范围内（含最小边）。 */
function clampRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bd: { x0: number; y0: number; x1: number; y1: number },
): Crop {
  const left = Math.min(Math.max(bd.x0, x0), bd.x1 - CROP_MIN)
  const top = Math.min(Math.max(bd.y0, y0), bd.y1 - CROP_MIN)
  const right = Math.min(Math.max(left + CROP_MIN, x1), bd.x1)
  const bottom = Math.min(Math.max(top + CROP_MIN, y1), bd.y1)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 拖动手柄后的新裁剪框（归一化坐标）。比例锁定（ratio 为像素宽高比）时
 * 以锚定边/对角为基准联动另一维，可用空间不足时回缩，比例始终严格成立。
 */
function resizeCrop(
  start: Crop,
  handle: CropHandle,
  nx: number,
  ny: number,
  ratio: number | null,
  imgAspect: number,
  bd: { x0: number; y0: number; x1: number; y1: number },
): Crop {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = Math.min(nx, right - CROP_MIN)
  if (handle.includes('e')) right = Math.max(nx, left + CROP_MIN)
  if (handle.includes('n')) top = Math.min(ny, bottom - CROP_MIN)
  if (handle.includes('s')) bottom = Math.max(ny, top + CROP_MIN)
  if (!ratio) return clampRect(left, top, right, bottom, bd)

  const k = imgAspect / ratio // 归一化高 = 归一化宽 × k
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  if (!hasN && !hasS) {
    // 横边：垂直方向以框中心对称伸缩
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const availW = Math.min(2 * (cx - bd.x0), 2 * (bd.x1 - cx))
    const availH = Math.min(2 * (cy - bd.y0), 2 * (bd.y1 - cy))
    let w = Math.min(Math.max(CROP_MIN, right - left), Math.max(CROP_MIN, availW))
    let h = w * k
    if (h > availH) {
      h = Math.max(CROP_MIN, availH)
      w = h / k
    }
    return clampRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bd)
  }
  if (!hasW && !hasE) {
    // 纵边：水平方向以框中心对称伸缩
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const availW = Math.min(2 * (cx - bd.x0), 2 * (bd.x1 - cx))
    const availH = Math.min(2 * (cy - bd.y0), 2 * (bd.y1 - cy))
    let h = Math.min(Math.max(CROP_MIN, bottom - top), Math.max(CROP_MIN, availH))
    let w = h / k
    if (w > availW) {
      w = Math.max(CROP_MIN, availW)
      h = w * k
    }
    return clampRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bd)
  }
  // 角：对角为锚
  const ax = hasW ? right : left
  const ay = hasN ? bottom : top
  const availW = hasW ? ax - bd.x0 : bd.x1 - ax
  const availH = hasN ? ay - bd.y0 : bd.y1 - ay
  let w = Math.min(
    Math.max(CROP_MIN, hasW ? ax - left : right - ax),
    Math.max(CROP_MIN, availW),
  )
  let h = w * k
  if (h > availH) {
    h = Math.max(CROP_MIN, availH)
    w = h / k
  }
  return {
    x: hasW ? ax - w : ax,
    y: hasN ? ay - h : ay,
    w,
    h,
  }
}

/** 手柄在图片坐标系中的位置（角优先于边做命中）。 */
function cropHandles(d: Crop): { id: CropHandle; x: number; y: number }[] {
  const x0 = d.x * resultMap.w
  const x1 = (d.x + d.w) * resultMap.w
  const y0 = d.y * resultMap.h
  const y1 = (d.y + d.h) * resultMap.h
  const xm = (x0 + x1) / 2
  const ym = (y0 + y1) / 2
  return [
    { id: 'nw', x: x0, y: y0 },
    { id: 'ne', x: x1, y: y0 },
    { id: 'se', x: x1, y: y1 },
    { id: 'sw', x: x0, y: y1 },
    { id: 'n', x: xm, y: y0 },
    { id: 'e', x: x1, y: ym },
    { id: 's', x: xm, y: y1 },
    { id: 'w', x: x0, y: ym },
  ]
}

/** 命中裁剪手柄；框内整体返回 move，框外返回 null（交给平移手势）。 */
function hitCropHandle(p: { x: number; y: number }): CropHandle | null {
  const d = adjust.cropDraft
  if (!d || !resultMap.w) return null
  const dpr = view.dpr || 1
  const cssPerImg = resultMap.scale / dpr
  // 命中半径约 16 CSS px，小框时收进框内避免角/边重叠
  const r = Math.min(16 / cssPerImg, d.w * resultMap.w * 0.45, d.h * resultMap.h * 0.45)
  const hs = cropHandles(d)
  for (const h of hs) {
    if (h.id.length === 2 && Math.hypot(p.x - h.x, p.y - h.y) <= r) return h.id
  }
  for (const h of hs) {
    if (h.id.length === 1 && Math.hypot(p.x - h.x, p.y - h.y) <= r) return h.id
  }
  if (p.x >= d.x * resultMap.w && p.x <= (d.x + d.w) * resultMap.w && p.y >= d.y * resultMap.h && p.y <= (d.y + d.h) * resultMap.h) {
    return 'move'
  }
  return null
}

/** 选择比例后把当前框调整为该比例的最大内接矩形（保持中心，限制在活动范围内）。 */
function applyRatioToDraft(): void {
  const d = adjust.cropDraft
  const ratio = cropRatioOf(adjust.cropRatio)
  if (!d || !ratio || !resultMap.w) return
  const k = resultMap.w / resultMap.h / ratio
  const bd = cropBounds()
  const cx = d.x + d.w / 2
  const cy = d.y + d.h / 2
  const availW = Math.min(2 * (cx - bd.x0), 2 * (bd.x1 - cx))
  const availH = Math.min(2 * (cy - bd.y0), 2 * (bd.y1 - cy))
  let w = Math.min(d.w, availW)
  let h = w * k
  if (h > availH) {
    h = availH
    w = h / k
  }
  w = Math.max(w, CROP_MIN)
  h = Math.max(h, CROP_MIN)
  adjust.cropDraft = clampRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bd)
}

function onPointerDown(e: PointerEvent): void {
  const canvas = cvBase.value
  if (!canvas || !resultMap.w) return
  stopViewAnim()
  if (settleTimer) {
    window.clearTimeout(settleTimer)
    settleTimer = null
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, downT: performance.now(), moved: false })
  canvas.setPointerCapture(e.pointerId)

  if (pointers.size === 2) {
    const { dist, mid } = pinchInfo()
    gesture = {
      type: 'pinch',
      startDist: dist,
      startZoom: zoom.value,
      startMid: mid,
      startPan: { x: pan.x, y: pan.y },
    }
    snapLines.value = null
    return
  }
  if (pointers.size > 2) return

  // 裁剪模式：手柄/框内交给裁剪手势，其余区域仍可平移视图
  if (adjust.cropMode && adjust.cropDraft) {
    if (e.button === 1) {
      gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
      return
    }
    const p = toImagePx(e.clientX, e.clientY)
    const hit = hitCropHandle(p)
    if (hit) {
      gesture = {
        type: 'crop',
        handle: hit,
        startCrop: { ...adjust.cropDraft },
        startNx: clamp01(p.x / resultMap.w),
        startNy: clamp01(p.y / resultMap.h),
      }
    } else {
      gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
    }
    return
  }

  const p = toImagePx(e.clientX, e.clientY)
  const list = resolvedLayers()
  // 中键只负责平移预览，不选中 / 不拖动图层
  if (e.button === 1) {
    wm.selectedId = null
    snapLines.value = null
    gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
    return
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    if (!l.visible) continue
    const box = measureLayer(resolvedLayer(l), resultMap.w, resultMap.h, measureContext())
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      const c = layerPivot(l, resultMap.w, resultMap.h)
      gesture = {
        type: 'layer',
        id: l.id,
        startClient: { x: e.clientX, y: e.clientY },
        startCx: c.x,
        startCy: c.y,
      }
      return
    }
  }
  wm.selectedId = null
  snapLines.value = null
  gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
}

function onPointerMove(e: PointerEvent): void {
  const pt = pointers.get(e.pointerId)
  if (!pt) return
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
    if (z < minZoom.value) z = minZoom.value - rubberband(minZoom.value - z, MAX_ZOOM - minZoom.value)
    else if (z > MAX_ZOOM) z = MAX_ZOOM + rubberband(z - MAX_ZOOM, MAX_ZOOM - minZoom.value)
    zoom.value = z
    // 捏合中点下的图像点保持不动（1:1 跟手）
    const u = {
      x: (gesture.startMid.x - gesture.startPan.x) / gesture.startZoom,
      y: (gesture.startMid.y - gesture.startPan.y) / gesture.startZoom,
    }
    pan.x = mid.x - u.x * z
    pan.y = mid.y - u.y * z
    drawBase()
    drawOverlay()
    return
  }

  if (gesture.type === 'crop') {
    if (!resultMap.w) return
    const p = toImagePx(e.clientX, e.clientY)
    const nx = clamp01(p.x / resultMap.w)
    const ny = clamp01(p.y / resultMap.h)
    const d = gesture.startCrop
    const bd = cropBounds()
    if (gesture.handle === 'move') {
      adjust.cropDraft = {
        x: Math.min(Math.max(bd.x0, d.x + nx - gesture.startNx), bd.x1 - d.w),
        y: Math.min(Math.max(bd.y0, d.y + ny - gesture.startNy), bd.y1 - d.h),
        w: d.w,
        h: d.h,
        rot: d.rot,
        flipH: d.flipH,
        flipV: d.flipV,
      }
    } else {
      const ratio = cropRatioOf(adjust.cropRatio)
      const imgAspect = resultMap.w / resultMap.h
      adjust.cropDraft = resizeCrop(d, gesture.handle, nx, ny, ratio, imgAspect, bd)
    }
    drawOverlay()
    return
  }

  if (gesture.type === 'layer') {
    const canvas = cvBase.value
    if (!canvas || !resultMap.w) return
    const gid = gesture.id
    const dpr = view.dpr || 1
    const cssPerImg = resultMap.scale / dpr
    const imgW = resultMap.w
    const imgH = resultMap.h
    const proposedX = gesture.startCx + (e.clientX - gesture.startClient.x) / cssPerImg
    const proposedY = gesture.startCy + (e.clientY - gesture.startClient.y) / cssPerImg
    const snapped = applySnap(proposedX, proposedY, gid)
    const cx = Math.min(imgW, Math.max(0, snapped.cx))
    const cy = Math.min(imgH, Math.max(0, snapped.cy))
    const layer = wm.editTarget().find((l) => l.id === gid)
    if (!layer) return
    const a = anchorPoint(layer.anchor, imgW, imgH)
    snapLines.value = snapped.lines.x !== undefined || snapped.lines.y !== undefined ? snapped.lines : null
    wm.update(gid, {
      offsetX: Math.round(cx - a.x),
      offsetY: Math.round(cy - a.y),
    })
    return
  }

  if (gesture.type === 'pan') {
    const d = displaySize()
    pan.x = clampPanAxis(
      gesture.startPan.x + (e.clientX - gesture.startClient.x),
      d.w,
      avail.w,
      true,
    )
    pan.y = clampPanAxis(
      gesture.startPan.y + (e.clientY - gesture.startClient.y),
      d.h,
      avail.h,
      true,
    )
    drawBase()
    drawOverlay()
  }
}

function onPointerUp(e: PointerEvent): void {
  const pt = pointers.get(e.pointerId)
  pointers.delete(e.pointerId)
  const g = gesture

  if (g.type === 'pinch') {
    if (pointers.size < 2) {
      gesture = { type: 'idle' }
      // 松手回弹：缩放回到合法区间，平移回到边界内
      const tz = Math.min(MAX_ZOOM, Math.max(minZoom.value, zoom.value))
      const d = displaySize()
      zoom.value = tz
      const tx = clampPanAxis(pan.x, d.w, avail.w, false)
      const ty = clampPanAxis(pan.y, d.h, avail.h, false)
      if (Math.abs(tx - pan.x) > 0.5 || Math.abs(ty - pan.y) > 0.5) {
        animateViewTo(tz, tx, ty)
      } else {
        hardClampPan()
        drawBase()
        drawOverlay()
      }
      scheduleHiRes()
    }
    return
  }

  if (pointers.size > 0) {
    if (g.type === 'layer' || g.type === 'pan') {
      gesture = { type: 'idle' }
      snapLines.value = null
      scheduleOverlay()
    }
    return
  }

  gesture = { type: 'idle' }
  snapLines.value = null
  scheduleOverlay()

  // 双击/双触：快速且几乎未移动的两次点按 → 放大/还原
  const now = performance.now()
  const isTap = pt && !pt.moved && now - pt.downT < 300
  if (isTap && lastTap && now - lastTap.t < 340 && Math.hypot(pt!.x - lastTap.x, pt!.y - lastTap.y) < 28) {
    lastTap = null
    if (zoom.value > minZoom.value + 0.01) {
      animateViewTo(minZoom.value, 0, 0)
    } else {
      // 计算锚定该点、且已约束到边界内的目标视图，再从当前值动画过去
      const c = relCenter(pt!.x, pt!.y)
      const u = { x: (c.x - pan.x) / zoom.value, y: (c.y - pan.y) / zoom.value }
      const z0 = zoom.value
      const p0 = { x: pan.x, y: pan.y }
      zoom.value = DBL_TAP_ZOOM
      pan.x = c.x - u.x * DBL_TAP_ZOOM
      pan.y = c.y - u.y * DBL_TAP_ZOOM
      hardClampPan()
      const target = { x: pan.x, y: pan.y }
      zoom.value = z0
      pan.x = p0.x
      pan.y = p0.y
      animateViewTo(DBL_TAP_ZOOM, target.x, target.y)
    }
    return
  }
  if (isTap) lastTap = { t: now, x: pt!.x, y: pt!.y }

  // 平移结束：越界回弹（与拖动中、硬夹紧一样以让位后的可用区域为基准，
  // 面板展开时全视口基准会把图片放行到面板底下，造成部分内容无法拖回）
  if (g.type === 'pan') {
    const d = displaySize()
    const tx = clampPanAxis(pan.x, d.w, avail.w, false)
    const ty = clampPanAxis(pan.y, d.h, avail.h, false)
    if (Math.abs(tx - pan.x) > 0.5 || Math.abs(ty - pan.y) > 0.5) {
      animateViewTo(zoom.value, tx, ty)
    }
  }
}

/** 缩放结束后按需请求更高分辨率的精修渲染 */
function scheduleHiRes(): void {
  if (settleTimer) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    if (!resultBmp || !active.value) return
    const desired = Math.round(Math.max(view.w, view.h) * zoom.value * (view.dpr || 1))
    const current = Math.max(resultBmp.width, resultBmp.height)
    if (desired > current + 100) void renderBase(false)
  }, 280)
}

function resetView(): void {
  stopViewAnim()
  zoom.value = minZoom.value
  pan.x = 0
  pan.y = 0
}

/* ---------- 渲染调度 ---------- */

// 底图相关变化才走 Worker；水印图层变化只重绘叠加层
watch(
  [
    active,
    () => adjust.values,
    () => adjust.perImage,
    () => settings.previewQuality,
    () => adjust.cropMode,
    () => adjust.crops,
  ],
  () => scheduleBase(),
  { deep: true },
)
watch(
  [() => wm.layers, () => wm.perImage, () => wm.selectedId],
  () => scheduleOverlay(),
  { deep: true },
)

// 切换照片时回到适应视图
watch(
  () => active.value?.id,
  () => resetView(),
)

/* ---------- 裁剪模式 ---------- */

// 进入时以当前裁剪为起点（无则整图），并回到适应视图看清全图；
// 退出时重新适应，确保确认后的裁剪结果完整呈现
watch(
  () => adjust.cropMode,
  (on) => {
    if (on) {
      const a = active.value
      adjust.cropRatio = 'free'
      adjust.cropDraft = { ...(a ? (adjust.cropOf(a.id) ?? FULL_CROP) : FULL_CROP) }
      fitView()
    } else {
      adjust.cropDraft = null
      fitView()
    }
  },
)

// 编辑中切换照片：把框带到新照片（已裁剪用其裁剪，否则整图）
watch(
  [() => adjust.cropMode, () => active.value?.id],
  ([on]) => {
    if (!on) return
    const a = active.value
    adjust.cropDraft = { ...(a ? (adjust.cropOf(a.id) ?? FULL_CROP) : FULL_CROP) }
  },
)

// 比例切换：立即把框调整为该比例的最大内接矩形
watch(
  () => adjust.cropRatio,
  () => {
    applyRatioToDraft()
    drawOverlay()
  },
)

// 翻转 / 拉直变化：重新渲染变换后的全图（防抖，只在调整停顿时渲染一次）
watch(
  () => {
    const d = adjust.cropDraft
    return d ? `${d.rot ?? 0}|${d.flipH ? 1 : 0}|${d.flipV ? 1 : 0}` : ''
  },
  () => {
    if (!adjust.cropMode) return
    if (finalTimer) window.clearTimeout(finalTimer)
    finalTimer = window.setTimeout(() => void renderBase(false), 140)
  },
)

function onCropKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && adjust.cropMode) adjust.exitCrop()
}

onMounted(() => {
  window.addEventListener('keydown', onCropKey)
  if (frame.value) {
    ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      view.w = r.width
      view.h = r.height
      view.dpr = window.devicePixelRatio || 1
      hardClampPan()
      drawBase()
      drawOverlay()
      scheduleBase()
    })
    ro.observe(frame.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCropKey)
  ro?.disconnect()
  if (finalTimer) window.clearTimeout(finalTimer)
  if (settleTimer) window.clearTimeout(settleTimer)
  if (availAnim) cancelAnimationFrame(availAnim)
  stopViewAnim()
  document.removeEventListener('click', closeZoomMenu)
  document.removeEventListener('keydown', onZoomKey)
  if (srcBitmap) {
    srcBitmap.close()
    srcBitmap = null
  }
  if (resultBmp) {
    resultBmp.close()
    resultBmp = null
  }
  for (const bmp of assetBmps.values()) bmp.close()
  assetBmps.clear()
})
</script>

<template>
  <div class="canvas-wrap">
    <div ref="frame" class="frame">
      <canvas
        ref="cvBase"
        class="canvas"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
        @mousedown="onMouseDown"
        @auxclick.prevent
        @contextmenu="emit('ctx', $event)"
      />
      <canvas ref="cvOverlay" class="canvas overlay" aria-hidden="true" />
      <div
        v-if="hasSelection && selRect"
        class="sel"
        :style="{
          left: `${selRect.left}px`,
          top: `${selRect.top}px`,
          width: `${selRect.width}px`,
          height: `${selRect.height}px`,
          transform: `rotate(${selRect.rotate}deg)`,
        }"
      />
    </div>
    <button
      class="zoom-badge"
      :class="{ open: zoomMenuOpen }"
      title="缩放预设"
      @click.stop="zoomMenuOpen = !zoomMenuOpen"
    >
      {{ Math.round(zoom * 100) }}%
      <ChevronUp class="zoom-caret" :size="11" />
      <Transition name="zoom-pop">
        <div v-if="zoomMenuOpen" class="zoom-pop" @click.stop>
          <button
            v-for="p in ZOOM_PRESETS"
            :key="p.label"
            class="zoom-item"
            :class="{ on: p.value !== 'fit' && Math.abs(p.value - zoom) < 0.001 }"
            @click.stop="zoomMenuOpen = false; applyPreset(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
      </Transition>
    </button>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: absolute;
  inset: 0;
  background: var(--canvas);
}
/* 预览安全区：图片适配与命中计算都基于这一帧，移动端避开系统手势条 */
.frame {
  position: absolute;
  inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
}
.overlay {
  pointer-events: none;
}
.canvas:active {
  cursor: grabbing;
}
.sel {
  position: absolute;
  pointer-events: none;
  border: 1.5px solid var(--accent);
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  transition: box-shadow var(--dur-fast) var(--ease);
}
.zoom-badge {
  position: absolute;
  left: calc(10px + var(--safe-left));
  bottom: calc(10px + var(--safe-bottom));
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
  transition: color var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft);
}
.zoom-badge:hover,
.zoom-badge.open {
  color: var(--text);
  border-color: var(--line-strong);
}
.zoom-caret {
  opacity: 0;
  transform: translateY(1px);
  transition: opacity var(--dur-hover) var(--ease-soft), transform var(--dur-hover) var(--ease-soft);
}
.zoom-badge:hover .zoom-caret,
.zoom-badge.open .zoom-caret {
  opacity: 0.75;
  transform: translateY(0);
}
.zoom-badge.open .zoom-caret {
  transform: rotate(-180deg);
}
/* 缩放预设：在数值上方弹出 */
.zoom-pop {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 118px;
  padding: 5px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  background: var(--surface-solid);
  box-shadow: var(--shadow-2);
  transform-origin: bottom left;
}
.zoom-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border-radius: 7px;
  text-align: left;
  font-size: 12.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.zoom-item:hover {
  background: var(--hover);
  color: var(--text);
}
.zoom-item.on {
  color: var(--accent);
  font-weight: 600;
}
.zoom-pop-enter-active,
.zoom-pop-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.zoom-pop-enter-from,
.zoom-pop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}
</style>
