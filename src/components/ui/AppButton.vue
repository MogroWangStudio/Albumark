<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    disabled?: boolean
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', disabled: false },
)
</script>

<template>
  <button :type="type" class="btn" :class="[variant, size]" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--control-h);
  padding: 0 14px;
  border-radius: 8px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    transform var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.btn:active:not(:disabled) {
  transform: scale(0.97);
}
.btn:disabled {
  opacity: 0.45;
}
.btn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 7px;
}
.btn.primary {
  background: var(--accent);
  color: var(--accent-contrast);
  box-shadow: var(--shadow-1);
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent-strong);
}
.btn.secondary {
  background: var(--raised);
  border: 1px solid var(--line);
}
.btn.secondary:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.btn.ghost {
  color: var(--text-2);
}
.btn.ghost:hover:not(:disabled) {
  color: var(--text);
  background: var(--hover);
}
.btn.danger {
  color: var(--danger);
}
.btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
</style>
