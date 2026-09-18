<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppToolbar from '@/components/AppToolbar.vue'
import AdjustPanel from '@/components/AdjustPanel.vue'
import ExportSheet from '@/components/ExportSheet.vue'
import ImportOverlay from '@/components/ImportOverlay.vue'
import LibraryStrip from '@/components/LibraryStrip.vue'
import PreviewCanvas from '@/components/PreviewCanvas.vue'
import UrlImportDialog from '@/components/UrlImportDialog.vue'
import WatermarkPanel from '@/components/WatermarkPanel.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useExportStore } from '@/stores/export'
import { useImagesStore } from '@/stores/images'
import { useTemplatesStore } from '@/stores/templates'
import { useWatermarkStore } from '@/stores/watermark'

const images = useImagesStore()
const wm = useWatermarkStore()
const templates = useTemplatesStore()
const exportStore = useExportStore()

const panel = ref<'watermark' | 'adjust'>('watermark')
const urlOpen = ref(false)
const exportOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const dragDepth = ref(0)

const hasImages = computed(() => images.count > 0)

onMounted(async () => {
  if (!wm.hydrate()) await templates.apply('builtin-signature')
})

watch(
  () => wm.layers,
  () => wm.schedulePersist(),
  { deep: true },
)

function openPicker(): void {
  fileInput.value?.click()
}

async function onPick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await images.addFiles(files)
}

// 拖拽导入（支持整个文件夹递归）
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
  e.preventDefault()
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value++
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
}

function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

async function onDrop(e: DragEvent): Promise<void> {
  dragDepth.value = 0
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
  if (files.length) await images.addFiles(files)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    urlOpen.value = false
    // 导出进行中不允许关闭，避免误触丢失进度展示
    if (exportStore.phase !== 'running') exportOpen.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="app"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <AppToolbar @import="openPicker" @export-sheet="exportOpen = true" />

    <div class="workspace">
      <main class="stage">
        <PreviewCanvas v-if="hasImages" />
        <ImportOverlay v-else @pick="openPicker" @open-url="urlOpen = true" />
      </main>

      <aside class="inspector material">
        <div class="inspector-head">
          <AppSegment
            v-model="panel"
            :options="[
              { value: 'watermark', label: '水印' },
              { value: 'adjust', label: '调节' },
            ]"
          />
        </div>
        <WatermarkPanel v-show="panel === 'watermark'" />
        <AdjustPanel v-show="panel === 'adjust'" />
      </aside>
    </div>

    <LibraryStrip />

    <UrlImportDialog :open="urlOpen" @close="urlOpen = false" />
    <ExportSheet :open="exportOpen" @close="exportOpen = false" />
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
.inspector :deep(.panel-scroll) {
  flex: 1;
  overflow-y: auto;
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
