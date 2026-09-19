<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface DropdownItem {
  label: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

const props = withDefaults(
  defineProps<{
    items: DropdownItem[]
    align?: 'left' | 'right'
  }>(),
  { align: 'left' },
)

const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0 })

async function place(): Promise<void> {
  await nextTick()
  const el = trigger.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const menuWidth = 208
  const left = props.align === 'right' ? r.right - menuWidth : r.left
  pos.value = {
    top: r.bottom + 6,
    left: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8)),
  }
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) await place()
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as HTMLElement | null
  if (!t) return
  if (trigger.value?.contains(t)) return
  if (t.closest('.dropdown-menu')) return
  open.value = false
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

function onReposition(): void {
  if (open.value) void place()
}

watch(open, (v) => {
  if (v) {
    document.addEventListener('click', onDocClick, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
  } else {
    document.removeEventListener('click', onDocClick, true)
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onReposition)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onReposition)
})

function pick(item: DropdownItem): void {
  open.value = false
  item.action()
}
</script>

<template>
  <div class="dd">
    <button ref="trigger" class="dd-trigger" @click.stop="toggle">
      <slot name="trigger" />
    </button>
    <Teleport to="body">
      <Transition name="dd">
        <div
          v-if="open"
          class="dropdown-menu"
          :class="align"
          :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
        >
          <button
            v-for="item in items"
            :key="item.label"
            class="dd-item"
            :class="{ danger: item.danger }"
            :disabled="item.disabled"
            @click="pick(item)"
          >
            {{ item.label }}
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
}
.dd-trigger {
  display: inline-flex;
}
.dropdown-menu {
  position: fixed;
  z-index: 80;
  min-width: 208px;
  padding: 5px;
  background: var(--surface-solid);
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
}
.dropdown-menu.left {
  transform-origin: top left;
}
.dropdown-menu.right {
  transform-origin: top right;
}
.dd-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  text-align: left;
  font-size: 13px;
  transition: background var(--dur-hover) var(--ease-soft);
}
.dd-item:hover:not(:disabled) {
  background: var(--hover);
}
.dd-item.danger {
  color: var(--danger);
}
.dd-item:disabled {
  opacity: 0.4;
}

.dd-enter-active,
.dd-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}
.dd-enter-from,
.dd-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
