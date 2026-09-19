<script setup lang="ts">
import { computed } from 'vue'
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
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
  reset: []
}>()

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
</script>

<template>
  <div class="field" :class="{ disabled }">
    <div class="head" :title="title" @dblclick="emit('reset')">
      <span v-if="icon" class="icon"><component :is="icon" :size="14" /></span>
      <label>{{ label }}</label>
      <span class="val">{{ display }}</span>
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :style="fillStyle"
      @input="onInput"
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
  background: linear-gradient(to bottom, #ffffff, #eceae6);
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
input[type='range']:active::-webkit-slider-thumb {
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
  background: linear-gradient(to bottom, #ffffff, #eceae6);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  transition: transform var(--dur-hover) var(--ease-soft);
}
input[type='range']:active::-moz-range-thumb {
  transform: scale(1.22);
}
</style>
