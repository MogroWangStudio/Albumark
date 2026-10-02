<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import type { Component } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    label?: string
    icon?: Component
    format?: (v: number) => string
    disabled?: boolean
    title?: string
    /** 归位值：提供后，数值偏离它时显示行内重置按钮 */
    default?: number
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    label: '',
    icon: undefined,
    format: undefined,
    disabled: false,
    title: '双击复位',
    default: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
  reset: []
}>()

/** 值偏离归位值时显示重置按钮；未提供 default 则不显示 */
const showReset = computed(
  () => props.default !== undefined && !props.disabled && Math.abs(props.modelValue - props.default) > 1e-9,
)

const display = computed(() =>
  props.format ? props.format(props.modelValue) : String(props.modelValue),
)

/** 中点归零的滑杆（-100~100）从中间起填充，其余从最小值起填充。 */
const fillStyle = computed(() => {
  const range = props.max - props.min
  const pct = ((props.modelValue - props.min) / range) * 100
  const center = props.min < 0 && props.max > 0 ? ((0 - props.min) / range) * 100 : 0
  const lo = Math.min(pct, center)
  const hi = Math.max(pct, center)
  return { '--lo': `${lo}%`, '--hi': `${hi}%` }
})

function onInput(e: Event): void {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value))
}

/* ---------- 双击数值：键盘直接输入 ---------- */

const editing = ref(false)
const editVal = ref('')
const editEl = ref<HTMLInputElement | null>(null)

function startEdit(): void {
  if (props.disabled) return
  editVal.value = String(props.modelValue)
  editing.value = true
}

watch(editing, async (v) => {
  if (!v) return
  await nextTick()
  editEl.value?.focus()
  editEl.value?.select()
})

function commitEdit(): void {
  if (!editing.value) return
  editing.value = false
  const n = Number(editVal.value.trim().replace(/[^\d.+-eE]/g, ''))
  if (!Number.isFinite(n)) return
  let v = Math.min(props.max, Math.max(props.min, n))
  if (props.step > 0) {
    v = Math.round((v - props.min) / props.step) * props.step + props.min
    v = Number(v.toFixed(4))
  }
  emit('update:modelValue', v)
}

function onEditKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') commitEdit()
  else if (e.key === 'Escape') editing.value = false
}

/* ---------- 按住数值横向拖动：细微调整 ---------- */

const SCRUB_RANGE = 300

const scrubbing = ref(false)
let scrub: { startX: number; startVal: number; active: boolean } | null = null

/** 拖满 SCRUB_RANGE px 走完整个范围，比轨道宽度更缓，便于细调；按 step 取整 */
function applyScrub(dx: number): void {
  if (!scrub) return
  let v = scrub.startVal + (dx / SCRUB_RANGE) * (props.max - props.min)
  v = Math.min(props.max, Math.max(props.min, v))
  if (props.step > 0) {
    v = Math.round((v - props.min) / props.step) * props.step + props.min
    v = Number(v.toFixed(4))
  }
  if (v !== props.modelValue) emit('update:modelValue', v)
}

function onValDown(e: PointerEvent): void {
  if (props.disabled || e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  scrub = { startX: e.clientX, startVal: props.modelValue, active: false }
}

function onValMove(e: PointerEvent): void {
  const s = scrub
  if (!s) return
  const dx = e.clientX - s.startX
  // 约 2px 的滞回：确认拖动意图后才起效，单击/双击键入不受影响
  if (!s.active) {
    if (Math.abs(dx) < 2) return
    s.active = true
    scrubbing.value = true
  }
  applyScrub(dx)
}

function onValUp(e: PointerEvent): void {
  if (!scrub) return
  const tapped = !scrub.active
  scrub = null
  scrubbing.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  // 触屏点按数字：直接进入键入（桌面仍为双击键入）
  if (tapped && e.type === 'pointerup' && e.pointerType === 'touch') startEdit()
}

/* ---------- 触屏轨道：可拖不可点 ----------
   拦掉原生「按下即跳值」，值只能由拖动改变：
   - 按在拇指上：从当前值 1:1 跟手（尊重抓取偏移，不跳变）
   - 按在轨道其他位置拖动：拇指吸附到手指位置跟随（先移动才吸附，轻点不跳）
   - 轻点（无位移）：什么都不发生
   鼠标不拦截，桌面点按跳值的习惯保持不变；轨道 touch-action: pan-y，
   手指纵向滑动仍可滚动面板（滚动启动会派发 pointercancel，拖动安全中断） */
const TRACK_HOTSPOT = 26 // 拇指（22px）外的抓取余量

const trackActive = ref(false)
let track: {
  startX: number
  startVal: number
  grabbed: boolean
  active: boolean
  rect: DOMRect
  /** 轨道 content box 左缘内缩（触屏样式 padding-inline，非触屏为 0） */
  pad: number
} | null = null

/** 手指位置映射到值（轨道 content box 内线性插值） */
function valueAt(clientX: number, t: { rect: DOMRect; pad: number }): number {
  const inner = Math.max(1, t.rect.width - t.pad * 2)
  const frac = Math.min(1, Math.max(0, (clientX - t.rect.left - t.pad) / inner))
  return props.min + frac * (props.max - props.min)
}

function quantize(v: number): number {
  let n = Math.min(props.max, Math.max(props.min, v))
  if (props.step > 0) {
    n = Math.round((n - props.min) / props.step) * props.step + props.min
    n = Number(n.toFixed(4))
  }
  return n
}

function onTrackDown(e: PointerEvent): void {
  if (e.pointerType !== 'touch' || props.disabled) return
  e.preventDefault()
  const el = e.currentTarget as HTMLInputElement
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    /* 指针已失效时捕获失败：拖动在指针停留时仍可跟随 */
  }
  const rect = el.getBoundingClientRect()
  const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
  const frac = (props.modelValue - props.min) / (props.max - props.min || 1)
  const thumbX = rect.left + pad + frac * (rect.width - pad * 2)
  track = {
    startX: e.clientX,
    startVal: props.modelValue,
    grabbed: Math.abs(e.clientX - thumbX) <= TRACK_HOTSPOT,
    active: false,
    rect,
    pad,
  }
}

function onTrackMove(e: PointerEvent): void {
  const t = track
  if (!t) return
  // 约 6px 的滞回：确认拖动意图才起效，轻点一律不改变值
  if (!t.active) {
    if (Math.abs(e.clientX - t.startX) < 6) return
    t.active = true
    trackActive.value = true
  }
  let v: number
  if (t.grabbed) {
    // 从拇指当前位置按位移连续调整（与轨道等宽的 1:1 灵敏度）
    const inner = Math.max(1, t.rect.width - t.pad * 2)
    v = t.startVal + ((e.clientX - t.startX) / inner) * (props.max - props.min)
  } else {
    v = valueAt(e.clientX, t)
  }
  v = quantize(v)
  if (v !== props.modelValue) emit('update:modelValue', v)
}

function onTrackUp(e: PointerEvent): void {
  if (!track) return
  track = null
  trackActive.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
}
</script>

<template>
  <div class="field" :class="{ disabled }">
    <div class="head" :title="title" @dblclick="emit('reset')">
      <span v-if="icon" class="icon"><component :is="icon" :size="14" /></span>
      <label>{{ label }}</label>
      <button
        v-if="showReset"
        class="mini-reset"
        title="复位此值"
        @click.stop="emit('reset')"
        @dblclick.stop
      >
        <RotateCcw :size="11" />
      </button>
      <input
        v-if="editing"
        ref="editEl"
        v-model="editVal"
        class="val-edit"
        type="text"
        inputmode="decimal"
        spellcheck="false"
        @keydown="onEditKey"
        @blur="commitEdit"
        @dblclick.stop
      />
      <span
        v-else
        class="val"
        :class="{ scrubbing }"
        title="按住拖动微调 · 双击键入"
        @pointerdown="onValDown"
        @pointermove="onValMove"
        @pointerup="onValUp"
        @pointercancel="onValUp"
        @dblclick.stop="startEdit"
      >{{ display }}</span>
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :class="{ dragging: trackActive }"
      :style="fillStyle"
      :aria-label="label || undefined"
      @input="onInput"
      @pointerdown="onTrackDown"
      @pointermove="onTrackMove"
      @pointerup="onTrackUp"
      @pointercancel="onTrackUp"
    />
  </div>
</template>

<style scoped>
.field.disabled {
  opacity: 0.45;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.icon {
  color: var(--text-3);
  display: inline-flex;
}
label {
  color: var(--text-2);
  font-size: 12px;
}
.val {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  cursor: ew-resize;
  padding: 0 2px;
  border-radius: 4px;
  /* 横向拖拽微调；触屏保留纵向滚动手势 */
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.val:hover {
  background: var(--hover);
}
.val.scrubbing {
  background: var(--active);
}
.val-edit {
  margin-left: auto;
  width: 76px;
  height: 20px;
  padding: 0 5px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  text-align: right;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 5px;
  outline: none;
}
.mini-reset {
  margin-left: auto;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.mini-reset + .val {
  margin-left: 0;
}
.mini-reset:hover {
  color: var(--text);
  background: var(--active);
}
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 24px;
  background: transparent;
  cursor: pointer;
  --lo: 0%;
  --hi: 100%;
  /* 触屏：横向给滑块（拖动调值），纵向留给页面滚动 */
  touch-action: pan-y;
}
/* 凹槽轨道 + 实心填充，拇指带描边与悬浮光晕 */
input[type='range']::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background:
    linear-gradient(
      to right,
      var(--line-strong) var(--lo),
      var(--accent) var(--lo),
      var(--accent) var(--hi),
      var(--line-strong) var(--hi)
    )
    var(--track, transparent);
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.18);
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin-top: -6px;
  border-radius: 50%;
  background: #f4f2ee;
  border: 0.5px solid rgba(0, 0, 0, 0.25);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.45),
    0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent);
  transition:
    transform var(--dur-hover) var(--ease-soft),
    box-shadow var(--dur-hover) var(--ease-soft);
}
input[type='range']:hover::-webkit-slider-thumb {
  transform: scale(1.08);
}
input[type='range']:active::-webkit-slider-thumb,
input[type='range'].dragging::-webkit-slider-thumb {
  transform: scale(1.22);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.45),
    0 0 0 6px color-mix(in srgb, var(--accent) 25%, transparent);
}
input[type='range']:focus-visible::-webkit-slider-thumb {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.45),
    0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
}
/* 触屏（安卓）适配：轨道两端留出边距，thumb 与数值热区放大——
   thumb 拖到端点时手指不再顶出面板边缘，滑杆行也更容易命中 */
@media (pointer: coarse) {
  input[type='range'] {
    padding-inline: 10px;
  }
  input[type='range']::-webkit-slider-thumb {
    width: 22px;
    height: 22px;
    margin-top: -8px;
  }
  input[type='range']::-moz-range-thumb {
    width: 22px;
    height: 22px;
  }
  .val {
    padding: 7px 10px;
  }
  .mini-reset {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }
}
input[type='range']::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--line-strong);
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.18);
}
input[type='range']::-moz-range-progress {
  height: 6px;
  border-radius: 3px;
  background: var(--accent);
}
input[type='range']::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: 0.5px solid rgba(0, 0, 0, 0.25);
  border-radius: 50%;
  background: #f4f2ee;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  transition: transform var(--dur-hover) var(--ease-soft);
}
input[type='range']:active::-moz-range-thumb,
input[type='range'].dragging::-moz-range-thumb {
  transform: scale(1.22);
}
</style>
