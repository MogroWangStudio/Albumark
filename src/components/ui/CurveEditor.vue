<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import { curvePoints } from '@/core/adjust'

/**
 * 色调曲线编辑器：0–1 归一化的控制点，端点 x 固定在 0/1、y 可动。
 * 拖动 1:1 跟手；空白处按下加点；双击内部点移除。
 */
const props = defineProps<{ modelValue?: number[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: number[] | undefined] }>()

const cv = ref<HTMLCanvasElement | null>(null)
/** 曲线区四周的内边距（CSS px），绘制与指针映射共用同一坐标系 */
const PAD = 10

interface Pt {
  x: number
  y: number
}

function ptsFromProp(): Pt[] {
  const p = curvePoints(props.modelValue)
  if (p.length < 2) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
  }
  return p
}

let dragging = -1
let ctx: CanvasRenderingContext2D | null = null

function draw(): void {
  const canvas = cv.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  // 位图按实际显示尺寸设置（正方形由 CSS aspect-ratio 保证），避免拉伸变形
  const rect = canvas.getBoundingClientRect()
  const s = Math.max(1, Math.round(rect.width * dpr))
  if (canvas.width !== s) {
    canvas.width = s
    canvas.height = s
  }
  if (!ctx) ctx = canvas.getContext('2d')
  if (!ctx) return
  const c = ctx
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, s, s)
  const pad = PAD * dpr
  const inner = s - pad * 2
  const css = (v: number): number => pad + v * inner

  // 网格
  c.strokeStyle = 'rgba(128, 128, 128, 0.18)'
  c.lineWidth = 1
  for (let i = 1; i < 4; i++) {
    const g = css(i / 4)
    c.beginPath()
    c.moveTo(g, pad)
    c.lineTo(g, s - pad)
    c.moveTo(pad, g)
    c.lineTo(s - pad, g)
    c.stroke()
  }
  // 恒等对角线参考
  c.strokeStyle = 'rgba(128, 128, 128, 0.3)'
  c.setLineDash([4 * dpr, 4 * dpr])
  c.beginPath()
  c.moveTo(css(0), css(1))
  c.lineTo(css(1), css(0))
  c.stroke()
  c.setLineDash([])

  // 曲线（单调三次样条，与导出渲染同一实现）
  const pts = ptsFromProp()
  c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffa72f'
  c.lineWidth = 2 * dpr
  c.lineJoin = 'round'
  c.beginPath()
  const lut = sampleSpline(pts, 64)
  for (let i = 0; i < lut.length; i++) {
    const x = css(i / (lut.length - 1))
    const y = css(1 - lut[i])
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.stroke()

  // 控制点
  const styles = getComputedStyle(document.documentElement)
  c.fillStyle = styles.getPropertyValue('--text').trim() || '#f0ede8'
  for (const p of pts) {
    c.beginPath()
    c.arc(css(p.x), css(1 - p.y), 4.5 * dpr, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = styles.getPropertyValue('--surface-solid').trim() || '#201d1a'
    c.lineWidth = 1.5 * dpr
    c.stroke()
  }
}

/** 与 core/adjust 的样条一致的轻量采样（仅画曲线用）。 */
function sampleSpline(pts: Pt[], n: number): number[] {
  const out: number[] = []
  const dx: number[] = []
  const sl: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6)
    sl.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1e-6))
  }
  const m: number[] = new Array(pts.length)
  m[0] = sl[0]
  m[pts.length - 1] = sl[sl.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    m[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2
  }
  let seg = 0
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1)
    while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++
    const h = dx[seg]
    const t = (x - pts[seg].x) / h
    const t2 = t * t
    const t3 = t2 * t
    const y =
      (2 * t3 - 3 * t2 + 1) * pts[seg].y +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * pts[seg + 1].y +
      (t3 - t2) * h * m[seg + 1]
    out.push(Math.min(1, Math.max(0, y)))
  }
  return out
}

function toLocal(e: PointerEvent): Pt {
  const rect = cv.value!.getBoundingClientRect()
  // 与绘制共用同一内边距坐标：只有内缩区域映射到 [0,1]，指针落在哪圆点就在哪
  const inner = Math.max(1, rect.width - PAD * 2)
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left - PAD) / inner)),
    y: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top - PAD) / inner)),
  }
}

function hit(p: Pt): number {
  const pts = ptsFromProp()
  const rect = cv.value?.getBoundingClientRect()
  // 命中半径用像素距离，横纵手感一致
  const inner = Math.max(1, (rect?.width ?? 300) - PAD * 2)
  const toPx = (v: number): number => v * inner + PAD
  let best = -1
  let bestD = 12
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(toPx(pts[i]!.x) - toPx(p.x), toPx(pts[i]!.y) - toPx(p.y))
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function emitPts(pts: Pt[]): void {
  const clean = pts
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }))
  const flat: number[] = []
  for (const p of clean) flat.push(p.x, p.y)
  const identity =
    flat.length === 4 && flat[0] === 0 && flat[1] === 0 && flat[2] === 1 && flat[3] === 1
  emit('update:modelValue', identity ? undefined : flat)
}

function onDown(e: PointerEvent): void {
  const p = toLocal(e)
  const i = hit(p)
  const pts = ptsFromProp()
  if (i >= 0) {
    dragging = i
  } else {
    const np = { x: p.x, y: p.y }
    let at = pts.findIndex((q) => q.x > np.x)
    if (at < 0) at = pts.length
    pts.splice(at, 0, np)
    dragging = at
    emitPts(pts)
  }
  cv.value?.setPointerCapture(e.pointerId)
  draw()
}

function onMove(e: PointerEvent): void {
  if (dragging < 0) return
  const pts = ptsFromProp()
  const p = toLocal(e)
  const i = dragging
  const first = i === 0
  const last = i === pts.length - 1
  pts[i] = {
    x: first ? 0 : last ? 1 : Math.min(pts[i + 1]?.x ?? 1 - 0.01, Math.max(pts[i - 1]?.x ?? 0.01, p.x)),
    y: p.y,
  }
  emitPts(pts)
  draw()
}

function onUp(): void {
  dragging = -1
}

function onDbl(e: MouseEvent): void {
  const rect = cv.value!.getBoundingClientRect()
  const inner = Math.max(1, rect.width - PAD * 2)
  const p = {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left - PAD) / inner)),
    y: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top - PAD) / inner)),
  }
  const pts = ptsFromProp()
  const i = hit(p)
  if (i > 0 && i < pts.length - 1) {
    pts.splice(i, 1)
    emitPts(pts)
    draw()
  }
}

function reset(): void {
  emit('update:modelValue', undefined)
}

watch(() => props.modelValue, () => draw())

let ro: ResizeObserver | null = null
onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (cv.value) ro.observe(cv.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div class="curve">
    <div class="head">
      <span class="label">曲线</span>
      <span class="flex" />
      <button class="reset" title="复位曲线" @click="reset"><RotateCcw :size="12" /></button>
    </div>
    <canvas
      ref="cv"
      class="board"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="onDbl"
    />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.label {
  font-size: 12px;
  color: var(--text-2);
}
.hint {
  font-size: 11px;
  color: var(--text-3);
}
.flex {
  flex: 1;
}
.reset {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.reset:hover {
  color: var(--text);
  background: var(--active);
}
.board {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  height: auto;
  border-radius: var(--r-m);
  background: var(--bg);
  border: 1px solid var(--line);
  touch-action: none;
  cursor: crosshair;
}
</style>
