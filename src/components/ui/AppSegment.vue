<script setup lang="ts">
defineProps<{
  options: { value: string; label: string; disabled?: boolean }[]
  modelValue: string
  small?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="seg" :class="{ small }">
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
button {
  height: calc(26px * var(--ui-zoom, 1));
  padding: 0 12px;
  border-radius: 6px;
  font-size: calc(12.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft);
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
