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
  height: 24px;
  padding: 0 9px;
  font-size: 12px;
}
button {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text-2);
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
button:hover:not(:disabled):not(.on) {
  color: var(--text);
}
button.on {
  background: var(--raised);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
button:disabled {
  opacity: 0.4;
}
</style>
