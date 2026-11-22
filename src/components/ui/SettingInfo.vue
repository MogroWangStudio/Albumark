<script setup lang="ts">
import { ref } from 'vue'
import { Info } from 'lucide-vue-next'

defineProps<{
  /** 悬停 / 点开时展示的说明文字 */
  tip: string
}>()

/** 触屏没有悬停：点击切换兜底；桌面以悬停为主 */
const open = ref(false)
</script>

<template>
  <span class="si" :class="{ open }">
    <button
      class="si-btn"
      type="button"
      aria-label="查看说明"
      @click.stop="open = !open"
      @blur="open = false"
    >
      <Info :size="13" />
    </button>
    <span class="si-tip" role="tooltip">{{ tip }}</span>
  </span>
</template>

<style scoped>
.si {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  vertical-align: middle;
}
.si-btn {
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-3);
  cursor: help;
  /* 图标平时隐藏，悬停所在设置项时才浮现，不占额外视觉噪音 */
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
/* 所在 .row 悬停 / 键盘聚焦 / 触屏展开时浮现 */
:global(.row:hover) .si-btn,
:global(.row:focus-within) .si-btn,
.si:hover .si-btn,
.si.open .si-btn {
  opacity: 1;
}
.si-btn:hover {
  color: var(--text-2);
}
.si-tip {
  position: absolute;
  top: calc(100% + 6px);
  left: -8px;
  z-index: 20;
  width: max-content;
  max-width: 280px;
  padding: 8px 11px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  background: var(--surface-solid);
  box-shadow: var(--shadow-2);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  line-height: 1.6;
  color: var(--text-2);
  text-align: left;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-2px);
  transition:
    opacity var(--dur-hover) var(--ease-soft),
    transform var(--dur-hover) var(--ease-soft),
    visibility var(--dur-hover);
  pointer-events: none;
}
.si:hover .si-tip,
.si.open .si-tip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  /* 悬停期间允许指针滑进气泡内阅读，气泡不会消失 */
  pointer-events: auto;
}
/* 触屏无悬停：图标常显，靠点击切换说明 */
@media (pointer: coarse) {
  .si-btn {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .si-tip {
    transition: none;
  }
}
</style>
