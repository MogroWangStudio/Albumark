<script setup lang="ts">
import { X } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    width?: number
  }>(),
  { width: 480 },
)

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="overlay" @click.self="emit('close')">
        <div class="panel" :style="{ maxWidth: `${width}px` }">
          <header>
            <h2>{{ title }}</h2>
            <button class="x" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
          </header>
          <div class="body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: calc(24px + var(--safe-top)) calc(24px + var(--safe-right)) calc(24px + var(--safe-bottom))
    calc(24px + var(--safe-left));
  background: rgba(0, 0, 0, 0.45);
}
.panel {
  width: 100%;
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--surface-solid);
  border: 1px solid var(--line);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-3);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
}
h2 {
  font-size: 15px;
}
.x {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--text-3);
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.x:hover {
  background: var(--hover);
  color: var(--text);
}
.body {
  padding: 4px 18px 18px;
  overflow-y: auto;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--dur) var(--ease);
}
.dialog-enter-active .panel,
.dialog-leave-active .panel {
  transition: transform var(--dur) var(--ease);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .panel,
.dialog-leave-to .panel {
  transform: translateY(10px) scale(0.98);
}
</style>
