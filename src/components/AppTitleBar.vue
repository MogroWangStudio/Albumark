<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
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
import { isMacDesktop, isTauri } from '@/core/platform'
import { useHistoryStore } from '@/stores/history'
import { toast } from '@/stores/toast'
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
/** macOS 用系统红绿灯与系统窗口圆角，前端不再画窗控 */
const mac = isMacDesktop

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

/* ---------- logo 彩蛋：2 秒内连点 5 次，随机触发一个小惊喜 ---------- */
/** 视觉彩蛋与文案彩蛋各占一半，且不与上一次同类 */
const EGG_TRIGGER = 5
const EGG_WINDOW = 2000
const eggAnims = ['bounce', 'spin', 'wiggle'] as const
const eggLines = [
  '第 5 张底片，往往是最好的一张',
  '连点五次的手速，适合去按快门',
  '水印已盖好，今日辑录顺利',
  '胶片会褪色，水印不会',
  '暗房灯已亮，慢慢冲',
  '辑印虽小，方寸有印',
]
const eggAnim = ref<(typeof eggAnims)[number] | ''>('')
let eggCount = 0
let eggAt = 0
let eggCleaner = 0
let eggRaf = 0
let lastEggKind = ''
let lastEggAnim: (typeof eggAnims)[number] | '' = ''

function playEgg(): void {
  // 同名动画类需先摘掉再挂回才能重播（800ms 清理兜底，不依赖 animationend）
  eggAnim.value = ''
  cancelAnimationFrame(eggRaf)
  eggRaf = requestAnimationFrame(() => {
    const pool = eggAnims.filter((a) => a !== lastEggAnim)
    const next = pool[Math.floor(Math.random() * pool.length)]
    lastEggAnim = next
    eggAnim.value = next
  })
  clearTimeout(eggCleaner)
  eggCleaner = window.setTimeout(() => (eggAnim.value = ''), 800)
}

function onLogoClick(): void {
  const now = performance.now()
  if (now - eggAt > EGG_WINDOW) eggCount = 0
  eggAt = now
  if (++eggCount < EGG_TRIGGER) return
  eggCount = 0
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // 减弱动效时只出文案：此时不能再参与「不与上次同类」的翻转，
  // 否则会翻成不会播放的动效彩蛋，看起来像什么都没发生
  let kind: 'anim' | 'line' = reduce || Math.random() >= 0.5 ? 'line' : 'anim'
  if (!reduce && kind === lastEggKind) kind = kind === 'anim' ? 'line' : 'anim'
  lastEggKind = kind
  if (kind === 'anim') {
    playEgg()
    return
  }
  toast(eggLines[Math.floor(Math.random() * eggLines.length)])
}

onUnmounted(() => {
  clearTimeout(eggCleaner)
  cancelAnimationFrame(eggRaf)
})
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
        @click="onLogoClick"
      >
        <LogoText class="logo" :class="eggAnim ? `egg-${eggAnim}` : undefined" />
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

      <div v-if="isTauri && !mac" class="win-controls">
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
  /* 左侧让出系统红绿灯（macOS 为 78px，其余平台 0），窗口圆角由系统绘制 */
  padding: var(--safe-top) calc(10px + var(--safe-right)) 0 calc(10px + var(--traffic-light-inset) + var(--safe-left));
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
/* ---------- logo 彩蛋动画：点按自带能量，允许一点过冲 ---------- */
.logo.egg-bounce {
  animation: egg-bounce 640ms cubic-bezier(0.22, 1, 0.36, 1);
}
.logo.egg-spin {
  animation: egg-spin 700ms cubic-bezier(0.45, 0, 0.2, 1);
}
.logo.egg-wiggle {
  animation: egg-wiggle 620ms cubic-bezier(0.36, 0, 0.2, 1);
}
@keyframes egg-bounce {
  0% {
    transform: scale(1);
  }
  28% {
    transform: scale(1.18) translateY(-2px);
  }
  52% {
    transform: scale(0.94);
  }
  74% {
    transform: scale(1.04);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes egg-spin {
  from {
    transform: rotateY(0);
  }
  to {
    transform: rotateY(360deg);
  }
}
@keyframes egg-wiggle {
  0%,
  100% {
    transform: rotate(0);
  }
  20% {
    transform: rotate(-7deg);
  }
  45% {
    transform: rotate(5.5deg);
  }
  68% {
    transform: rotate(-3deg);
  }
  85% {
    transform: rotate(1.5deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .logo[class*='egg-'] {
    animation: none;
  }
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
