<script setup lang="ts">
import { CircleAlert, CircleCheck, Info } from 'lucide-vue-next'
import { toasts } from '@/stores/toast'
import type { Toast } from '@/stores/toast'

const icons: Record<Toast['tone'], typeof Info> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
}
</script>

<template>
  <Teleport to="body">
    <div class="toasts" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast material" :class="t.tone">
          <component :is="icons[t.tone]" :size="15" />
          <span>{{ t.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: calc(14px + var(--safe-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  box-shadow: var(--shadow-2);
  font-size: 13px;
}
.toast.info {
  color: var(--text);
}
.toast.info :deep(svg) {
  color: var(--text-2);
}
.toast.success {
  color: var(--ok);
}
.toast.success span {
  color: var(--text);
}
.toast.error {
  color: var(--danger);
}
.toast.error span {
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
