<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, Check, Plus, Save } from 'lucide-vue-next'
import LayerEditor from '@/components/LayerEditor.vue'
import TemplateManager from '@/components/TemplateManager.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { type AssetMap } from '@/core/draw'
import { makeSampleBitmap, paintComposed, SAMPLE_H, SAMPLE_W } from '@/core/sample'
import { anchorPoint, hitTest, layerPivot, measureLayer } from '@/core/layout'
import { resolveTokens } from '@/core/tokens'
import { toast } from '@/stores/toast'
import { useSettingsStore } from '@/stores/settings'
import { useTemplatesStore } from '@/stores/templates'
import { useWatermarkStore } from '@/stores/watermark'
import type { WatermarkLayer } from '@/types/watermark'

const emit = defineEmits<{ back: [] }>()

const wm = useWatermarkStore()
const settings = useSettingsStore()
const templates = useTemplatesStore()

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
  editingId.value ? (templates.get(editingId.value)?.name ?? '未命名模板') : '新建模板',
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
    if (templates.update(editingId.value)) toast(`已保存「${editingName.value}」`, 'success')
    else toast('模板过大，保存失败', 'error')
    return
  }
  startSaveAs()
}

/** 另存为：弹出名称栏，把当前编辑内容存为新模板 */
function startSaveAs(): void {
  saveName.value = editingBuiltin.value ? `${editingName.value} 副本` : ''
  showSave.value = true
}

async function saveAsNew(): Promise<void> {
  const name = saveName.value.trim()
  if (!name) return
  const id = templates.save(name)
  if (!id) {
    toast('模板过大，保存失败', 'error')
    return
  }
  showSave.value = false
  saveName.value = ''
  editingId.value = id
  toast(`已保存模板「${name}」`, 'success')
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const boxEl = ref<HTMLDivElement | null>(null)
/** 画布上悬停/拖动到图层时的抓取光标 */
const grabbing = ref(false)

let sampleBmp: ImageBitmap | null = null
const assetBmps: AssetMap = new Map()
let rafPending = false
/** 最近一次绘制到画布的映射（设备像素），命中测试与拖拽换算用 */
const vmap = { scale: 1, ox: 0, oy: 0, dpr: 1 }

let mctx: CanvasRenderingContext2D | null = null
function measureContext(): CanvasRenderingContext2D {
  if (!mctx) {
    mctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  }
  return mctx
}

function resolvedLayers(): WatermarkLayer[] {
  return wm.plainLayers().map((l) =>
    l.type === 'text' ? { ...l, content: resolveTokens(l.content, undefined, '样张') } : l,
  )
}

/** 含边框扩展的最终画布尺寸（照片区域仍是样张尺寸） */
const frameSize = computed(() => {
  let l = 0
  let r = 0
  let t = 0
  let b = 0
  for (const layer of wm.layers) {
    if (layer.type === 'border' && layer.visible) {
      l += layer.left
      r += layer.right
      t += layer.top
      b += layer.bottom
    }
  }
  return { w: SAMPLE_W + l + r, h: SAMPLE_H + t + b }
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
  const composed = paintComposed(ctx, sampleBmp, SAMPLE_W, SAMPLE_H, resolvedLayers(), assetBmps)
  const { photoX, photoY } = composed

  // 选中图层：描边框 + 锚点十字，画在照片区域坐标系（边框层全画布，不画锚点）
  const sel = wm.selected
  if (sel && sel.type !== 'border') {
    ctx.save()
    ctx.translate(photoX, photoY)
    const box = measureLayer(sel, SAMPLE_W, SAMPLE_H, measureContext())
    ctx.strokeStyle = 'rgba(255, 167, 47, 0.95)'
    ctx.lineWidth = 1.5 / fit
    ctx.setLineDash([5 / fit, 4 / fit])
    ctx.strokeRect(box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h)
    const a = anchorPoint(sel.anchor, SAMPLE_W, SAMPLE_H)
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(255, 167, 47, 0.75)'
    ctx.lineWidth = 1 / fit
    const r = 7 / fit
    ctx.beginPath()
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
    ctx.moveTo(a.x - r * 1.8, a.y)
    ctx.lineTo(a.x + r * 1.8, a.y)
    ctx.moveTo(a.x, a.y - r * 1.8)
    ctx.lineTo(a.x, a.y + r * 1.8)
    ctx.stroke()
    ctx.restore()
  }
  vmap.scale = fit
  // 指针换算基于照片区域原点（水印定位坐标系）
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
  const needed = new Set(
    wm.layers.filter((l) => l.type === 'image').map((l) => (l as { assetId: string }).assetId),
  )
  for (const key of [...assetBmps.keys()]) {
    if (!needed.has(key)) {
      assetBmps.get(key)?.close()
      assetBmps.delete(key)
    }
  }
  const missing = [...needed].filter((id) => !assetBmps.has(id))
  if (!missing.length) return
  const payloads = await wm.assetPayloads(wm.layers)
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

/** Apple 式橡皮筋：越界越多阻力越大 */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

function clampPanAxis(v: number, disp: number, viewport: number, soft: boolean): number {
  const max = Math.max(0, (disp * viewZoom.value - viewport) / 2)
  if (max === 0) return 0
  if (Math.abs(v) <= max) return v
  if (!soft) return Math.sign(v) * max
  return Math.sign(v) * (max + rubberband(Math.abs(v) - max, viewport))
}

function hardClampPan(): void {
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!rect) return
  const d = fitSize(rect)
  viewPan.x = clampPanAxis(viewPan.x, d.w, rect.width, false)
  viewPan.y = clampPanAxis(viewPan.y, d.h, rect.height, false)
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
  const list = wm.layers
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    if (l.type === 'border' || !l.visible) continue
    const box = measureLayer(l, SAMPLE_W, SAMPLE_H, measureContext())
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      const c = layerPivot(l, SAMPLE_W, SAMPLE_H)
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

  if (gesture.type === 'layer') {
    const gid = gesture.id
    const layer = wm.layers.find((l) => l.id === gid)
    if (!layer || layer.type === 'border') return
    const dpx = ((e.clientX - gesture.startClient.x) * vmap.dpr) / vmap.scale
    const dpy = ((e.clientY - gesture.startClient.y) * vmap.dpr) / vmap.scale
    let cx = gesture.startCx + dpx
    let cy = gesture.startCy + dpy
    // 吸附样张中线与安全边距
    if (settings.wmSnap) {
      const t = 8 / (vmap.scale / vmap.dpr)
      for (const x of [SAMPLE_W / 2, SAMPLE_W * 0.04, SAMPLE_W * 0.96]) {
        if (Math.abs(cx - x) < t) cx = x
      }
      for (const y of [SAMPLE_H / 2, SAMPLE_H * 0.04, SAMPLE_H * 0.96]) {
        if (Math.abs(cy - y) < t) cy = y
      }
    }
    const a = anchorPoint(layer.anchor, SAMPLE_W, SAMPLE_H)
    wm.update(layer.id, {
      offsetX: Math.round(cx - a.x),
      offsetY: Math.round(cy - a.y),
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
      true,
    )
    viewPan.y = clampPanAxis(
      gesture.startPan.y + (e.clientY - gesture.startClient.y),
      d.h,
      rect.height,
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
      const tz = Math.min(MAX_ZOOM, Math.max(1, viewZoom.value))
      const rect = canvasEl.value?.getBoundingClientRect()
      let tx = viewPan.x
      let ty = viewPan.y
      if (rect) {
        const d = fitSize(rect)
        tx = clampPanAxis(viewPan.x, d.w, rect.width, false)
        ty = clampPanAxis(viewPan.y, d.h, rect.height, false)
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
      gesture = { type: 'idle' }
      grabbing.value = false
    }
    return
  }

  if (g.type === 'layer') grabbing.value = false
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
    const tx = clampPanAxis(viewPan.x, d.w, rect.width, false)
    const ty = clampPanAxis(viewPan.y, d.h, rect.height, false)
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
  for (let i = wm.layers.length - 1; i >= 0; i--) {
    const l = wm.layers[i]
    if (l.type === 'border' || !l.visible) continue
    if (hitTest(measureLayer(l, SAMPLE_W, SAMPLE_H, measureContext()), p.x, p.y)) {
      grabbing.value = true
      return
    }
  }
  grabbing.value = false
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  // 工作室编辑的是全局水印模板，脱离照片级编辑上下文
  wm.setEditContext(null)
  sampleBmp = await makeSampleBitmap()
  ro = new ResizeObserver(() => redraw())
  if (boxEl.value) ro.observe(boxEl.value)
  redraw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  stopViewAnim()
  sampleBmp?.close()
  sampleBmp = null
  for (const b of assetBmps.values()) b.close()
  assetBmps.clear()
})

// 图层任何变化（含应用预设替换数组、拖动偏移）都即时重绘
watch([() => wm.layers, () => wm.selectedId], scheduleRedraw, { deep: true })

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
        <AppButton variant="ghost" size="sm" @click="emit('back')"><ArrowLeft :size="14" />返回</AppButton>
        <h1>水印工作室</h1>
        <span class="flex" />
        <AppButton size="sm" variant="primary" @click="openCreate"><Plus :size="13" />新建模板</AppButton>
      </template>
      <template v-else>
        <AppButton variant="ghost" size="sm" @click="backToManage"><ArrowLeft :size="14" />模板库</AppButton>
        <h1 class="edit-title" :title="editingName">{{ editingName }}</h1>
        <span v-if="editingBuiltin" class="badge">内置 · 保存将另存为副本</span>
        <span class="flex" />
        <AppButton size="sm" @click="saveEdit"><Save :size="13" />{{ editingBuiltin ? '另存为副本' : '保存' }}</AppButton>
        <AppButton v-if="!editingBuiltin && editingId" size="sm" variant="ghost" @click="startSaveAs">
          <Check :size="13" />另存为新模板
        </AppButton>
      </template>
    </header>

    <div v-if="showSave" class="save-bar">
      <input
        v-model="saveName"
        class="text-input"
        placeholder="模板名称"
        @keyup.enter="saveAsNew"
      />
      <AppButton size="sm" variant="primary" @click="saveAsNew">保存</AppButton>
      <AppButton size="sm" variant="ghost" @click="showSave = false">取消</AppButton>
    </div>

    <!-- 模板管理：卡片列出全部模板（默认视图） -->
    <Transition name="pane" mode="out-in">
      <TemplateManager v-if="mode === 'manage'" @edit="openEdit" @create="openCreate" />
    </Transition>

    <!-- 模板编辑器：v-show 常驻，画布状态与视图变换在切换间保留 -->
    <div v-show="mode === 'edit'" class="body">
      <div ref="boxEl" class="preview">
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
        <LayerEditor :img-w="frameSize.w" :img-h="frameSize.h" :show-templates="false" />
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
  padding: var(--safe-top) calc(14px + var(--safe-right)) 0 calc(14px + var(--safe-left));
  flex: none;
  border-bottom: 1px solid var(--line);
}
h1 {
  font-size: 14px;
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
  font-size: 11px;
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
  font-size: 12.5px;
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
  background: var(--canvas);
}
/* 画布铺满容器（四周留边），缩放与平移都发生在画布内部的绘制变换里 */
.sample {
  position: absolute;
  inset: 20px;
  width: calc(100% - 40px);
  height: calc(100% - 40px);
  display: block;
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
  touch-action: none;
  cursor: default;
}
.sample.grab {
  cursor: grab;
}
.editor {
  border-left: 1px solid var(--line);
  overflow-y: auto;
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
