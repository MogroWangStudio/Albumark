<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Brush,
  FolderOpen,
  ImagePlus,
  Minus,
  Redo2,
  Settings,
  Square,
  Undo2,
  X,
} from 'lucide-vue-next'
import LogoText from '@/components/brand/LogoText.vue'
import { isTauri } from '@/core/platform'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'

const emit = defineEmits<{
  openWorkspace: []
  import: []
  studio: []
  settings: []
}>()

const ws = useWorkspaceStore()
const history = useHistoryStore()
const pressed = ref(false)

/** 快捷键提示按平台显示：macOS 用 ⌘，其余用 Ctrl+ */
const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

const undoTitle = computed(() => {
  if (history.suspended) return '水印工作室的草稿不进入撤销历史'
  return history.canUndo ? `撤销${history.undoLabel}（${mod}Z）` : '没有可撤销的操作'
})
const redoTitle = computed(() => {
  if (history.suspended) return '水印工作室的草稿不进入撤销历史'
  return history.canRedo ? `重做${history.redoLabel}（${mod}⇧Z）` : '没有可重做的操作'
})

// 药丸集合组里的控件：工作区 / 导入 / 水印工作室 / 设置
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
      <!-- 撤销 / 重做：状态由编辑历史决定，禁用时给出原因 -->
      <div class="history" role="group" aria-label="撤销与重做">
        <button
          class="hist"
          :disabled="!history.canUndo || history.suspended"
          :title="undoTitle"
          aria-label="撤销"
          @click="history.undo()"
        >
          <Undo2 :size="15" />
        </button>
        <button
          class="hist"
          :disabled="!history.canRedo || history.suspended"
          :title="redoTitle"
          aria-label="重做"
          @click="history.redo()"
        >
          <Redo2 :size="15" />
        </button>
      </div>

      <div class="pill" role="toolbar" aria-label="主工具">
        <button class="pill-item" @click="emit('openWorkspace')">
          <FolderOpen :size="15" /><span>工作区</span>
        </button>
        <span class="pill-sep" />
        <button class="pill-item" :disabled="!canImport" :title="canImport ? '导入图片' : '先进入工作区后才能导入'" @click="emit('import')">
          <ImagePlus :size="15" /><span>导入图片</span>
        </button>
        <span class="pill-sep" />
        <button class="pill-item" title="水印工作室" @click="emit('studio')">
          <Brush :size="15" /><span>水印工作室</span>
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
.history,
.logo-btn,
.ws-chip {
  -webkit-app-region: no-drag;
}
/* 撤销 / 重做：与主工具同高的胶囊，图标按钮，禁用时压暗但仍可读 */
.history {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 34px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--hover);
  border: 1px solid var(--line);
}
.hist {
  width: 30px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--text-2);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    transform var(--dur-fast) var(--ease);
}
.hist:hover:not(:disabled) {
  background: var(--active);
  color: var(--text);
}
.hist:active:not(:disabled) {
  transform: scale(0.94);
}
.hist:disabled {
  opacity: 0.32;
  cursor: default;
}
.logo-btn {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  /* 悬停轻微放大（无过冲），按下即时缩到 0.95 */
  transition:
    transform 320ms var(--ease-soft),
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
  font-size: calc(12px * var(--ui-zoom, 1));
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
  font-size: calc(12.5px * var(--ui-zoom, 1));
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
  /* 窄屏把撤销组压缩，避免和工具胶囊一起挤爆标题栏 */
  .history {
    height: 30px;
    padding: 0 2px;
  }
  .hist {
    width: 26px;
    height: 24px;
  }
}
@media (max-width: 560px) {
  /* 工作区入口已在工具胶囊里，窄屏省掉重复的项目名胶囊 */
  .ws-chip {
    display: none;
  }
}
</style>
