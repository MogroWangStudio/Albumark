<script setup lang="ts">
defineProps<{
  options: { value: string; label: string; disabled?: boolean }[]
  modelValue: string
  small?: boolean
  /** 选项较多时允许换行：每项等宽分摊一行，窄屏不横向溢出 */
  wrap?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="seg" :class="{ small, wrap }">
    <button
      v-for="o in options"
      :key="o.value"
      :class="{ on: o.value === modelValue }"
      :disabled="o.disabled"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--hover);
}
.seg.small button {
  height: calc(24px * var(--ui-zoom, 1));
  padding: 0 9px;
  font-size: calc(12px * var(--ui-zoom, 1));
}
/* 选项多到一行放不下时换行，每项等宽分摊，窄屏也不横向溢出 */
.seg.wrap {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
}
.seg.wrap button {
  flex: 1 1 auto;
  min-width: calc(52px * var(--ui-zoom, 1));
}
button {
  height: calc(26px * var(--ui-zoom, 1));
  padding: 0 12px;
  border-radius: 6px;
  font-size: calc(12.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    transform 90ms ease-out;
}
/* 按下即反馈：不等松手，点下去就有回应 */
button:active:not(:disabled) {
  transform: scale(0.96);
}
button:hover:not(:disabled):not(.on) {
  color: var(--text);
}
button.on {
  background: var(--raised);
  color: var(--text);
}
button:disabled {
  opacity: 0.4;
}
</style>
