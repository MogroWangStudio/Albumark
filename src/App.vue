<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Droplets,
  SlidersHorizontal,
  Upload,
} from 'lucide-vue-next'
import type { PluginListenerHandle } from '@capacitor/core'
import AppTitleBar from '@/components/AppTitleBar.vue'
import AdjustPanel from '@/components/AdjustPanel.vue'
import AppContextMenu, { type ContextMenuItem } from '@/components/AppContextMenu.vue'
import CropPanel from '@/components/CropPanel.vue'
import ExportPanel from '@/components/ExportPanel.vue'
import ImportOverlay from '@/components/ImportOverlay.vue'
import ImportPreviewDialog from '@/components/ImportPreviewDialog.vue'
import LibraryStrip from '@/components/LibraryStrip.vue'
import LogoMark from '@/components/brand/LogoMark.vue'
import PreviewCanvas from '@/components/PreviewCanvas.vue'
import SettingsPage from '@/components/SettingsPage.vue'
import UrlImportDialog from '@/components/UrlImportDialog.vue'
import WatermarkPanel from '@/components/WatermarkPanel.vue'
import WatermarkStudio from '@/components/WatermarkStudio.vue'
import WorkspacePage from '@/components/WorkspacePage.vue'
import AppTabs from '@/components/ui/AppTabs.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { isCapacitor, isTauri, pickImagePaths } from '@/core/platform'
import { projectMomentum, springTo, type SpringHandle } from '@/core/spring'
import { baseName } from '@/core/fs'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { useTemplatesStore } from '@/stores/templates'
import { useWatermarkStore } from '@/stores/watermark'
import { useWorkspaceStore } from '@/stores/workspace'

const images = useImagesStore()
const wm = useWatermarkStore()
const templates = useTemplatesStore()
const ws = useWorkspaceStore()
const adjust = useAdjustStore()

const view = ref<'main' | 'studio' | 'settings'>('main')
const urlOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const dragDepth = ref(0)
/** 启动画面：品牌标记淡入后整层淡出，onMounted 后由定时器收起 */
const booting = ref(true)
/** 悬浮操作面板：进入项目自动展开，工作区页面自动收起 */
const panelOpen = ref(true)
/** 面板吸附边：可按住顶栏拖动，松手吸附左缘或右缘 */
const panelSide = ref<'left' | 'right'>('right')

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
  crop: CropPanel,
  export: ExportPanel,
} as const

/* ---------- 导入：先收集待导入清单，经导入预览窗确认后入库 ---------- */

interface PendingImport {
  name: string
  path?: string
  file?: File
}
const importPreviewOpen = ref(false)
const pendingImport = ref<PendingImport[]>([])
/** 桌面端拿得到源路径才提供链接模式 */
const canLinkImport = computed(() => isTauri && pendingImport.value.every((i) => !!i.path))

function queueImport(items: PendingImport[]): void {
  if (!items.length || !inProject.value) return
  pendingImport.value = items
  importPreviewOpen.value = true
}

function openPicker(): void {
  if (!inProject.value) return
  if (isTauri) {
    void pickImagePaths('选择照片').then((paths) => {
      queueImport(paths.map((p) => ({ path: p, name: baseName(p) })))
    })
  } else {
    fileInput.value?.click()
  }
}

async function onPick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  queueImport(files.map((file) => ({ file, name: file.name })))
}

async function confirmImport(mode: 'copy' | 'link'): Promise<void> {
  ws.importMode = mode
  const items = pendingImport.value
  pendingImport.value = []
  importPreviewOpen.value = false
  const paths = items.map((i) => i.path).filter((p): p is string => !!p)
  const files = items.filter((i) => i.file).map((i) => ({ file: i.file! }))
  if (paths.length) void ws.addFromPaths(paths, mode)
  if (files.length) void ws.addFiles(files, mode)
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
  queueImport(files.map((file) => ({ file, name: file.name })))
}

/** Tauri 桌面端：Webview 拦截文件拖入，改用原生事件拿绝对路径 */
let unlistenDrop: (() => void) | null = null
async function watchNativeDrop(): Promise<void> {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    unlistenDrop = await getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type !== 'drop') return
      if (!ws.inProject) return
      queueImport(ev.payload.paths.map((p) => ({ path: p, name: baseName(p) })))
    })
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

/* ---------- 悬浮面板：顶栏拖动 + 左右吸附 ---------- */

const PANEL_W = 342
const PANEL_EDGE = 12
const wsEl = ref<HTMLElement | null>(null)
const wsWidth = ref(0)
/** 面板 wrapper 的水平位移（相对停靠左缘的位置） */
const panelX = ref(0)
const dragging = ref(false)
let snapAnim: SpringHandle | null = null
let dragGesture: {
  grabDx: number
  wsLeft: number
  /** 按下时实测的工作区宽度：拖动夹紧以此为基准，不受切页后的缓存过期影响 */
  wsW: number
  hist: { x: number; t: number }[]
} | null = null

const narrowQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(max-width: 900px)')
    : null
const isNarrow = ref(!!narrowQuery?.matches)

function snapXFor(side: 'left' | 'right'): number {
  if (side === 'left') return 0
  return Math.max(0, wsWidth.value - PANEL_W - PANEL_EDGE * 2)
}

function stopSnap(): void {
  snapAnim?.stop()
  snapAnim = null
}

watch([wsWidth, panelSide], () => {
  if (dragging.value || isNarrow.value) return
  stopSnap()
  panelX.value = snapXFor(panelSide.value)
})

watch(isNarrow, (v) => {
  if (v) stopSnap()
})

let wsRo: ResizeObserver | null = null

/** .workspace 会随页面切换卸载重建：每次都重新观察新元素，并立即同步实测宽度 */
watch(wsEl, (el) => {
  wsRo?.disconnect()
  wsRo = null
  if (el && typeof ResizeObserver !== 'undefined') {
    wsRo = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      wsWidth.value = r ? r.width : 0
    })
    wsRo.observe(el)
  }
  wsWidth.value = el?.getBoundingClientRect().width ?? 0
})

function onPanelDragDown(e: PointerEvent): void {
  if (isNarrow.value) return
  const t = e.target as HTMLElement
  if (t.closest('button, input, .tabs')) return
  const head = e.currentTarget as HTMLElement
  const wsRect = wsEl.value?.getBoundingClientRect()
  if (!wsRect || !wsRect.width) return
  head.setPointerCapture(e.pointerId)
  stopSnap()
  dragGesture = {
    grabDx: e.clientX - (wsRect.left + PANEL_EDGE + panelX.value),
    wsLeft: wsRect.left,
    wsW: wsRect.width,
    hist: [{ x: e.clientX, t: performance.now() }],
  }
  dragging.value = true
}

function onPanelDragMove(e: PointerEvent): void {
  const g = dragGesture
  if (!g) return
  const min = -PANEL_EDGE
  const max = Math.max(min, g.wsW - PANEL_W - PANEL_EDGE * 2 + PANEL_EDGE)
  const x = Math.min(max, Math.max(min, e.clientX - g.grabDx - g.wsLeft - PANEL_EDGE))
  panelX.value = x
  const now = performance.now()
  g.hist.push({ x: e.clientX, t: now })
  while (g.hist.length > 2 && now - g.hist[0]!.t > 90) g.hist.shift()
}

function onPanelDragUp(e: PointerEvent): void {
  const g = dragGesture
  dragGesture = null
  dragging.value = false
  if (!g) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  // 松手时先同步一次实测宽度，避免吸附目标算在过期值上
  const rectNow = wsEl.value?.getBoundingClientRect()
  if (rectNow?.width) wsWidth.value = rectNow.width
  // 由最近 ~90ms 的位移估计释放速度，投影出自然停靠点再吸附
  const first = g.hist[0]!
  const last = g.hist[g.hist.length - 1]!
  const dt = Math.max(1, last.t - first.t) / 1000
  const vx = (last.x - first.x) / dt
  const projected = panelX.value + projectMomentum(vx)
  const leftCenter = 0 + PANEL_W / 2
  const rightCenter = snapXFor('right') + PANEL_W / 2
  panelSide.value = Math.abs(projected - leftCenter) < Math.abs(projected - rightCenter) ? 'left' : 'right'
  const target = snapXFor(panelSide.value)
  snapAnim = springTo(panelX.value, target, {
    velocity: vx,
    bounce: Math.abs(vx) > 250 ? 0.2 : 0,
    response: 0.4,
    onUpdate: (v) => (panelX.value = v),
    onSettle: () => (snapAnim = null),
  })
}

const wrapStyle = computed(() =>
  isNarrow.value ? undefined : { transform: `translateX(${panelX.value}px)` },
)

/** 预览与空状态问候页共用：面板展开时让出的宽度（0 = 面板收起 / 未进项目 / 移动端底部形态） */
const panelInset = computed(() =>
  inProject.value && panelOpen.value && !isNarrow.value ? PANEL_W + PANEL_EDGE * 2 : 0,
)

/** 移动端底部抽屉弹起时让出的高度：预览中心上移到抽屉上方的剩余区域 */
const panelBottomInset = computed(() => {
  if (!inProject.value || !panelOpen.value || !isNarrow.value) return 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  return Math.min(vh * 0.46, 430) + 30
})

/* ---------- 自定义右键菜单 ---------- */

const ctxState = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void {
  e.preventDefault()
  e.stopPropagation()
  ctxState.value = { x: e.clientX, y: e.clientY, items }
}

/** 全局兜底：除文本编辑场景外一律禁用原生右键菜单 */
function onGlobalContextMenu(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
}

function onPreviewCtx(e: MouseEvent): void {
  openContextMenu(e, [
    { label: '适应窗口', action: () => previewRef.value?.fitView() },
    { label: '实际大小 100%', action: () => previewRef.value?.setZoom(1) },
    { label: panelOpen.value ? '收起操作面板' : '展开操作面板', action: () => (panelOpen.value = !panelOpen.value) },
    { label: '导入照片…', action: () => openPicker() },
  ])
}

function onPhotoCtx(e: MouseEvent, id: string): void {
  const item = images.items.find((i) => i.id === id)
  openContextMenu(e, [
    {
      label: '设为当前照片',
      disabled: id === images.activeId,
      action: () => images.select(id),
    },
    item?.missing
      ? {
          label: '重新定位源文件…',
          action: () => {
            void pickImagePaths('定位原文件').then(([p]) => {
              if (p) void ws.relink(id, p)
            })
          },
        }
      : { label: '从项目中移除', danger: true, action: () => void ws.removeImage(id) },
  ])
}

const previewRef = ref<InstanceType<typeof PreviewCanvas> | null>(null)

/** 顶栏「工作区」：回到工作区页面并关闭当前项目 */
function openWorkspace(): void {
  view.value = 'main'
  if (ws.inProject) ws.closeProject()
}

onMounted(async () => {
  if (isTauri || isCapacitor) void ws.init()
  if (isTauri) void watchNativeDrop()
  if (isCapacitor) {
    try {
      const { App } = await import('@capacitor/app')
      capBack = await App.addListener('backButton', () => void onAndroidBack())
    } catch {
      /* 插件不可用时退回系统默认行为 */
    }
  }
  if (!wm.hydrate()) await templates.apply('builtin-signature')
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('contextmenu', onGlobalContextMenu)
  window.addEventListener('pagehide', flushWorkspace)
  document.addEventListener('visibilitychange', onVisChange)
  narrowQuery?.addEventListener('change', onNarrowChange)
  window.setTimeout(() => (booting.value = false), 560)
})

let capBack: PluginListenerHandle | null = null

/** 安卓原生返回：逐级收起浮层与页面，最后 flush 数据再退出 */
async function onAndroidBack(): Promise<void> {
  if (ctxState.value) {
    ctxState.value = null
    return
  }
  if (importPreviewOpen.value) {
    importPreviewOpen.value = false
    return
  }
  if (urlOpen.value) {
    urlOpen.value = false
    return
  }
  if (view.value !== 'main') {
    view.value = 'main'
    return
  }
  if (inProject.value && panelOpen.value) {
    panelOpen.value = false
    return
  }
  await ws.flushSave()
  const { App } = await import('@capacitor/app')
  await App.exitApp()
}

/** 防抖保存的兜底：切后台/页面隐藏时立即写出，防止 400ms 窗口内被系统杀掉丢数据 */
function flushWorkspace(): void {
  void ws.flushSave().catch(() => undefined)
}

function onVisChange(): void {
  if (document.visibilityState === 'hidden') flushWorkspace()
}

function onNarrowChange(e: MediaQueryListEvent): void {
  isNarrow.value = e.matches
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  const typing =
    !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  if (e.key === 'Escape') {
    if (ctxState.value) {
      ctxState.value = null
      return
    }
    if (view.value === 'studio' || view.value === 'settings') {
      view.value = 'main'
      return
    }
    urlOpen.value = false
    importPreviewOpen.value = false
    if (images.multiSelect) {
      images.toggleMultiSelect(false)
      return
    }
  }
  // 多选模式：Cmd/Ctrl+A 全选（输入框内不拦截）
  if (!typing && images.multiSelect && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    images.selectAll()
    return
  }
  // 左右方向键：顺序切换当前照片
  if (!typing && view.value === 'main' && inProject.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    if (images.step(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault()
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('contextmenu', onGlobalContextMenu)
  window.removeEventListener('pagehide', flushWorkspace)
  document.removeEventListener('visibilitychange', onVisChange)
  narrowQuery?.removeEventListener('change', onNarrowChange)
  void capBack?.remove()
  capBack = null
  wsRo?.disconnect()
  unlistenDrop?.()
  stopSnap()
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
      @open-workspace="openWorkspace"
      @import="openPicker"
      @studio="view = 'studio'"
      @settings="view = 'settings'"
    />

    <Transition name="view">
      <WatermarkStudio v-if="view === 'studio'" key="studio" @back="view = 'main'" />
      <SettingsPage v-else-if="view === 'settings'" key="settings" @back="view = 'main'" />
      <div v-else key="main" class="view-main">
        <div ref="wsEl" class="workspace">
          <main class="stage">
            <Transition name="page" mode="out-in">
              <WorkspacePage v-if="!inProject" key="ws" />
              <div v-else key="stage" class="stage-fill">
                <Transition name="fade" mode="out-in">
                  <PreviewCanvas
                    v-if="hasImages"
                    key="preview"
                    ref="previewRef"
                    :panel-inset="panelInset"
                    :panel-side="panelSide"
                    :panel-bottom-inset="panelBottomInset"
                    @ctx="onPreviewCtx"
                  />
                  <ImportOverlay
                    v-else
                    key="import"
                    :panel-inset="panelInset"
                    :panel-side="panelSide"
                    :panel-bottom-inset="panelBottomInset"
                    @pick="openPicker"
                    @open-url="urlOpen = true"
                  />
                </Transition>
              </div>
            </Transition>
          </main>

          <!-- 悬浮操作面板：吸附左/右缘，顶栏可按住拖动；工作区页面自动收起 -->
          <aside v-if="inProject" class="inspector-wrap" :class="`side-${panelSide}`" :style="wrapStyle">
            <Transition :name="panelSide === 'left' ? 'panel-left' : 'panel-right'" appear>
              <section v-show="panelOpen" class="inspector" :class="{ dragging }">
                <div
                  class="inspector-head"
                  @pointerdown="onPanelDragDown"
                  @pointermove="onPanelDragMove"
                  @pointerup="onPanelDragUp"
                  @pointercancel="onPanelDragUp"
                >
                  <AppTabs
                    v-model="adjust.panel"
                    :options="[
                      { value: 'watermark', label: '水印', icon: Droplets },
                      { value: 'adjust', label: '调节', icon: SlidersHorizontal },
                      { value: 'crop', label: '裁剪', icon: Crop },
                      { value: 'export', label: '导出', icon: Upload },
                    ]"
                  />
                  <button class="collapse" title="收起面板" @click="panelOpen = false">
                    <ChevronRight v-if="panelSide === 'right'" :size="14" />
                    <ChevronLeft v-else :size="14" />
                  </button>
                </div>
                <div class="inspector-body">
                  <Transition name="pane" mode="out-in">
                    <KeepAlive>
                      <component :is="PANELS[adjust.panel]" :key="adjust.panel" />
                    </KeepAlive>
                  </Transition>
                </div>
              </section>
            </Transition>
          </aside>
          <Transition name="fade">
            <button
              v-if="inProject && !panelOpen"
              class="panel-tab"
              :class="`side-${panelSide}`"
              title="展开面板"
              @click="panelOpen = true"
            >
              <ChevronLeft v-if="panelSide === 'right'" :size="15" />
              <ChevronRight v-else :size="15" />
            </button>
          </Transition>
        </div>

        <LibraryStrip v-if="inProject && hasImages" @photo-ctx="onPhotoCtx" />
      </div>
    </Transition>

    <UrlImportDialog :open="urlOpen" @close="urlOpen = false" />
    <ImportPreviewDialog
      :open="importPreviewOpen"
      :items="pendingImport"
      :can-link="canLinkImport"
      @close="importPreviewOpen = false"
      @confirm="confirmImport"
    />
    <AppContextMenu
      :state="ctxState"
      @close="ctxState = null"
    />
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

    <Transition name="boot">
      <div v-if="booting" class="boot" aria-hidden="true">
        <LogoMark class="boot-logo" />
      </div>
    </Transition>
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
/* 主视图容器：页面切换过渡期间承载 workspace 与照片条的整体淡入缩放 */
.view-main {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
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
/* 面板位置壳：只承担水平位移（拖动与吸附都落在它身上）。
   壳层不拦截指针——收起后它仍占据原区域，拦截会让展开把手点不到 */
.inspector-wrap {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 12px;
  width: 342px;
  z-index: 20;
  will-change: transform;
  pointer-events: none;
}
.inspector {
  pointer-events: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-l);
  /* 完全不透明的实底 + 明显更淡的阴影 */
  background: var(--panel);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}
.inspector-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 10px 10px;
  border-bottom: 1px solid var(--line);
  flex: none;
  cursor: grab;
  touch-action: none;
}
.inspector-head:active,
.inspector.dragging .inspector-head {
  cursor: grabbing;
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
  overflow-x: hidden;
}
.inspector-body :deep(.panel-scroll) {
  padding: 14px;
}
/* 收起后的把手：贴吸附边竖条 */
.panel-tab {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 19;
  width: 22px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), width var(--dur-hover) var(--ease-soft);
}
.panel-tab.side-right {
  right: 0;
  border-right: none;
  border-radius: 10px 0 0 10px;
}
.panel-tab.side-left {
  left: 0;
  border-left: none;
  border-radius: 0 10px 10px 0;
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

/* 启动画面：品牌标记淡入就位后整层快速淡出，露出主界面 */
.boot {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  background: var(--bg);
}
.boot-logo {
  width: 72px;
  height: auto;
  animation: boot-in 420ms var(--ease-soft) both;
}
@keyframes boot-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.boot-leave-active {
  transition: opacity 240ms ease;
}
.boot-leave-to {
  opacity: 0;
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
/* 顶层页面切换（主视图 ⇄ 水印工作室/设置）：同一套非线性曲线，进出路径互为镜像 */
.view-enter-active {
  transition: opacity 300ms var(--ease-soft), transform 300ms var(--ease-soft);
}
.view-leave-active {
  transition: opacity 200ms var(--ease), transform 200ms var(--ease);
}
.view-enter-from {
  opacity: 0;
  transform: scale(0.99) translateY(10px);
}
.view-leave-to {
  opacity: 0;
  transform: scale(1.008) translateY(-6px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur) var(--ease-soft);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
/* 悬浮面板：从吸附缘滑入滑出，同一路径可逆 */
.panel-right-enter-active {
  transition: transform 360ms var(--ease-soft), opacity 360ms var(--ease-soft);
}
.panel-right-leave-active {
  transition: transform 260ms var(--ease), opacity 260ms var(--ease);
}
.panel-right-enter-from,
.panel-right-leave-to {
  transform: translateX(calc(100% + 16px));
  opacity: 0.35;
}
.panel-left-enter-active {
  transition: transform 360ms var(--ease-soft), opacity 360ms var(--ease-soft);
}
.panel-left-leave-active {
  transition: transform 260ms var(--ease), opacity 260ms var(--ease);
}
.panel-left-enter-from,
.panel-left-leave-to {
  transform: translateX(calc(-100% - 16px));
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
  .inspector-wrap {
    top: auto;
    left: 8px;
    right: 8px;
    bottom: calc(8px + var(--safe-bottom));
    width: auto;
    height: min(46vh, 430px);
    transform: none !important;
  }
  .panel-right-enter-from,
  .panel-right-leave-to,
  .panel-left-enter-from,
  .panel-left-leave-to {
    transform: translateY(calc(100% + 12px));
  }
  .panel-tab {
    top: auto;
    bottom: calc(14px + var(--safe-bottom));
    transform: none;
    width: 56px;
    height: 22px;
    border-radius: 10px 10px 0 0;
    border: 1px solid var(--line);
    border-bottom: none;
  }
  .panel-tab.side-right {
    right: 0;
  }
  .panel-tab.side-left {
    left: 0;
  }
  .panel-tab:hover {
    width: 56px;
  }
}
</style>
