<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { WatermarkLayer } from '@/types/watermark'
import { anchorPoint, hitTest, layerCenter, measureLayer } from '@/core/layout'
import { drawLayers, type AssetMap } from '@/core/draw'
import { renderClient } from '@/core/renderer'
import { resolveTokens } from '@/core/tokens'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { useSettingsStore } from '@/stores/settings'
import { useWatermarkStore } from '@/stores/watermark'

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
/** 视图缩放：minZoom（安全区）= 适应窗口 */
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
  // 先取纯数据副本，再做令牌替换（响应式 Proxy 无法直接用于克隆）
  const a = active.value
  return wm.plainLayers().map((l) =>
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
  return wm.layers.some((l) => l.type === 'image' && !assetBmps.has((l as { assetId: string }).assetId))
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
    const res = await renderClient.renderPreview(
      bmp,
      [],
      [],
      adjust.snapshotFor(a.id),
      maxLong,
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
    wm.layers.filter((l) => l.type === 'image').map((l) => (l as { assetId: string }).assetId),
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
  const fit = Math.min(cw / bmp.width, ch / bmp.height)
  const scale = fit * zoom.value
  const ox = (cw - bmp.width * scale) / 2 + pan.x * dpr
  const oy = (ch - bmp.height * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)

  const layers = resolvedLayers()
  drawLayers(ctx, bmp.width, bmp.height, layers, assetBmps)

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
  const rcx = cx - view.w / 2
  const rcy = cy - view.h / 2
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

let gesture: Gesture = { type: 'idle' }
let lastTap: { t: number; x: number; y: number } | null = null

function relCenter(clientX: number, clientY: number): { x: number; y: number } {
  const rect = cvBase.value!.getBoundingClientRect()
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
  for (const l of wm.layers) {
    if (l.id === excludeId || !l.visible) continue
    const c = layerCenter(l, imgW, imgH)
    xs.push(c.cx)
    ys.push(c.cy)
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

  const p = toImagePx(e.clientX, e.clientY)
  const list = wm.layers
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
      const c = layerCenter(l, resultMap.w, resultMap.h)
      gesture = {
        type: 'layer',
        id: l.id,
        startClient: { x: e.clientX, y: e.clientY },
        startCx: c.cx,
        startCy: c.cy,
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

  if (gesture.type === 'layer') {
    const canvas = cvBase.value
    if (!canvas || !resultMap.w) return
    const gid = gesture.id
    const dpr = view.dpr || 1
    const cssPerImg = resultMap.scale / dpr
    const imgW = resultMap.w
    const imgH = resultMap.h
    const long = Math.max(imgW, imgH)
    const proposedX = gesture.startCx + (e.clientX - gesture.startClient.x) / cssPerImg
    const proposedY = gesture.startCy + (e.clientY - gesture.startClient.y) / cssPerImg
    const snapped = applySnap(proposedX, proposedY, gid)
    const cx = Math.min(imgW, Math.max(0, snapped.cx))
    const cy = Math.min(imgH, Math.max(0, snapped.cy))
    const layer = wm.layers.find((l) => l.id === gid)
    if (!layer) return
    const a = anchorPoint(layer.anchor, imgW, imgH)
    snapLines.value = snapped.lines.x !== undefined || snapped.lines.y !== undefined ? snapped.lines : null
    wm.update(gid, {
      offsetX: ((cx - a.x) / long) * 100,
      offsetY: ((cy - a.y) / long) * 100,
    })
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
      const tx = clampPanAxis(pan.x, d.w, view.w, false)
      const ty = clampPanAxis(pan.y, d.h, view.h, false)
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
  [active, () => adjust.values, () => adjust.perImage, () => settings.previewQuality],
  () => scheduleBase(),
  { deep: true },
)
watch(
  [() => wm.layers, () => wm.selectedId],
  () => scheduleOverlay(),
  { deep: true },
)

// 切换照片时回到适应视图
watch(
  () => active.value?.id,
  () => resetView(),
)

onMounted(() => {
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
        @contextmenu.prevent
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
    <div class="zoom-badge" aria-live="off">{{ Math.round(zoom * 100) }}%</div>
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
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
  pointer-events: none;
}
</style>
