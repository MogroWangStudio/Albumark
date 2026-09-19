<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Check, Plus, Save, Trash2 } from 'lucide-vue-next'
import LayerEditor from '@/components/LayerEditor.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import type { DropdownItem } from '@/components/ui/AppDropdown.vue'
import { drawLayers, type AssetMap } from '@/core/draw'
import { anchorPoint, hitTest, layerCenter, measureLayer } from '@/core/layout'
import { resolveTokens } from '@/core/tokens'
import { toast } from '@/stores/toast'
import { usePresetsStore } from '@/stores/presets'
import { useSettingsStore } from '@/stores/settings'
import { useWatermarkStore } from '@/stores/watermark'
import type { WatermarkLayer } from '@/types/watermark'

const emit = defineEmits<{ back: [] }>()

const wm = useWatermarkStore()
const presets = usePresetsStore()
const settings = useSettingsStore()

const SAMPLE_W = 1600
const SAMPLE_H = 1067
const SAMPLE_LONG = Math.max(SAMPLE_W, SAMPLE_H)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const boxEl = ref<HTMLDivElement | null>(null)
const showSave = ref(false)
const saveName = ref('')
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

/** 生成一张干净的样张（渐变天空 + 地平线），工作室里预览水印效果 */
async function makeSample(): Promise<ImageBitmap> {
  const oc = new OffscreenCanvas(SAMPLE_W, SAMPLE_H)
  const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D
  const sky = ctx.createLinearGradient(0, 0, 0, SAMPLE_H * 0.72)
  sky.addColorStop(0, '#2b3a4a')
  sky.addColorStop(0.65, '#6e7f8c')
  sky.addColorStop(1, '#c9b8a3')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, SAMPLE_W, SAMPLE_H * 0.72)
  // 太阳
  ctx.fillStyle = 'rgba(255, 214, 156, 0.9)'
  ctx.beginPath()
  ctx.arc(SAMPLE_W * 0.68, SAMPLE_H * 0.4, SAMPLE_H * 0.11, 0, Math.PI * 2)
  ctx.fill()
  // 地面
  const ground = ctx.createLinearGradient(0, SAMPLE_H * 0.72, 0, SAMPLE_H)
  ground.addColorStop(0, '#4a4238')
  ground.addColorStop(1, '#2a2620')
  ctx.fillStyle = ground
  ctx.fillRect(0, SAMPLE_H * 0.72, SAMPLE_W, SAMPLE_H * 0.28)
  // 远山剪影
  ctx.fillStyle = 'rgba(38, 34, 30, 0.85)'
  ctx.beginPath()
  ctx.moveTo(0, SAMPLE_H * 0.72)
  ctx.lineTo(SAMPLE_W * 0.22, SAMPLE_H * 0.55)
  ctx.lineTo(SAMPLE_W * 0.4, SAMPLE_H * 0.72)
  ctx.lineTo(SAMPLE_W * 0.56, SAMPLE_H * 0.6)
  ctx.lineTo(SAMPLE_W * 0.78, SAMPLE_H * 0.72)
  ctx.closePath()
  ctx.fill()
  return await createImageBitmap(oc)
}

function resolvedLayers(): WatermarkLayer[] {
  return wm.plainLayers().map((l) =>
    l.type === 'text' ? { ...l, content: resolveTokens(l.content, undefined, '样张') } : l,
  )
}

function redraw(): void {
  const canvas = canvasEl.value
  const box = boxEl.value
  if (!canvas || !box || !sampleBmp) return
  // 画布 CSS 尺寸显式锁定为容器内按样张比例的适配值：
  // 若依赖浏览器自动尺寸，改写 canvas.width 属性会反过来改变布局，形成反馈循环
  const rect = box.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dispW = Math.max(1, Math.min(rect.width, rect.height * (SAMPLE_W / SAMPLE_H)))
  const dispH = Math.max(1, dispW * (SAMPLE_H / SAMPLE_W))
  canvas.style.width = `${Math.round(dispW)}px`
  canvas.style.height = `${Math.round(dispH)}px`
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cw = Math.round(dispW * dpr)
  const ch = Math.round(dispH * dpr)
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const fit = Math.min(cw / SAMPLE_W, ch / SAMPLE_H)
  const ox = (cw - SAMPLE_W * fit) / 2
  const oy = (ch - SAMPLE_H * fit) / 2
  ctx.translate(ox, oy)
  ctx.scale(fit, fit)
  ctx.drawImage(sampleBmp, 0, 0)
  drawLayers(ctx, SAMPLE_W, SAMPLE_H, resolvedLayers(), assetBmps)

  // 选中图层：描边框 + 锚点十字，与主界面预览一致
  const sel = wm.selected
  if (sel) {
    const box = measureLayer(sel, SAMPLE_W, SAMPLE_H, measureContext())
    ctx.save()
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
  vmap.ox = ox
  vmap.oy = oy
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

/* ---------- 样张画布上的拖拽 ---------- */

interface DragState {
  id: string
  startClient: { x: number; y: number }
  startCx: number
  startCy: number
}
let drag: DragState | null = null

function toImagePx(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = canvasEl.value!
  const rect = canvas.getBoundingClientRect()
  const dx = (clientX - rect.left) * vmap.dpr
  const dy = (clientY - rect.top) * vmap.dpr
  return { x: (dx - vmap.ox) / vmap.scale, y: (dy - vmap.oy) / vmap.scale }
}

function onPointerDown(e: PointerEvent): void {
  if (!sampleBmp || !vmap.scale) return
  const p = toImagePx(e.clientX, e.clientY)
  const list = wm.layers
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    if (!l.visible) continue
    const box = measureLayer(l, SAMPLE_W, SAMPLE_H, measureContext())
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      const c = layerCenter(l, SAMPLE_W, SAMPLE_H)
      drag = { id: l.id, startClient: { x: e.clientX, y: e.clientY }, startCx: c.cx, startCy: c.cy }
      grabbing.value = true
      canvasEl.value?.setPointerCapture(e.pointerId)
      return
    }
  }
  wm.selectedId = null
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) {
    onCursorMove(e)
    return
  }
  const layer = wm.layers.find((l) => l.id === drag!.id)
  if (!layer) return
  const dpx = ((e.clientX - drag.startClient.x) * vmap.dpr) / vmap.scale
  const dpy = ((e.clientY - drag.startClient.y) * vmap.dpr) / vmap.scale
  let cx = drag.startCx + dpx
  let cy = drag.startCy + dpy
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
    offsetX: ((cx - a.x) / SAMPLE_LONG) * 100,
    offsetY: ((cy - a.y) / SAMPLE_LONG) * 100,
  })
}

function onPointerUp(): void {
  drag = null
  grabbing.value = false
}

function onLeave(): void {
  if (!drag) grabbing.value = false
}

function onCursorMove(e: PointerEvent): void {
  if (!sampleBmp || !vmap.scale) return
  const p = toImagePx(e.clientX, e.clientY)
  for (let i = wm.layers.length - 1; i >= 0; i--) {
    const l = wm.layers[i]
    if (!l.visible) continue
    if (hitTest(measureLayer(l, SAMPLE_W, SAMPLE_H, measureContext()), p.x, p.y)) {
      grabbing.value = true
      return
    }
  }
  grabbing.value = false
}

function presetItems(): DropdownItem[] {
  if (!presets.all.length) return [{ label: '还没有保存的水印', disabled: true, action: () => undefined }]
  return presets.all.map((p) => ({
    label: p.name,
    danger: false,
    action: () => {
      presets.apply(p.id)
    },
  }))
}

function deleteItems(): DropdownItem[] {
  return presets.all.map((p) => ({
    label: `删除「${p.name}」`,
    danger: true,
    action: () => presets.remove(p.id),
  }))
}

async function savePreset(): Promise<void> {
  const name = saveName.value.trim()
  if (!name) return
  if (!presets.save(name)) {
    toast('水印过大，保存失败', 'error')
    return
  }
  showSave.value = false
  saveName.value = ''
  toast(`已保存水印「${name}」`, 'success')
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  sampleBmp = await makeSample()
  ro = new ResizeObserver(() => redraw())
  if (boxEl.value) ro.observe(boxEl.value)
  redraw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  sampleBmp?.close()
  sampleBmp = null
  for (const b of assetBmps.values()) b.close()
  assetBmps.clear()
})

// 图层任何变化（含应用预设替换数组、拖动偏移）都即时重绘
watch([() => wm.layers, () => wm.selectedId], scheduleRedraw, { deep: true })
</script>

<template>
  <div class="studio">
    <header class="head material" data-tauri-drag-region>
      <AppButton variant="ghost" size="sm" @click="emit('back')"><ArrowLeft :size="14" />返回</AppButton>
      <h1>水印工作室</h1>
      <span class="flex" />
      <AppButton size="sm" @click="wm.addText()"><Plus :size="13" />新建空白</AppButton>
      <AppDropdown :items="presetItems()" align="right">
        <template #trigger>
          <AppButton size="sm"><Check :size="13" />应用水印</AppButton>
        </template>
      </AppDropdown>
      <AppDropdown v-if="presets.all.length" :items="deleteItems()" align="right">
        <template #trigger>
          <AppButton size="sm" variant="ghost"><Trash2 :size="13" /></AppButton>
        </template>
      </AppDropdown>
      <AppButton size="sm" variant="primary" @click="showSave = true"><Save :size="13" />保存为水印</AppButton>
    </header>

    <div v-if="showSave" class="save-bar">
      <input v-model="saveName" class="text-input" placeholder="水印名称" @keyup.enter="savePreset" />
      <AppButton size="sm" variant="primary" @click="savePreset">保存</AppButton>
      <AppButton size="sm" variant="ghost" @click="showSave = false">取消</AppButton>
    </div>

    <div class="body">
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
        />
        <p class="tip">样张仅用于预览，可直接拖动水印；保存的水印会应用到项目里的每一张照片。</p>
      </div>
      <aside class="editor material">
        <LayerEditor :img-w="SAMPLE_W" :img-h="SAMPLE_H" :show-templates="false" />
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
  display: grid;
  place-items: center;
  padding: 20px;
  min-width: 0;
  min-height: 0;
  background: var(--canvas);
}
.sample {
  display: block;
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
  touch-action: none;
  cursor: default;
}
.sample.grab {
  cursor: grab;
}
.tip {
  position: absolute;
  bottom: 10px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-3);
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
