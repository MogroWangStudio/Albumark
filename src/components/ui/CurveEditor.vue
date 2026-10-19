<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import { curvePoints } from '@/core/adjust'
import { CURVE_CHANNELS, isCurveNeutral, type CurveChannel, type Curves } from '@/types/adjust'
import AppSegment from '@/components/ui/AppSegment.vue'

/**
 * 曲线编辑器：合成通道 + R/G/B 三个单通道，0–1 归一化控制点。
 * 端点 x 固定在 0/1、y 可动；拖动 1:1 跟手（按下即响应），空白处加点，双击内部点删除。
 * 非当前通道以低透明度一并画出，便于对照三条通道的相对位置。
 */
const props = defineProps<{ modelValue?: Curves }>()
const emit = defineEmits<{ 'update:modelValue': [value: Curves | undefined] }>()

const cv = ref<HTMLCanvasElement | null>(null)
/** 曲线区四周的内边距（CSS px），绘制与指针映射共用同一坐标系 */
const PAD = 10

const channel = ref<CurveChannel>('rgb')

/** 单通道沿用摄影软件的颜色约定；合成通道用主题强调色（随主题切换） */
const CHANNEL_HEX: Record<CurveChannel, string> = {
  rgb: '#ffa72f',
  r: '#e5484d',
  g: '#46a758',
  b: '#3e63dd',
}

interface Pt {
  x: number
  y: number
}

/** 某通道的控制点；空通道按恒等对角线处理 */
function ptsOf(ch: CurveChannel): Pt[] {
  const p = curvePoints(props.modelValue?.[ch])
  if (p.length < 2) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
  }
  return p
}

const activePts = computed(() => ptsOf(channel.value))
/** 复位按钮只针对当前通道：别的通道有调整不代表这一条能复位 */
const channelDirty = computed(() => !isCurveNeutral(props.modelValue?.[channel.value]))

let dragging = -1
let ctx: CanvasRenderingContext2D | null = null

function draw(): void {
  const canvas = cv.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
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

  // 主题色一次读取：拖动时 draw 每帧都跑，逐次 getComputedStyle 不划算
  const root = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string =>
    root.getPropertyValue(name).trim() || fallback
  const accent = read('--accent', CHANNEL_HEX.rgb)
  const colorOf = (ch: CurveChannel): string => (ch === 'rgb' ? accent : CHANNEL_HEX[ch])

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

  // 非当前通道：细线、低透明度，只作参照
  for (const ch of CURVE_CHANNELS) {
    if (ch.value === channel.value) continue
    if (isCurveNeutral(props.modelValue?.[ch.value])) continue
    c.globalAlpha = 0.28
    c.strokeStyle = colorOf(ch.value)
    c.lineWidth = 1 * dpr
    strokeCurve(c, ptsOf(ch.value), css)
    c.globalAlpha = 1
  }

  // 当前通道
  c.strokeStyle = colorOf(channel.value)
  c.lineWidth = 2 * dpr
  c.lineJoin = 'round'
  strokeCurve(c, activePts.value, css)

  // 控制点
  c.fillStyle = read('--text', '#f0ede8')
  for (const p of activePts.value) {
    c.beginPath()
    c.arc(css(p.x), css(1 - p.y), 4.5 * dpr, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = read('--surface-solid', '#201d1a')
    c.lineWidth = 1.5 * dpr
    c.stroke()
  }
}

function strokeCurve(c: CanvasRenderingContext2D, pts: Pt[], css: (v: number) => number): void {
  const lut = sampleSpline(pts, 64)
  c.beginPath()
  for (let i = 0; i < lut.length; i++) {
    const x = css(i / (lut.length - 1))
    const y = css(1 - lut[i])
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.stroke()
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
  const inner = Math.max(1, rect.width - PAD * 2)
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left - PAD) / inner)),
    y: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top - PAD) / inner)),
  }
}

function hit(p: Pt): number {
  const pts = activePts.value
  const rect = cv.value?.getBoundingClientRect()
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

/** 写回当前通道；四条全部恒等时整体置空，和「未调整」同一语义 */
function emitPts(pts: Pt[]): void {
  const clean = pts
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }))
  const flat: number[] = []
  for (const p of clean) flat.push(p.x, p.y)
  const identity =
    flat.length === 4 && flat[0] === 0 && flat[1] === 0 && flat[2] === 1 && flat[3] === 1
  const next: Curves = { ...(props.modelValue ?? {}) }
  if (identity) delete next[channel.value]
  else next[channel.value] = flat
  const empty = CURVE_CHANNELS.every((c) => isCurveNeutral(next[c.value]))
  emit('update:modelValue', empty ? undefined : next)
}

function onDown(e: PointerEvent): void {
  const p = toLocal(e)
  const i = hit(p)
  const pts = activePts.value.slice()
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
  const pts = activePts.value.slice()
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
  const pts = activePts.value.slice()
  const i = hit(p)
  if (i > 0 && i < pts.length - 1) {
    pts.splice(i, 1)
    emitPts(pts)
    draw()
  }
}

/** 只复位当前通道：单通道拉坏了不必连累另外三条 */
function resetChannel(): void {
  const next: Curves = { ...(props.modelValue ?? {}) }
  delete next[channel.value]
  const empty = CURVE_CHANNELS.every((c) => isCurveNeutral(next[c.value]))
  emit('update:modelValue', empty ? undefined : next)
}

const channelName = computed(() => CURVE_CHANNELS.find((c) => c.value === channel.value)?.hint ?? '')

watch(() => props.modelValue, () => draw(), { deep: true })
watch(channel, () => draw())

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
      <button
        class="reset"
        :class="{ off: !channelDirty }"
        :title="`复位${channelName}曲线`"
        @click="resetChannel"
      >
        <RotateCcw :size="12" />
      </button>
    </div>
    <AppSegment
      :model-value="channel"
      small
      :options="CURVE_CHANNELS"
      class="tabs"
      @update:model-value="channel = $event as CurveChannel"
    />
    <canvas
      ref="cv"
      class="board"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="onDbl"
    />
    <p class="hint">拖动控制点 · 空白处按下加点 · 双击删点</p>
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
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
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
.reset.off {
  opacity: 0.35;
  pointer-events: none;
}
.tabs {
  display: flex;
  margin-bottom: 6px;
}
.tabs :deep(button) {
  flex: 1;
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
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
.hint {
  margin: 5px 0 0;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.4;
}
/* 窄屏（安卓底部抽屉）：正方形曲线画布是调节页最大的纵向占用者，
   缩小并居中，给下方的 HSL / 晕影 / 降噪让出空间 */
@media (max-width: 900px) {
  .board {
    width: min(100%, 200px);
    margin-inline: auto;
  }
}
</style>
