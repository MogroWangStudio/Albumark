<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { ref } from 'vue'

export interface ContextMenuItem {
  label: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

const props = defineProps<{ state: ContextMenuState | null }>()
const emit = defineEmits<{ close: [] }>()

const pos = ref({ top: 0, left: 0 })
const el = ref<HTMLElement | null>(null)

/** 菜单在指针处弹出，靠近边缘时向内收；展开后测量实际高度防止下方溢出 */
async function place(): Promise<void> {
  await nextTick()
  const s = props.state
  if (!s) return
  const w = el.value?.offsetWidth ?? 200
  const h = el.value?.offsetHeight ?? 40
  const left = Math.min(s.x, window.innerWidth - w - 8)
  const top = s.y + h + 8 > window.innerHeight ? s.y - h - 6 : s.y + 4
  pos.value = { top: Math.max(8, top), left: Math.max(8, left) }
}

function onDocPointer(e: Event): void {
  if (!props.state) return
  if (e.target instanceof Node && el.value?.contains(e.target)) return
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

function onScroll(): void {
  if (props.state) emit('close')
}

watch(
  () => props.state,
  (v) => {
    document.removeEventListener('pointerdown', onDocPointer, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onScroll)
    window.removeEventListener('wheel', onScroll)
    if (v) {
      void place()
      document.addEventListener('pointerdown', onDocPointer, true)
      document.addEventListener('keydown', onKey, true)
      window.addEventListener('resize', onScroll)
      window.addEventListener('wheel', onScroll)
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', onScroll)
  window.removeEventListener('wheel', onScroll)
})

function pick(item: ContextMenuItem): void {
  emit('close')
  item.action()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx">
      <div
        v-if="state"
        ref="el"
        class="ctx-menu"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
        @contextmenu.prevent.stop
      >
        <button
          v-for="item in state.items"
          :key="item.label"
          class="ctx-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click="pick(item)"
        >
          {{ item.label }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 95;
  min-width: 190px;
  padding: 5px;
  background: var(--surface-solid);
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
  transform-origin: top left;
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  text-align: left;
  font-size: 13px;
  transition: background var(--dur-hover) var(--ease-soft);
}
.ctx-item:hover:not(:disabled) {
  background: var(--hover);
}
.ctx-item.danger {
  color: var(--danger);
}
.ctx-item:disabled {
  opacity: 0.4;
}

.ctx-enter-active,
.ctx-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.ctx-enter-from,
.ctx-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
