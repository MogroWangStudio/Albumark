<script setup lang="ts">
import { ref } from 'vue'
import { Info } from 'lucide-vue-next'
import { useI18n } from '@/i18n'

defineProps<{
  /** 悬停 / 点开时展示的说明文字 */
  tip: string
}>()

const { t } = useI18n()

/** 触屏没有悬停：点击切换兜底；桌面以悬停为主 */
const open = ref(false)
</script>

<template>
  <span class="si" :class="{ open }">
    <button
      class="si-btn"
      type="button"
      :aria-label="t('查看说明')"
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
  /* 说明入口默认可见：它是设置项的一部分，不靠悬停才“长出来” */
  opacity: 1;
  transition: color var(--dur-hover) var(--ease-soft);
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
/* 触屏与桌面一致：图标常显，点击切换说明；桌面另有悬停气泡 */
@media (prefers-reduced-motion: reduce) {
  .si-tip {
    transition: none;
  }
}
</style>
