<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  options: { value: string; label: string; icon?: Component }[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="o in options"
      :key="o.value"
      role="tab"
      :aria-selected="o.value === modelValue"
      :class="{ on: o.value === modelValue }"
      @click="emit('update:modelValue', o.value)"
    >
      <component :is="o.icon" v-if="o.icon" :size="14" />
      <span>{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 4px;
  border-radius: 999px;
  background: var(--hover);
  border: 1px solid var(--line);
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text-3);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    box-shadow var(--dur-hover) var(--ease-soft);
}
button:hover:not(.on) {
  color: var(--text);
}
/* 选中项用主题色强调：柔色底 + 主题色文字，不加新色相 */
button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}
</style>
