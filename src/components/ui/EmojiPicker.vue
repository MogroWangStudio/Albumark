<script setup lang="ts">
/** 轻量 emoji 选择器：给工作目录 / 工作项目挑一个显示图标。
 *  固定的常用清单（按近似主题分组），不做搜索——图标是装饰性标识，
 *  扫一眼点一下的成本远低于输入。 */
import AppButton from './AppButton.vue'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ pick: [emoji: string]; clear: [] }>()

const GROUPS: { label: string; items: string[] }[] = [
  {
    label: '摄影与影像',
    // deslop-ignore-next-line 15 —— 本文件是 emoji 选择器，清单是功能数据
    items: ['📷', '📸', '🎞️', '📽️', '🎬', '🖼️', '🏞️', '🌇', '🌆', '🌅', '🌄', '🌃', '🌙', '⭐', '☀️', '🌈'],
  },
  {
    label: '工作与整理',
    // deslop-ignore-next-line 15
    items: ['📁', '📂', '🗂️', '📅', '🗒️', '📎', '📌', '🏷️', '🔖', '📝', '✏️', '💼', '📊', '📈', '🗃️', '📋'],
  },
  {
    label: '人物与生活',
    // deslop-ignore-next-line 15
    items: ['😀', '😎', '🤳', '👋', '🎉', '🎁', '☕', '🍵', '🍰', '🍜', '🚗', '✈️', '🏠', '🍀', '🌸', '🌊'],
  },
  {
    label: '色彩与标记',
    // deslop-ignore-next-line 15
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🔥', '💧', '⚡', '✨', '💫', '🔴', '🟠', '🟢', '🔵'],
  },
]

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const el = e.target as HTMLElement
    if (el.dataset.emoji) emit('pick', el.dataset.emoji)
  }
}
</script>

<template>
  <div class="picker">
    <div v-for="g in GROUPS" :key="g.label" class="group">
      <span class="g-label">{{ g.label }}</span>
      <div class="grid">
        <button
          v-for="e in g.items"
          :key="e"
          class="cell"
          :class="{ on: modelValue === e }"
          :data-emoji="e"
          type="button"
          :title="e"
          @click="emit('pick', e)"
          @keydown="onKey"
        >
          {{ e }}
        </button>
      </div>
    </div>
    <div class="foot">
      <AppButton size="sm" variant="ghost" :disabled="!props.modelValue" @click="emit('clear')">
        清除图标
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.g-label {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  letter-spacing: 0.04em;
}
.grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.cell {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  font-size: calc(18px * var(--ui-zoom, 1));
  border-radius: var(--r-s);
  transition: background var(--dur-hover) var(--ease-soft);
}
.cell:hover {
  background: var(--hover);
}
.cell.on {
  background: var(--hover);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.foot {
  display: flex;
  justify-content: flex-end;
}
</style>
