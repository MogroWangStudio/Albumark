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

const wrap = ref<HTMLDivElement | null>(null)
const cv = ref<HTMLCanvasElement | null>(null)

const view = reactive({ w: 0, h: 0, dpr: 1 })
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
let renderSeq = 0
let finalTimer: number | null = null
let rafPending = false
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
      adjust.snapshot(),
      maxLong,
    )
    if (seq !== renderSeq) return // 过期结果：新一轮渲染已重新解码源图
    srcBitmap = res.srcBack
    srcId = a.id
    drawResult(res.bitmap)
  } catch {
    srcBitmap = null
    srcId = null
  }
}

function drawResult(bmp: ImageBitmap): void {
  const canvas = cv.value
  if (!canvas) return
  const dpr = view.dpr || 1
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, cw, ch)
  const scale = Math.min(cw / bmp.width, ch / bmp.height)
  const ox = (cw - bmp.width * scale) / 2
  const oy = (ch - bmp.height * scale) / 2
  ctx.drawImage(bmp, ox, oy, bmp.width * scale, bmp.height * scale)
  resultMap.w = bmp.width
  resultMap.h = bmp.height
  resultMap.scale = scale
  resultMap.ox = ox
  resultMap.oy = oy
  bmp.close()
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

function onPointerDown(e: PointerEvent): void {
  const canvas = cv.value
  if (!canvas || !resultMap.w) return
  const p = toImagePx(e.clientX, e.clientY)
  const list = wm.layers
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    if (!l.visible) continue
    const box = measureLayer(resolvedLayer(l), resultMap.w, resultMap.h, measureContext())
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      startDrag(e, l)
      return
    }
  }
  wm.selectedId = null
}

/** 1:1 跟手拖动，释放时把中心约束回画面。 */
function startDrag(e: PointerEvent, layer: WatermarkLayer): void {
  const canvas = cv.value
  if (!canvas) return
  const dpr = view.dpr || 1
  const imageCssW = (resultMap.w * resultMap.scale) / dpr
  const imageCssH = (resultMap.h * resultMap.scale) / dpr
  const startClient = { x: e.clientX, y: e.clientY }
  const startX = layer.x
  const startY = layer.y
  canvas.setPointerCapture(e.pointerId)

  const onMove = (ev: PointerEvent): void => {
    const dxPct = ((ev.clientX - startClient.x) / imageCssW) * 100
    const dyPct = ((ev.clientY - startClient.y) / imageCssH) * 100
    const nx = Math.min(100, Math.max(0, startX + dxPct))
    const ny = Math.min(100, Math.max(0, startY + dyPct))
    wm.update(layer.id, { x: nx, y: ny })
  }
  const onUp = (): void => {
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
}

watch(
  [active, () => wm.layers, () => adjust.values, () => view.w, () => view.h],
  () => schedule(),
  { deep: true },
)

onMounted(() => {
  if (wrap.value) {
    ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      view.w = r.width
      view.h = r.height
      view.dpr = window.devicePixelRatio || 1
      schedule()
    })
    ro.observe(wrap.value)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (finalTimer) window.clearTimeout(finalTimer)
  if (srcBitmap) {
    srcBitmap.close()
    srcBitmap = null
  }
})
</script>

<template>
  <div ref="wrap" class="canvas-wrap">
    <canvas ref="cv" class="canvas" @pointerdown="onPointerDown" />
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
