<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOpen, ImagePlus, Minus, Settings, Square, X } from 'lucide-vue-next'
import LogoText from '@/components/brand/LogoText.vue'
import { isTauri } from '@/core/platform'
import { useWorkspaceStore } from '@/stores/workspace'

const emit = defineEmits<{
  openWorkspace: []
  import: []
  settings: []
}>()

const ws = useWorkspaceStore()
const pressed = ref(false)

// 药丸集合组里的三个控件：工作区 / 导入 / 设置
const canImport = computed(() => ws.inProject)
let win: { minimize(): void; toggleMaximize(): void; close(): void } | null = null

if (isTauri) {
  void import('@tauri-apps/api/window').then((m) => {
    win = m.getCurrentWindow()
  })
}

async function onMinimize(): Promise<void> {
  await win?.minimize()
}
async function onMaximize(): Promise<void> {
  await win?.toggleMaximize()
}
function onClose(): void {
  win?.close()
}
</script>

<template>
  <header class="titlebar material" data-tauri-drag-region>
    <div class="left" data-tauri-drag-region>
      <button
        class="logo-btn"
        :class="{ pressed }"
        aria-label="辑印 Albumark"
        @pointerdown="pressed = true"
        @pointerup="pressed = false"
        @pointerleave="pressed = false"
      >
        <LogoText class="logo" />
      </button>
      <button
        v-if="ws.inProject || ws.dir"
        class="ws-chip"
        :title="ws.current?.path || ws.dir?.path || '本次会话'"
        @click="emit('openWorkspace')"
      >
        <FolderOpen :size="12" />
        <span>{{ ws.current?.name ?? ws.dir?.name ?? '工作区' }}</span>
      </button>
    </div>

    <div class="right">
      <div class="pill" role="toolbar" aria-label="主工具">
        <button class="pill-item" @click="emit('openWorkspace')">
          <FolderOpen :size="15" /><span>工作区</span>
        </button>
        <span class="pill-sep" />
        <button class="pill-item" :disabled="!canImport" :title="canImport ? '导入图片' : '先进入工作区后才能导入'" @click="emit('import')">
          <ImagePlus :size="15" /><span>导入图片</span>
        </button>
        <span class="pill-sep" />
        <button class="pill-item" @click="emit('settings')">
          <Settings :size="15" /><span>设置</span>
        </button>
      </div>

      <div v-if="isTauri" class="win-controls">
        <button class="win-btn" aria-label="最小化" @click="onMinimize"><Minus :size="14" /></button>
        <button class="win-btn" aria-label="最大化/还原" @click="onMaximize"><Square :size="11" /></button>
        <button class="win-btn close" aria-label="关闭" @click="onClose"><X :size="14" /></button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: calc(46px + var(--safe-top));
  padding: var(--safe-top) calc(10px + var(--safe-right)) 0 calc(10px + var(--safe-left));
  flex: none;
  user-select: none;
  /* 无边框窗口的拖拽区：整条标题栏都可拖（按钮落点由子元素自己接管） */
  -webkit-app-region: drag;
}
.left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  align-self: stretch;
}
.pill,
.win-controls,
.logo-btn,
.ws-chip {
  -webkit-app-region: no-drag;
}
.logo-btn {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  /* 非线性反馈：悬停轻微放大（回弹曲线），按下即时缩到 0.95 */
  transition:
    transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
    filter var(--dur-hover) var(--ease-soft);
  transform-origin: left center;
  padding: 3px 4px;
}
.logo-btn:hover {
  transform: scale(1.045);
  filter: brightness(1.1);
}
.logo-btn.pressed {
  transform: scale(0.95);
  transition-duration: 90ms;
  filter: brightness(0.9);
}
.logo {
  height: 18px;
  width: auto;
  display: block;
}
.ws-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 12px;
  max-width: 220px;
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.ws-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-chip:hover {
  background: var(--hover);
  color: var(--text);
}
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 三个控件收进一个药丸形容器 */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 34px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--hover);
  border: 1px solid var(--line);
}
.pill-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text-2);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    transform var(--dur-fast) var(--ease);
}
.pill-item:active:not(:disabled) {
  transform: scale(0.96);
}
.pill-item:hover:not(:disabled) {
  background: var(--active);
  color: var(--text);
}
.pill-item:disabled {
  opacity: 0.4;
}
.pill-sep {
  width: 1px;
  height: 14px;
  background: var(--line-strong);
}
.win-controls {
  display: flex;
  align-items: center;
  gap: 2px;
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
@media (max-width: 640px) {
  .logo {
    height: 15px;
  }
  .pill-item span {
    display: none;
  }
  .pill-item {
    padding: 0 9px;
  }
}
</style>
