<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Images } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import type { ImageItem } from '@/types/image'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  /** 全部照片（按当前项目顺序） */
  items: ImageItem[]
  /** 打开时带入的已选集合（在当前导出自选基础上继续圈选） */
  initial: Set<string>
}>()

const emit = defineEmits<{
  close: []
  apply: [ids: Set<string>]
}>()

/** 弹窗内的工作副本：确认才应用回导出范围，取消不动原集合 */
const sel = ref(new Set<string>())
watch(
  () => props.open,
  (v) => {
    if (v) sel.value = new Set(props.initial)
  },
  { immediate: true },
)

function toggle(id: string): void {
  const next = new Set(sel.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  sel.value = next
}

/** shift 连续选择锚点：上一次点击的序号；范围选择（含两端）替换选中集 */
let anchorIndex = -1
function onCellClick(it: ImageItem, e: MouseEvent, index: number): void {
  if (e.shiftKey && anchorIndex >= 0) {
    const [from, to] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex]
    sel.value = new Set(props.items.slice(from, to + 1).map((p) => p.id))
  } else {
    toggle(it.id)
  }
  anchorIndex = index
}

/* ---------- 框选：空白处按下拖动，矩形相交的照片并入选中 ---------- */

const gridEl = ref<HTMLElement | null>(null)
const rubber = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

function rubberRect(): { left: number; top: number; width: number; height: number } | null {
  const r = rubber.value
  if (!r) return null
  return {
    left: Math.min(r.x1, r.x2),
    top: Math.min(r.y1, r.y2),
    width: Math.abs(r.x2 - r.x1),
    height: Math.abs(r.y2 - r.y1),
  }
}

const rubberStyle = computed(() => {
  const r = rubberRect()
  if (!r) return undefined
  return { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }
})

function onGridDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const t = e.target as HTMLElement | null
  // 缩略图与按钮上的按下是点击/勾选，不是框选起点
  if (t?.closest('.pick-cell, button')) return
  const host = gridEl.value
  if (!host) return
  const box = host.getBoundingClientRect()
  const x1 = e.clientX - box.left
  const y1 = e.clientY - box.top
  rubber.value = { x1, y1, x2: x1, y2: y1 }
  const base = new Set(sel.value)
  const move = (ev: PointerEvent): void => {
    rubber.value = { x1, y1, x2: ev.clientX - box.left, y2: ev.clientY - box.top }
    const r = rubberRect()
    if (!r) return
    const next = new Set(base)
    for (const el of host.querySelectorAll<HTMLElement>('[data-pick-id]')) {
      const b = el.getBoundingClientRect()
      if (
        b.left < box.left + r.left + r.width &&
        b.right > box.left + r.left &&
        b.top < box.top + r.top + r.height &&
        b.bottom > box.top + r.top
      ) {
        next.add(el.dataset.pickId!)
      }
    }
    sel.value = next
  }
  const up = (): void => {
    rubber.value = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const selectedCount = computed(() => sel.value.size)

function apply(): void {
  emit('apply', sel.value)
}
</script>

<template>
  <AppDialog :open="open" :title="t('框选要导出的照片')" :width="720" @close="emit('close')">
    <p class="lead">{{ t('拖框批量选择，或按住 Shift 点击首尾连续选段；单张点击切换勾选。') }}</p>
    <div ref="gridEl" class="pick-grid" @pointerdown="onGridDown">
      <button
        v-for="(it, i) in items"
        :key="it.id"
        class="pick-cell"
        :class="{ on: sel.has(it.id) }"
        :data-pick-id="it.id"
        :title="it.baseName || it.name"
        @click="onCellClick(it, $event, i)"
      >
        <img v-if="it.thumbUrl" :src="it.thumbUrl" alt="" />
        <span v-else class="no-thumb"><Images :size="18" /></span>
        <span class="tick"><Check :size="13" /></span>
        <span class="idx">{{ i + 1 }}</span>
      </button>
      <div v-if="rubberStyle" class="rubber" :style="rubberStyle" aria-hidden="true"></div>
    </div>
    <div class="actions">
      <span class="count">{{ t('已选 {0} / {1}', selectedCount, items.length) }}</span>
      <AppButton size="sm" variant="ghost" @click="emit('close')">{{ t('取消') }}</AppButton>
      <AppButton size="sm" variant="primary" :disabled="!selectedCount" @click="apply">
        {{ t('确定') }}
      </AppButton>
    </div>
  </AppDialog>
</template>

<style scoped>
.lead {
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  margin-bottom: 12px;
}
/* 弹窗网格：导出面板自选网格同一套形制，尺寸放大适配大窗 */
.pick-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
  max-height: 52vh;
  overflow-y: auto;
  padding: 4px;
  /* 吃掉网格内空白处按下时的事件穿透，框选从这里起步 */
  user-select: none;
}
.pick-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--r-s);
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--hover);
  padding: 0;
  cursor: pointer;
  transition: border-color var(--dur-hover) var(--ease-soft);
}
.pick-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pick-cell.on {
  border-color: var(--accent);
}
.no-thumb {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.tick {
  position: absolute;
  right: 4px;
  top: 4px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  /* deslop-ignore-next-line 19 —— 勾选徽标取圆形：多选控件的通用语言，与导出面板勾选徽标一致 */
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: color-mix(in srgb, var(--surface-solid) 70%, transparent);
  color: transparent;
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft),
    border-color var(--dur-hover) var(--ease-soft);
}
.pick-cell.on .tick {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.idx {
  position: absolute;
  left: 4px;
  top: 4px;
  font-size: calc(10px * var(--ui-zoom, 1));
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface-solid) 70%, transparent);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.rubber {
  position: absolute;
  z-index: 5;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 3px;
  pointer-events: none;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.count {
  margin-right: auto;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
</style>
