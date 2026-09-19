<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { WatermarkLayer } from '@/types/watermark'
import { hitTest, measureLayer } from '@/core/layout'
import { renderClient } from '@/core/renderer'
import { resolveTokens } from '@/core/tokens'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { useWatermarkStore } from '@/stores/watermark'

const images = useImagesStore()
const wm = useWatermarkStore()
const adjust = useAdjustStore()

const MIN_ZOOM = 1
const MAX_ZOOM = 12
const DBL_TAP_ZOOM = 2.5

const wrap = ref<HTMLDivElement | null>(null)
const cv = ref<HTMLCanvasElement | null>(null)

const view = reactive({ w: 0, h: 0, dpr: 1 })
/** 视图缩放：1 = 适应窗口 */
const zoom = ref(1)
/** 平移（CSS px，相对视口中心） */
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

let mctx: CanvasRenderingContext2D | null = null
let srcBitmap: ImageBitmap | null = null
let srcId: string | null = null
/** 合成结果位图缓存：缩放/平移只重绘，不重新渲染 */
let resultBmp: ImageBitmap | null = null
let renderSeq = 0
let finalTimer: number | null = null
let settleTimer: number | null = null
let rafPending = false
let viewAnim = 0
let ro: ResizeObserver | null = null

const active = computed(() => images.active)
const hasSelection = computed(() => !!wm.selectedId)

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
  // 先取纯数据副本，再做令牌替换（响应式 Proxy 无法跨 Worker 克隆）
  const a = active.value
  return wm.plainLayers().map((l) =>
    l.type === 'text'
      ? { ...l, content: resolveTokens(l.content, a?.exif, a?.baseName) }
      : l,
  )
}

function schedule(): void {
  if (!active.value) {
    selRect.value = null
    return
  }
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      void renderNow(true)
    })
  }
  if (finalTimer) window.clearTimeout(finalTimer)
  finalTimer = window.setTimeout(() => void renderNow(false), 160)
}

async function ensureBitmap(): Promise<ImageBitmap | null> {
  const a = active.value
  if (!a) return null
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

async function renderNow(draft: boolean): Promise<void> {
  const a = active.value
  if (!a || !cv.value) return
  const bmp = await ensureBitmap()
  if (!bmp) return
  const seq = ++renderSeq
  const viewLong = Math.max(view.w, view.h) * view.dpr || 800
  const maxLong = draft ? Math.min(720, viewLong) : Math.min(1600, viewLong)
  const assets = await wm.assetPayloads(wm.layers)
  srcBitmap = null // 即将转移给 Worker
  try {
    const res = await renderClient.renderPreview(
      bmp,
      assets,
      resolvedLayers(),
      adjust.snapshotFor(a.id),
      maxLong,
    )
    if (seq !== renderSeq) return // 过期结果：新一轮渲染已重新解码源图
    srcBitmap = res.srcBack
    srcId = a.id
    if (resultBmp) resultBmp.close()
    resultBmp = res.bitmap
    redraw()
  } catch {
    srcBitmap = null
    srcId = null
  }
}

/** 按当前 zoom/pan 把缓存的结果位图绘制到画布，并更新映射与选框。 */
function redraw(): void {
  const canvas = cv.value
  const bmp = resultBmp
  if (!canvas || !bmp) return
  const dpr = view.dpr || 1
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const fit = Math.min(cw / bmp.width, ch / bmp.height)
  const scale = fit * zoom.value
  const ox = (cw - bmp.width * scale) / 2 + pan.x * dpr
  const oy = (ch - bmp.height * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)
  ctx.drawImage(bmp, 0, 0)
  resultMap.w = bmp.width
  resultMap.h = bmp.height
  resultMap.scale = scale
  resultMap.ox = ox
  resultMap.oy = oy
  updateSelRect()
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
  const canvas = cv.value!
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
  if (!resultBmp) return { w: view.w, h: view.h }
  const dpr = view.dpr || 1
  const fit = Math.min((view.w * dpr) / resultBmp.width, (view.h * dpr) / resultBmp.height) / dpr
  return { w: resultBmp.width * fit, h: resultBmp.height * fit }
}

function hardClampPan(): void {
  const d = displaySize()
  pan.x = clampPanAxis(pan.x, d.w, view.w, false)
  pan.y = clampPanAxis(pan.y, d.h, view.h, false)
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
    redraw()
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
  const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  if (z1 === z0) return
  const rcx = cx - view.w / 2
  const rcy = cy - view.h / 2
  pan.x = rcx - ((rcx - pan.x) / z0) * z1
  pan.y = rcy - ((rcy - pan.y) / z0) * z1
  zoom.value = z1
  hardClampPan()
  redraw()
}

function onWheel(e: WheelEvent): void {
  if (!resultBmp) return
  e.preventDefault()
  stopViewAnim()
  const rect = cv.value!.getBoundingClientRect()
  // 触控板捏合带 ctrlKey，增量小、更细腻
  const k = e.ctrlKey ? 0.01 : 0.0016
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoom.value * Math.exp(-e.deltaY * k))
  scheduleHiRes()
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
  | { type: 'layer'; id: string; startClient: { x: number; y: number }; startX: number; startY: number }
  | { type: 'pan'; startPan: { x: number; y: number }; startClient: { x: number; y: number } }
  | {
      type: 'pinch'
      startDist: number
      startZoom: number
      startMid: { x: number; y: number }
      startPan: { x: number; y: number }
    }

let gesture: Gesture = { type: 'idle' }
let lastTap: { t: number; x: number; y: number } | null = null

function relCenter(clientX: number, clientY: number): { x: number; y: number } {
  const rect = cv.value!.getBoundingClientRect()
  return { x: clientX - rect.left - view.w / 2, y: clientY - rect.top - view.h / 2 }
}

function pinchInfo(): { dist: number; mid: { x: number; y: number } } {
  const pts = [...pointers.values()]
  const [a, b] = pts
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mid: { x: (a.x + b.x) / 2 - view.w / 2, y: (a.y + b.y) / 2 - view.h / 2 },
  }
}

function onPointerDown(e: PointerEvent): void {
  const canvas = cv.value
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
    return
  }
  if (pointers.size > 2) return

  const p = toImagePx(e.clientX, e.clientY)
  const list = wm.layers
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    if (!l.visible) continue
    const box = measureLayer(resolvedLayer(l), resultMap.w, resultMap.h, measureContext())
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      gesture = {
        type: 'layer',
        id: l.id,
        startClient: { x: e.clientX, y: e.clientY },
        startX: l.x,
        startY: l.y,
      }
      return
    }
  }
  wm.selectedId = null
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
    if (z < MIN_ZOOM) z = MIN_ZOOM - rubberband(MIN_ZOOM - z, MAX_ZOOM - MIN_ZOOM)
    else if (z > MAX_ZOOM) z = MAX_ZOOM + rubberband(z - MAX_ZOOM, MAX_ZOOM - MIN_ZOOM)
    zoom.value = z
    // 捏合中点下的图像点保持不动（1:1 跟手）
    const u = {
      x: (gesture.startMid.x - gesture.startPan.x) / gesture.startZoom,
      y: (gesture.startMid.y - gesture.startPan.y) / gesture.startZoom,
    }
    pan.x = mid.x - u.x * z
    pan.y = mid.y - u.y * z
    redraw()
    return
  }

  if (gesture.type === 'layer') {
    const canvas = cv.value
    if (!canvas) return
    const dpr = view.dpr || 1
    const imageCssW = (resultMap.w * resultMap.scale) / dpr
    const imageCssH = (resultMap.h * resultMap.scale) / dpr
    const dxPct = ((e.clientX - gesture.startClient.x) / imageCssW) * 100
    const dyPct = ((e.clientY - gesture.startClient.y) / imageCssH) * 100
    const nx = Math.min(100, Math.max(0, gesture.startX + dxPct))
    const ny = Math.min(100, Math.max(0, gesture.startY + dyPct))
    wm.update(gesture.id, { x: nx, y: ny })
    return
  }

  if (gesture.type === 'pan') {
    const d = displaySize()
    pan.x = clampPanAxis(
      gesture.startPan.x + (e.clientX - gesture.startClient.x),
      d.w,
      view.w,
      true,
    )
    pan.y = clampPanAxis(
      gesture.startPan.y + (e.clientY - gesture.startClient.y),
      d.h,
      view.h,
      true,
    )
    redraw()
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
      const tz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value))
      const d = displaySize()
      zoom.value = tz
      const tx = clampPanAxis(pan.x, d.w, view.w, false)
      const ty = clampPanAxis(pan.y, d.h, view.h, false)
      if (Math.abs(tx - pan.x) > 0.5 || Math.abs(ty - pan.y) > 0.5) {
        animateViewTo(tz, tx, ty)
      } else {
        hardClampPan()
        redraw()
      }
      scheduleHiRes()
    }
    return
  }

  if (pointers.size > 0) {
    if (g.type === 'layer' || g.type === 'pan') gesture = { type: 'idle' }
    return
  }

  gesture = { type: 'idle' }

  // 双击/双触：快速且几乎未移动的两次点按 → 放大/还原
  const now = performance.now()
  const isTap = pt && !pt.moved && now - pt.downT < 300
  if (isTap && lastTap && now - lastTap.t < 340 && Math.hypot(pt!.x - lastTap.x, pt!.y - lastTap.y) < 28) {
    lastTap = null
    if (zoom.value > MIN_ZOOM + 0.01) {
      animateViewTo(MIN_ZOOM, 0, 0)
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

  // 平移结束：越界回弹
  if (g.type === 'pan') {
    const d = displaySize()
    const tx = clampPanAxis(pan.x, d.w, view.w, false)
    const ty = clampPanAxis(pan.y, d.h, view.h, false)
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
    if (desired > current + 100) void renderNow(false)
  }, 280)
}

function resetView(): void {
  stopViewAnim()
  zoom.value = MIN_ZOOM
  pan.x = 0
  pan.y = 0
}

/* ---------- 渲染调度 ---------- */

watch(
  [active, () => wm.layers, () => adjust.values, () => adjust.perImage, () => view.w, () => view.h],
  () => schedule(),
  { deep: true },
)

// 切换照片时回到适应视图
watch(
  () => active.value?.id,
  () => resetView(),
)

onMounted(() => {
  if (wrap.value) {
    ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      view.w = r.width
      view.h = r.height
      view.dpr = window.devicePixelRatio || 1
      hardClampPan()
      schedule()
    })
    ro.observe(wrap.value)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (finalTimer) window.clearTimeout(finalTimer)
  if (settleTimer) window.clearTimeout(settleTimer)
  stopViewAnim()
  if (srcBitmap) {
    srcBitmap.close()
    srcBitmap = null
  }
  if (resultBmp) {
    resultBmp.close()
    resultBmp = null
  }
})
</script>

<template>
  <div ref="wrap" class="canvas-wrap">
    <canvas
      ref="cv"
      class="canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    />
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
</template>

<style scoped>
.canvas-wrap {
  position: absolute;
  inset: 0;
  background: var(--canvas);
}
.canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
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
</style>
