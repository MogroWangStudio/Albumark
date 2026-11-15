<script setup lang="ts">
import { Minus, Square, X } from 'lucide-vue-next'
import { useWindowControls } from '@/core/windowControls'

/** 自绘窗控三键（最小化 / 最大化 / 关闭）：只在 Windows/Linux 桌面显示，
 *  macOS 由系统红绿灯接管。样式与主顶栏同一套 hover 语义。 */
const { visible, minimize, toggleMaximize, close } = useWindowControls()
</script>

<template>
  <div v-if="visible" class="win-controls">
    <button class="win-btn" aria-label="最小化" @click="minimize"><Minus :size="14" /></button>
    <button class="win-btn" aria-label="最大化/还原" @click="toggleMaximize"><Square :size="11" /></button>
    <button class="win-btn close" aria-label="关闭" @click="close"><X :size="14" /></button>
  </div>
</template>

<style scoped>
.win-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  /* 顶栏/设置页头部都是窗口拖拽区，窗控必须退出拖拽才能点击 */
  -webkit-app-region: no-drag;
}
.win-btn {
  width: 30px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--text-3);
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.win-btn:hover {
  background: var(--active);
  color: var(--text);
}
.win-btn.close:hover {
  background: var(--danger);
  color: #fff;
}
</style>
