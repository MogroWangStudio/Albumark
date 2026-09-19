<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Droplets,
  SlidersHorizontal,
  Upload,
} from 'lucide-vue-next'
import AppTitleBar from '@/components/AppTitleBar.vue'
import AdjustPanel from '@/components/AdjustPanel.vue'
import ExportPanel from '@/components/ExportPanel.vue'
import ImportOverlay from '@/components/ImportOverlay.vue'
import LibraryStrip from '@/components/LibraryStrip.vue'
import PreviewCanvas from '@/components/PreviewCanvas.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import UrlImportDialog from '@/components/UrlImportDialog.vue'
import WatermarkPanel from '@/components/WatermarkPanel.vue'
import WatermarkStudio from '@/components/WatermarkStudio.vue'
import WorkspacePage from '@/components/WorkspacePage.vue'
import AppTabs from '@/components/ui/AppTabs.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { isTauri, pickImagePaths } from '@/core/platform'
import { useImagesStore } from '@/stores/images'
import { useTemplatesStore } from '@/stores/templates'
import { useWatermarkStore } from '@/stores/watermark'
import { useWorkspaceStore } from '@/stores/workspace'

const images = useImagesStore()
const wm = useWatermarkStore()
const templates = useTemplatesStore()
const ws = useWorkspaceStore()

const view = ref<'main' | 'studio'>('main')
const panel = ref<'watermark' | 'adjust' | 'export'>('watermark')
const urlOpen = ref(false)
const settingsOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const dragDepth = ref(0)
/** 悬浮操作面板的展开状态：进入项目自动展开，工作区页面自动收起 */
const panelOpen = ref(true)

const hasImages = computed(() => images.count > 0)
/** 工作区门控：未进入项目时显示工作区页面 */
const inProject = computed(() => ws.inProject)

watch(
  () => ws.inProject,
  (v) => {
    if (v) panelOpen.value = true
  },
)

const PANELS = {
  watermark: WatermarkPanel,
  adjust: AdjustPanel,
  export: ExportPanel,
} as const

onMounted(async () => {
  if (isTauri) {
    void ws.init()
    void watchNativeDrop()
  }
  if (!wm.hydrate()) await templates.apply('builtin-signature')
})

watch(
  () => wm.layers,
  () => wm.schedulePersist(),
  { deep: true },
)

function openPicker(): void {
  if (!inProject.value) return
  if (isTauri) {
    void pickImagePaths('选择照片').then((paths) => {
      if (paths.length) void ws.addFromPaths(paths, ws.importMode)
    })
  } else {
    fileInput.value?.click()
  }
}

async function onPick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!inProject.value) return
  await ws.addFiles(files.map((file) => ({ file })), ws.importMode)
}

// 拖拽导入（浏览器：递归遍历文件夹；桌面端另走原生拖入事件）
async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    await new Promise<void>((resolve) => {
      ;(entry as FileSystemFileEntry).file(
        (f) => {
          out.push(f)
          resolve()
        },
        () => resolve(),
      )
    })
    return
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const children: FileSystemEntry[] = []
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (es) => resolve(es as FileSystemEntry[]),
          () => resolve([]),
        )
      })
      if (!batch.length) break
      children.push(...batch)
    }
    for (const c of children) await walkEntry(c, out)
  }
}

function onDragEnter(e: DragEvent): void {
  if (!inProject.value) return
  e.preventDefault()
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value++
}

function onDragOver(e: DragEvent): void {
  if (!inProject.value) return
  e.preventDefault()
}

function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

async function onDrop(e: DragEvent): Promise<void> {
  dragDepth.value = 0
  if (!inProject.value || isTauri) return
  const dt = e.dataTransfer
  if (!dt) return
  const files: File[] = []
  const entries = Array.from(dt.items ?? [])
    .map((i) => i.webkitGetAsEntry?.() ?? null)
    .filter((x): x is FileSystemEntry => !!x)
  if (entries.length) {
    for (const en of entries) await walkEntry(en, files)
  }
  if (!files.length) files.push(...Array.from(dt.files ?? []))
  if (files.length) await ws.addFiles(files.map((file) => ({ file })), ws.importMode)
}

/** Tauri 桌面端：Webview 拦截文件拖入，改用原生事件拿绝对路径 */
let unlistenDrop: (() => void) | null = null
async function watchNativeDrop(): Promise<void> {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    unlistenDrop = await getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type !== 'drop') return
      if (!ws.inProject) return
      void ws.addFromPaths(ev.payload.paths, ws.importMode)
    })
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  const typing =
    !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  if (e.key === 'Escape') {
    if (view.value === 'studio') {
      view.value = 'main'
      return
    }
    urlOpen.value = false
    settingsOpen.value = false
    return
  }
  // 左右方向键：顺序切换当前照片
  if (!typing && view.value === 'main' && inProject.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    if (images.step(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  unlistenDrop?.()
})
</script>

<template>
  <div
    class="app"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <AppTitleBar
      @open-workspace="ws.inProject ? ws.closeProject() : undefined"
      @import="openPicker"
      @settings="settingsOpen = true"
    />

    <WatermarkStudio v-if="view === 'studio'" @back="view = 'main'" />

    <template v-else>
      <div class="workspace">
        <main class="stage">
          <Transition name="page" mode="out-in">
            <WorkspacePage v-if="!inProject" key="ws" />
            <div v-else key="stage" class="stage-fill">
              <Transition name="fade" mode="out-in">
                <PreviewCanvas v-if="hasImages" key="preview" />
                <ImportOverlay v-else key="import" @pick="openPicker" @open-url="urlOpen = true" />
              </Transition>
            </div>
          </Transition>
        </main>

        <!-- 悬浮操作面板：项目内可展开/收起，工作区页面自动收起 -->
        <Transition name="panel">
          <aside v-if="inProject && panelOpen" class="inspector material">
            <div class="inspector-head">
              <AppTabs
                v-model="panel"
                :options="[
                  { value: 'watermark', label: '水印', icon: Droplets },
                  { value: 'adjust', label: '调节', icon: SlidersHorizontal },
                  { value: 'export', label: '导出', icon: Upload },
                ]"
              />
              <button
                class="collapse"
                title="收起面板"
                @click="panelOpen = false"
              >
                <ChevronRight :size="14" />
              </button>
            </div>
            <div class="inspector-body">
              <Transition name="pane" mode="out-in">
                <KeepAlive>
                  <component :is="PANELS[panel]" :key="panel" @studio="view = 'studio'" />
                </KeepAlive>
              </Transition>
            </div>
          </aside>
        </Transition>
        <Transition name="fade">
          <button v-if="inProject && !panelOpen" class="panel-tab" title="展开面板" @click="panelOpen = true">
            <ChevronLeft :size="15" />
          </button>
        </Transition>
      </div>

      <LibraryStrip v-if="inProject && hasImages" />
    </template>

    <UrlImportDialog :open="urlOpen" @close="urlOpen = false" />
    <SettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
    <ToastHost />

    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,.jpg,.jpeg"
      multiple
      hidden
      @change="onPick"
    />

    <div v-if="dragDepth > 0" class="drop-ring" aria-hidden="true" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  position: relative;
}
.workspace {
  flex: 1;
  position: relative;
  min-height: 0;
}
.stage {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  background: var(--canvas);
  overflow: hidden;
}
.stage-fill {
  position: absolute;
  inset: 0;
}
.inspector {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: 342px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.inspector-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
.collapse {
  width: 24px;
  height: 24px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--text-3);
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.collapse:hover {
  background: var(--active);
  color: var(--text);
}
.inspector-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inspector-body :deep(.panel-scroll) {
  padding: 14px;
}
/* 收起后的把手：贴右缘竖条 */
.panel-tab {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 19;
  width: 22px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-right: none;
  border-radius: 10px 0 0 10px;
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), width var(--dur-hover) var(--ease-soft);
}
.panel-tab:hover {
  color: var(--text);
  width: 26px;
}
.drop-ring {
  position: fixed;
  inset: 8px;
  z-index: 90;
  border: 2px solid var(--accent);
  border-radius: 16px;
  background: rgba(255, 167, 47, 0.06);
  pointer-events: none;
}

/* 页面切换（工作区 ⇄ 项目）：柔和的非线性淡入缩放 */
.page-enter-active {
  transition: opacity 320ms var(--ease-soft), transform 320ms var(--ease-soft);
}
.page-leave-active {
  transition: opacity 220ms var(--ease), transform 220ms var(--ease);
}
.page-enter-from {
  opacity: 0;
  transform: scale(0.988) translateY(8px);
}
.page-leave-to {
  opacity: 0;
  transform: scale(1.008) translateY(-4px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur) var(--ease-soft);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
/* 悬浮面板：从右缘滑入滑出，同一路径可逆 */
.panel-enter-active {
  transition: transform 360ms var(--ease-soft), opacity 360ms var(--ease-soft);
}
.panel-leave-active {
  transition: transform 260ms var(--ease), opacity 260ms var(--ease);
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(calc(100% + 16px));
  opacity: 0.35;
}
/* 面板内功能切换：轻微纵向推移的交叉淡入 */
.pane-enter-active {
  transition: opacity 200ms var(--ease-soft), transform 200ms var(--ease-soft);
}
.pane-leave-active {
  transition: opacity 130ms var(--ease), transform 130ms var(--ease);
}
.pane-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.pane-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 900px) {
  .inspector {
    top: auto;
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    height: min(46vh, 430px);
  }
  .panel-enter-from,
  .panel-leave-to {
    transform: translateY(calc(100% + 12px));
  }
  .panel-tab {
    top: auto;
    bottom: 14px;
    transform: none;
    width: 56px;
    height: 22px;
    border-radius: 10px 10px 0 0;
    border: 1px solid var(--line);
    border-bottom: none;
  }
  .panel-tab:hover {
    width: 56px;
  }
}
</style>
