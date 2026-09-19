<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Droplets, SlidersHorizontal, Upload } from 'lucide-vue-next'
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
import WorkspaceLauncher from '@/components/WorkspaceLauncher.vue'
import AppTabs from '@/components/ui/AppTabs.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { isTauri } from '@/core/platform'
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
const launcherOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const dragDepth = ref(0)

const hasImages = computed(() => images.count > 0)
/** 工作区门控：未进入工作区时只有启动器可用 */
const inWorkspace = computed(() => ws.inWorkspace)
const showLauncher = computed(() => !inWorkspace.value || launcherOpen.value)

// 进入工作区后自动收起启动器
watch(
  () => ws.inWorkspace,
  (v) => {
    if (v) launcherOpen.value = false
  },
)

onMounted(async () => {
  if (!wm.hydrate()) await templates.apply('builtin-signature')
  if (isTauri) void watchNativeDrop()
})

watch(
  () => wm.layers,
  () => wm.schedulePersist(),
  { deep: true },
)

function openPicker(): void {
  if (!inWorkspace.value) return
  fileInput.value?.click()
}

async function onPick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!inWorkspace.value) return
  await ws.addFiles(files.map((file) => ({ file })))
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
  if (!inWorkspace.value) return
  e.preventDefault()
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value++
}

function onDragOver(e: DragEvent): void {
  if (!inWorkspace.value) return
  e.preventDefault()
}

function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

async function onDrop(e: DragEvent): Promise<void> {
  dragDepth.value = 0
  if (!inWorkspace.value || isTauri) return
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
  if (files.length) await ws.addFiles(files.map((file) => ({ file })))
}

/** Tauri 桌面端：Webview 拦截文件拖入，改用原生事件拿绝对路径 */
let unlistenDrop: (() => void) | null = null
async function watchNativeDrop(): Promise<void> {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    unlistenDrop = await getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type !== 'drop') return
      if (!ws.inWorkspace) return
      void ws.addFromPaths(ev.payload.paths)
    })
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (view.value === 'studio') {
      view.value = 'main'
      return
    }
    urlOpen.value = false
    settingsOpen.value = false
    if (inWorkspace.value) launcherOpen.value = false
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
      @open-workspace="launcherOpen = true"
      @import="openPicker"
      @settings="settingsOpen = true"
    />

    <WatermarkStudio v-if="view === 'studio'" @back="view = 'main'" />

    <template v-else>
      <div class="workspace">
        <main class="stage">
          <WorkspaceLauncher
            v-if="showLauncher"
            :closable="inWorkspace"
            @close="launcherOpen = false"
          />
          <PreviewCanvas v-else-if="hasImages" />
          <ImportOverlay v-else @pick="openPicker" @open-url="urlOpen = true" />
        </main>

        <aside v-if="inWorkspace" class="inspector material">
          <div class="inspector-head">
            <AppTabs
              v-model="panel"
              :options="[
                { value: 'watermark', label: '水印', icon: Droplets },
                { value: 'adjust', label: '调节', icon: SlidersHorizontal },
                { value: 'export', label: '导出', icon: Upload },
              ]"
            />
          </div>
          <div class="inspector-body">
            <WatermarkPanel v-show="panel === 'watermark'" @studio="view = 'studio'" />
            <AdjustPanel v-show="panel === 'adjust'" />
            <ExportPanel v-show="panel === 'export'" />
          </div>
        </aside>
      </div>

      <LibraryStrip v-if="inWorkspace && hasImages" />
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
  display: grid;
  grid-template-columns: 1fr 340px;
  min-height: 0;
}
.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--canvas);
  overflow: hidden;
}
.inspector {
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.inspector-head {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
.inspector-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inspector-body :deep(.panel-scroll) {
  padding: 14px;
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
@media (max-width: 900px) {
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr minmax(200px, 44%);
  }
  .stage {
    order: 1;
  }
  .inspector {
    order: 2;
    border-left: none;
    border-top: 1px solid var(--line);
  }
}
</style>
