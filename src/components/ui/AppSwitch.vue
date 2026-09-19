<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <button
    class="switch"
    role="switch"
    :aria-checked="modelValue"
    :class="{ on: modelValue }"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 10px;
  background: var(--line-strong);
  transition: background var(--dur-hover) var(--ease-soft);
  flex: none;
}
.switch.on {
  background: var(--accent);
}
.switch:disabled {
  opacity: 0.45;
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: transform var(--dur-hover) var(--ease-soft);
}
.switch.on .knob {
  transform: translateX(14px);
}
</style>
