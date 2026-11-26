<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Archive,
  ArrowLeft,
  ArchiveRestore,
  ArrowRight,
  Check,
  Copy,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Images,
  Layers,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Search,
  SquareDashed,
  Trash2,
  X,
} from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import EmojiPicker from '@/components/ui/EmojiPicker.vue'
import ExportProjectDialog from '@/components/ExportProjectDialog.vue'
import ImportProjectDialog from '@/components/ImportProjectDialog.vue'
import type { ContextMenuItem } from '@/components/AppContextMenu.vue'
import { useI18n } from '@/i18n'
import { useLongPress } from '@/core/longpress'
import { fmtSize } from '@/core/format'
import { fsAvailable, sandboxedFs } from '@/core/fs'
import { isTauri, revealInFolder } from '@/core/platform'
import { openCtxMenu } from '@/stores/ctxMenu'
import { toast } from '@/stores/toast'
import { useSettingsStore } from '@/stores/settings'
import { useWatermarkStore } from '@/stores/watermark'
import { useWorkspaceStore, type ProjectMeta, type WorkDirMeta } from '@/stores/workspace'

/**
 * 工作区页面：OOBE（仅桌面）→ 工作区总览（工作目录列表 + 工作项目卡片）。
 * 无文件能力的环境（浏览器）降级为会话内临时项目。
 */
const ws = useWorkspaceStore()
const wm = useWatermarkStore()
const settings = useSettingsStore()
const { t } = useI18n()

type Step = 'oobe' | 'projects'

const step = computed<Step>(() => {
  if (fsAvailable && isTauri && !settings.oobeDone) return 'oobe'
  return 'projects'
})

/* OOBE：软件数据位置（仅桌面） */
const oobePicked = ref('')
const oobeDir = computed(() => oobePicked.value || ws.defaultDataDir || '…')

async function pickDataDir(): Promise<void> {
  const { pickDirectory } = await import('@/core/platform')
  const d = await pickDirectory(t('选择软件数据位置'))
  if (d) oobePicked.value = d
}

function finishOobe(): void {
  settings.dataDir = oobePicked.value
  settings.oobeDone = true
}

/* 工作目录管理 */
const newDirName = ref('')
const removeDirTarget = ref<WorkDirMeta | null>(null)

/** 安卓沙箱：在应用数据目录下新建命名工作目录；桌面：系统选择器（允许已有项目）。
 *  成功后直接进入工作项目页——目录页的任务（建目录）已完成 */
async function addDir(): Promise<void> {
  if (sandboxedFs) {
    const ok = await ws.createDir(newDirName.value)
    if (ok) {
      newDirName.value = ''
      ws.gotoSubPage('projects')
    }
    return
  }
  const ok = await ws.addDir()
  if (ok) ws.gotoSubPage('projects')
}

function confirmRemoveDir(): void {
  const t = removeDirTarget.value
  removeDirTarget.value = null
  if (t) void ws.removeDir(t)
}

/* 工作项目管理 */
const newName = ref('')
const removeTarget = ref<{ id: string; name: string } | null>(null)

const canCreate = computed(() => !!newName.value.trim())

async function create(): Promise<void> {
  if (!canCreate.value) return
  const ok = await ws.createProject(newName.value)
  if (ok) newName.value = ''
}

async function confirmRemove(): Promise<void> {
  const t = removeTarget.value
  removeTarget.value = null
  if (!t) return
  const meta = ws.projects.find((p) => p.id === t.id)
  if (!meta) return
  // 先确认项目真的进了回收站，再清它那份水印配置：
  // 删除失败时配置应当原样保留，否则用户重试时水印已经找不回来了
  if (!(await ws.removeProject(meta))) return
  wm.forgetProject(meta.id)
}

/* 重命名：目录与项目共用一个对话框，按 kind 分派到对应 action */
const renameTarget = ref<{ kind: 'project' | 'dir'; meta: ProjectMeta | WorkDirMeta } | null>(null)
/** 设置 emoji 图标的目标：目录写 workdir.json，项目写 albumark.json */
const emojiTarget = ref<{ kind: 'project' | 'dir'; meta: ProjectMeta | WorkDirMeta } | null>(null)

/* ---------- 编辑信息：项目名 / 简介 / emoji 一次编辑 ---------- */
const editInfoTarget = ref<ProjectMeta | null>(null)
const editName = ref('')
const editDesc = ref('')
const editEmoji = ref('')

function openEditInfo(p: ProjectMeta): void {
  editInfoTarget.value = p
  editName.value = p.name
  editDesc.value = p.description ?? ''
  editEmoji.value = p.emoji ?? ''
}

async function confirmEditInfo(): Promise<void> {
  const t = editInfoTarget.value
  if (!t) return
  const ok = await ws.updateProjectInfo(t, {
    name: editName.value,
    description: editDesc.value,
    emoji: editEmoji.value,
  })
  if (ok) editInfoTarget.value = null
}

/* ---------- 多选批量:目录页 / 项目页 ---------- */

const selectScope = ref<'dirs' | 'projects' | null>(null)
const selected = ref<Set<string>>(new Set())
const selectedCount = computed(() => selected.value.size)
const isSelecting = computed(() => selectScope.value !== null)

function enterSelect(scope: 'dirs' | 'projects'): void {
  selectScope.value = scope
  selected.value = new Set()
}
function exitSelect(): void {
  selectScope.value = null
  selected.value = new Set()
}
function toggleSel(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function selectAllVisible(): void {
  const all =
    selectScope.value === 'dirs'
      ? filteredDirs.value.map((d) => d.path)
      : filteredProjects.value.map((p) => p.id)
  selected.value = new Set(all)
}

/* ---------- 筛选 / 查找：目录与项目各自一个搜索框 ---------- */
const dirQuery = ref('')
const prjQuery = ref('')

function matchesQuery(q: string, ...fields: (string | undefined)[]): boolean {
  const key = q.trim().toLowerCase()
  if (!key) return true
  return fields.some((f) => (f ?? '').toLowerCase().includes(key))
}

const filteredDirs = computed(() => {
  const q = dirQuery.value
  return q.trim() ? ws.dirs.filter((d) => matchesQuery(q, d.name, d.path)) : ws.dirs
})
const filteredProjects = computed(() => {
  const q = prjQuery.value
  return q.trim()
    ? ws.projects.filter((p) => matchesQuery(q, p.name, p.description, p.emoji))
    : ws.projects
})

// 搜索条件变化时把不可见的选中项剔除，批量操作只作用于当前看到的内容
watch([dirQuery, prjQuery], () => {
  if (selectScope.value === 'dirs') {
    const visible = new Set(filteredDirs.value.map((d) => d.path))
    selected.value = new Set([...selected.value].filter((id) => visible.has(id)))
  } else if (selectScope.value === 'projects') {
    const visible = new Set(filteredProjects.value.map((p) => p.id))
    selected.value = new Set([...selected.value].filter((id) => visible.has(id)))
  }
})

/** 选中项目的元信息(按当前列表过滤,排除已被外部删除的) */
const selectedProjects = computed(() =>
  selectScope.value === 'projects'
    ? ws.projects.filter((p) => selected.value.has(p.id))
    : [],
)
/** 选中目录的元信息 */
const selectedDirs = computed(() =>
  selectScope.value === 'dirs' ? ws.dirs.filter((d) => selected.value.has(d.path)) : [],
)

/* 框选(rubber band):多选模式下在列表空白处按下拖动,与行/卡相交即选中 */
const rubber = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
let rubberBase: Set<string> | null = null

function rubberRect(): { left: number; top: number; width: number; height: number } | null {
  if (!rubber.value) return null
  const { x1, y1, x2, y2 } = rubber.value
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}
const rubberStyle = computed(() => {
  const r = rubberRect()
  return r ? { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` } : null
})

function onRubberDown(scope: 'dirs' | 'projects', e: PointerEvent): void {
  if (selectScope.value !== scope || isCoarse.value || e.button !== 0) return
  const t = e.target as HTMLElement | null
  // 行/卡/菜单上的按下不属于框选起点
  if (t?.closest('.dir-row, .prj-card, .dropdown-menu, .select-bar, button, input')) return
  // 框选覆盖层挂在所属 section 内:坐标以 section 为基准
  const hostEl = (e.currentTarget as HTMLElement).closest('.subpage') as HTMLElement | null
  if (!hostEl) return
  const host = hostEl.getBoundingClientRect()
  const startX = e.clientX - host.left
  const startY = e.clientY - host.top
  rubberBase = new Set(selected.value)
  rubber.value = { x1: startX, y1: startY, x2: startX, y2: startY }
  const move = (ev: PointerEvent) => {
    rubber.value = { x1: startX, y1: startY, x2: ev.clientX - host.left, y2: ev.clientY - host.top }
    const r = rubberRect()
    if (!r || !rubberBase) return
    const next = new Set(rubberBase)
    const sel = `[data-${scope === 'dirs' ? 'dir-path' : 'prj-id'}]`
    for (const el of hostEl.querySelectorAll(sel)) {
      const box = el.getBoundingClientRect()
      if (
        box.left < host.left + r.left + r.width &&
        box.right > host.left + r.left &&
        box.top < host.top + r.top + r.height &&
        box.bottom > host.top + r.top
      ) {
        next.add(scope === 'dirs' ? (el as HTMLElement).dataset.dirPath! : (el as HTMLElement).dataset.prjId!)
      }
    }
    selected.value = next
  }
  const up = () => {
    rubber.value = null
    rubberBase = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/* 批量动作 */
const confirmBatchDelete = ref(false)
const moveTargetOpen = ref(false)
const exporting = ref(false)

function batchCopy(): void {
  void (async () => {
    if (selectScope.value === 'projects') {
      const n = await ws.copyProjects(selectedProjects.value)
      toast(n ? t('已复制 {0} 个项目', n) : t('复制失败'), n ? 'success' : 'error')
    } else {
      if (isTauri) {
        const { pickDirectory } = await import('@/core/platform')
        const parent = await pickDirectory(t('选择复制到的位置'))
        if (!parent) return
        const n = await ws.copyDirs(selectedDirs.value, parent)
        toast(n ? t('已复制 {0} 个目录', n) : t('复制失败'), n ? 'success' : 'error')
      } else {
        const n = await ws.copyDirs(selectedDirs.value, `Albumark/目录备份_${Date.now()}`, true)
        toast(n ? t('已复制 {0} 个目录到 Documents/Albumark', n) : t('复制失败'), n ? 'success' : 'error')
      }
    }
    exitSelect()
  })()
}

function batchMove(): void {
  if (selectScope.value === 'projects') {
    if (ws.dirs.length < 2) {
      toast(t('只有一个工作目录,无处可移动'), 'error')
      return
    }
    moveTargetOpen.value = true
  } else {
    void (async () => {
      if (isTauri) {
        const { pickDirectory } = await import('@/core/platform')
        const parent = await pickDirectory(t('选择移动到的位置'))
        if (!parent) return
      } else {
        // 安卓目录搬移在应用数据目录内进行
      }
      const parent = isTauri
        ? await import('@/core/platform').then((m) => m.pickDirectory(t('选择移动到的位置')).then((d) => d))
        : 'AlbumarkMoved'
      if (!parent) return
      const n = await ws.moveDirs(selectedDirs.value, parent)
      toast(n ? t('已移动 {0} 个目录', n) : t('移动失败'), n ? 'success' : 'error')
      exitSelect()
    })()
  }
}

async function confirmMoveProjects(): Promise<void> {
  const target = moveDirChoice.value
  moveTargetOpen.value = false
  if (!target) return
  const n = await ws.moveProjects(selectedProjects.value, target)
  toast(n ? t('已移动 {0} 个项目', n) : t('移动失败'), n ? 'success' : 'error')
  exitSelect()
}

const moveDirChoice = ref<WorkDirMeta | null>(null)

function batchDelete(): void {
  confirmBatchDelete.value = true
}

async function confirmBatchDeleteRun(): Promise<void> {
  confirmBatchDelete.value = false
  if (selectScope.value === 'projects') {
    const n = await ws.removeProjects(selectedProjects.value)
    toast(n ? t('已删除 {0} 个项目', n) : t('删除失败'), n ? 'success' : 'error')
  } else {
    ws.removeDirs(selectedDirs.value)
    toast(t('已移除 {0} 条目录记录', selectedDirs.value.length), 'success')
  }
  exitSelect()
}

async function batchExport(): Promise<void> {
  const scope = selectScope.value
  if (!scope || exporting.value) return
  exporting.value = true
  try {
    const { pickSavePath } = await import('@/core/platform')
    const [{ zipFoldersTo }, { openWriter }] = await Promise.all([
      import('@/core/archive'),
      import('@/core/fs'),
    ])
    if (scope === 'projects') {
      const roots = selectedProjects.value.map((p) => ({ name: p.name, path: p.path }))
      if (isTauri) {
        const dest = await pickSavePath('Albumark-projects.zip')
        if (!dest) return
        const w = await openWriter(dest, false)
        try {
          await zipFoldersTo(roots, (chunk) => w.write(chunk))
        } finally {
          await w.close()
        }
        toast(t('已导出 {0} 个项目', roots.length), 'success')
      } else {
        const w = await openWriter(`Albumark/exports/projects_${Date.now()}.zip`, true)
        try {
          await zipFoldersTo(roots, (chunk) => w.write(chunk))
        } finally {
          await w.close()
        }
        toast(t('已导出 {0} 个项目到 Documents/Albumark/exports', roots.length), 'success')
      }
    } else {
      const roots = selectedDirs.value.map((d) => ({ name: d.name, path: d.path }))
      if (isTauri) {
        const dest = await pickSavePath('Albumark-directories.zip')
        if (!dest) return
        const w = await openWriter(dest, false)
        try {
          await zipFoldersTo(roots, (chunk) => w.write(chunk))
        } finally {
          await w.close()
        }
        toast(t('已导出 {0} 个目录', roots.length), 'success')
      } else {
        const w = await openWriter(`Albumark/exports/dirs_${Date.now()}.zip`, true)
        try {
          await zipFoldersTo(roots, (chunk) => w.write(chunk))
        } finally {
          await w.close()
        }
        toast(t('已导出 {0} 个目录到 Documents/Albumark/exports', roots.length), 'success')
      }
    }
  } catch (e) {
    toast(t('导出失败:{0}', e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    exporting.value = false
  }
}
const renameName = ref('')
/** 导出目标：交给 ExportProjectDialog */
const exportTarget = ref<{ kind: 'project' | 'dir'; name: string; path: string } | null>(null)
/** 导入工作项目对话框（ZIP / 桌面端文件夹 → 当前工作目录） */
const importOpen = ref(false)

/* ---------- 两级页面：工作目录页 ⇄ 工作项目页 ---------- */

/** 两级页过渡的容器：高度由内容决定。目录页（矮列表）⇄ 项目页（高网格）
 *  高度差很大，切换瞬间高度突变会让 .ws-page 的垂直居中排版整体跳一下 */
const projectsWrap = ref<HTMLElement | null>(null)

/** 切换方向决定过渡编排：进项目页推入、回目录页弹出，路径对称可回放。
 *  flush pre 在 DOM 更新前触发——此刻旧页仍独占文档流，是容器旧高度
 *  唯一可靠的测量点（过渡开始后两页短暂同流，测出的混合高度不可用） */
const navDir = ref<'push' | 'pop'>('push')
let wrapH0 = 0
watch(
  () => ws.subPage,
  (v) => {
    navDir.value = v === 'projects' ? 'push' : 'pop'
    wrapH0 = projectsWrap.value?.offsetHeight ?? 0
  },
)

/** 高度过渡时长与 CSS 侧对齐（reduce 档降为 200ms 纯透明度） */
function wspHeightMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 300
}

/** 入场开始时锁定容器高度并过渡到新页自然高度。
 *  Vue Transition 的执行顺序是旧页先离场、新页后插入——before-leave
 *  时新页还不在 DOM，测不到目标高度；enter 钩子在 patch 完成后的
 *  微任务尾段、浏览器渲染首帧之前触发，此刻新页（el）已在流内，
 *  offsetHeight 即其自然高度（transform/opacity 不影响）。
 *  消除的是「撑高 / 塌缩」的瞬间跳动：居中位置随高度一起渐变。
 *  快速反向切换时 wrapH0 读到的是过渡中间态（offsetHeight 即当前布局值），
 *  新过渡天然从当前高度续接，不回跳——高度是布局动画，成本仅限本容器
 *  子树（两页均为静态文本布局），换来零跳动 */
function onWspEnter(el: Element): void {
  const wrap = projectsWrap.value
  if (!wrap || wrapH0 <= 0) return
  const to = el instanceof HTMLElement ? el.offsetHeight : 0
  if (to <= 0 || Math.abs(to - wrapH0) < 1) return
  wrap.style.height = `${wrapH0}px`
  wrap.style.transition = `height ${wspHeightMs()}ms var(--ease-soft)`
  void wrap.offsetHeight // 强制布局，确保过渡从旧高度起步
  wrap.style.height = `${to}px`
}

/** 任一页过渡结束都清锁高（幂等）：auto 恰为新页自然高度，回落无跳 */
function onWspAfterEnter(): void {
  clearWspHeight()
}
function onWspAfterLeave(): void {
  clearWspHeight()
}
function clearWspHeight(): void {
  const wrap = projectsWrap.value
  if (!wrap) return
  wrap.style.height = ''
  wrap.style.transition = ''
}

/** 点击目录行 / 「使用」：切换到该目录并进入工作项目页。
 *  ⋯ 触发器与其下拉面板上的点击不算「进入目录」——不能在这里
 *  @click.stop 截断（会连带拦掉下拉组件自身的 toggle，菜单打不开） */
function onDirRowClick(d: WorkDirMeta, e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (t?.closest('.dir-tool, .dropdown-menu')) return
  // 多选模式:行点击 = 选中切换,不再进入目录
  if (selectScope.value === 'dirs') {
    toggleSel(d.path)
    return
  }
  enterDir(d)
}

/** 正在打开的工作目录：扫描完成前不切页——项目数量不同时，先切页会拿
 *  旧目录的项目列表撑高度，扫描结果随后突变，正好砸在高度过渡的收尾上 */
const switchingDir = ref<string | null>(null)

function enterDir(d: WorkDirMeta): void {
  void openDir(d)
}

async function openDir(d: WorkDirMeta): Promise<void> {
  if (switchingDir.value) return
  if (ws.dir?.path !== d.path) {
    switchingDir.value = d.path
    try {
      // 先让目标目录的项目列表就绪，再开始推入过渡：新页首帧就是最终高度，
      // 后续不再有数组突变把容器撑高 / 塌缩
      await ws.useDir(d)
    } finally {
      switchingDir.value = null
    }
  }
  ws.gotoSubPage('projects')
}

function gotoDirs(): void {
  ws.gotoSubPage('dirs')
}

/** 项目卡点击:多选模式切换选中,普通模式打开项目 */
function onPrjCardClick(p: ProjectMeta): void {
  if (selectScope.value === 'projects') {
    toggleSel(p.id)
    return
  }
  void ws.openProject(p)
}

function startRename(kind: 'project' | 'dir', meta: ProjectMeta | WorkDirMeta): void {
  renameTarget.value = { kind, meta }
  renameName.value = meta.name
}

async function confirmRename(): Promise<void> {
  const t = renameTarget.value
  if (!t) return
  const ok =
    t.kind === 'project'
      ? await ws.renameProject(t.meta as ProjectMeta, renameName.value)
      : await ws.renameDir(t.meta as WorkDirMeta, renameName.value)
  if (ok) renameTarget.value = null
}

async function confirmEmoji(emoji: string): Promise<void> {
  const t = emojiTarget.value
  if (!t) return
  const ok =
    t.kind === 'project'
      ? await ws.setProjectEmoji(t.meta as ProjectMeta, emoji)
      : await ws.setDirEmoji(t.meta as WorkDirMeta, emoji)
  if (ok) emojiTarget.value = null
}

async function clearEmoji(): Promise<void> {
  const t = emojiTarget.value
  if (!t) return
  const ok =
    t.kind === 'project'
      ? await ws.setProjectEmoji(t.meta as ProjectMeta, '')
      : await ws.setDirEmoji(t.meta as WorkDirMeta, '')
  if (ok) emojiTarget.value = null
}

/* 移动端长按菜单：触屏上 ⋯ 按钮不可见（hover 永不出现），长按是唯一入口。
   菜单项与桌面下拉一致；目录的「删除」沿用「移除记录」语义（不删文件），
   正在使用中的目录没有「打开」 */
const coarseQuery = window.matchMedia('(pointer: coarse)')
const isCoarse = ref(coarseQuery.matches)
function onCoarseChange(e: MediaQueryListEvent): void {
  isCoarse.value = e.matches
}

/** 桌面端在系统文件管理器中定位文件夹（移动端无入口） */
function revealPath(path: string): void {
  if (!isTauri) return
  void revealInFolder(path).catch(() => toast(t('无法在文件管理器中显示'), 'error'))
}

function copyOneProject(p: ProjectMeta): void {
  void ws.copyProjects([p]).then((n) => {
    if (n) toast(t('已复制 {0} 个项目', n), 'success')
  })
}

/** 项目右键 / ⋯ 菜单共用同一份条目 */
function projectMenuItems(p: ProjectMeta): ContextMenuItem[] {
  return [
    { label: t('打开'), action: () => void ws.openProject(p) },
    { label: t('编辑信息…'), action: () => openEditInfo(p) },
    { label: t('重命名'), action: () => startRename('project', p) },
    { label: t('设置图标…'), action: () => (emojiTarget.value = { kind: 'project', meta: p }) },
    { label: t('导出…'), action: () => (exportTarget.value = { kind: 'project', name: p.name, path: p.path }) },
    { label: t('复制项目'), action: () => copyOneProject(p) },
    ...(isTauri
      ? [{ label: t('在文件管理器中显示'), action: () => revealPath(p.path) }]
      : []),
    { label: t('删除'), danger: true, action: () => (removeTarget.value = { id: p.id, name: p.name }) },
  ]
}

function openProjectMenu(p: ProjectMeta, x: number, y: number): void {
  openCtxMenu(x, y, projectMenuItems(p))
}

/** 目录右键 / ⋯ 菜单共用同一份条目 */
function dirMenuItems(d: WorkDirMeta): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (ws.dir?.path !== d.path) items.push({ label: t('打开'), action: () => enterDir(d) })
  else items.push({ label: t('进入项目'), action: () => ws.gotoSubPage('projects') })
  items.push(
    { label: t('重命名'), action: () => startRename('dir', d) },
    { label: t('设置图标…'), action: () => (emojiTarget.value = { kind: 'dir', meta: d }) },
    { label: t('导出…'), action: () => (exportTarget.value = { kind: 'dir', name: d.name, path: d.path }) },
    ...(isTauri
      ? [{ label: t('在文件管理器中显示'), action: () => revealPath(d.path) }]
      : []),
    { label: t('移除记录'), danger: true, action: () => (removeDirTarget.value = d) },
  )
  return items
}

function openDirMenu(d: WorkDirMeta, x: number, y: number): void {
  openCtxMenu(x, y, dirMenuItems(d))
}

const dirPress = useLongPress((e) => {
  const row = (e.target as HTMLElement | null)?.closest?.('[data-dir-path]') as HTMLElement | null
  const d = ws.dirs.find((x) => x.path === row?.dataset.dirPath)
  if (d) openDirMenu(d, e.clientX, e.clientY)
})
const prjPress = useLongPress((e) => {
  const card = (e.target as HTMLElement | null)?.closest?.('[data-prj-id]') as HTMLElement | null
  const p = ws.projects.find((x) => x.id === card?.dataset.prjId)
  if (p) openProjectMenu(p, e.clientX, e.clientY)
})

onMounted(() => {
  coarseQuery.addEventListener('change', onCoarseChange)
})
onBeforeUnmount(() => {
  coarseQuery.removeEventListener('change', onCoarseChange)
})

function fmtDate(t: number): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/* ---------- 卡片布局（设置页「外观」里的列数 / 高度 / 圆角） ---------- */
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${settings.projectCardColumns}, minmax(0, 1fr))`,
}))
const cardStyle = computed(() => ({
  height: `${settings.projectCardHeight}px`,
  borderRadius: `${settings.projectCardRadius}px`,
}))

/** 体积与缩略图按需刷新：工作区页面可见、项目/目录列表或相关设置变化时 */
watch(
  () => [
    step.value,
    ws.subPage,
    ws.projects.map((p) => `${p.id}|${p.path}|${p.count}|${p.coverStoredAs ?? p.coverSourcePath ?? ''}`).join(','),
    ws.dirs.map((d) => `${d.path}|${d.projects ?? 0}`).join(','),
    settings.showFileSizes,
    settings.projectCardStyle,
  ],
  () => {
    if (step.value === 'projects') void ws.refreshStats()
  },
  { immediate: true },
)

function sizeText(bytes: number | null | undefined): string {
  return bytes == null ? '…' : fmtSize(bytes)
}

onMounted(() => {
  if (isTauri) void ws.probeDefaultDataDir()
})
</script>

<template>
  <div class="ws-page">
    <Transition name="fwd" mode="out-in">
      <!-- ① OOBE：软件数据位置（仅桌面） -->
      <div v-if="step === 'oobe'" key="oobe" class="card">
        <LogoMark class="mark" animated />
        <h1>{{ t('欢迎使用 Albumark') }}</h1>

        <div class="oobe-dir">
          <HardDrive :size="16" />
          <div class="dir-text">
            <span class="dir-label">{{ t('数据位置') }}</span>
            <span class="dir-path">{{ oobeDir }}</span>
          </div>
          <AppButton size="sm" @click="pickDataDir">{{ t('浏览…') }}</AppButton>
        </div>

        <AppButton variant="primary" class="cta" @click="finishOobe">
          {{ t('开始使用') }}<ArrowRight :size="15" />
        </AppButton>
      </div>

      <!-- ② 工作区：工作目录页 ⇄ 工作项目页 两级导航 -->
      <div v-else key="projects" class="projects-wrap" ref="projectsWrap">
        <Transition
          :name="navDir === 'push' ? 'wsp-push' : 'wsp-pop'"
          @enter="onWspEnter"
          @after-enter="onWspAfterEnter"
          @after-leave="onWspAfterLeave"
        >
          <!-- 页面 ①：工作目录（列表式管理，点击行进入该项目目录的工作项目页） -->
          <section v-if="fsAvailable && ws.subPage === 'dirs'" key="dirs" class="card grow subpage">
            <header class="sec-head">
              <div class="sec-title">
                <FolderOpen :size="15" />
                <h1>{{ t('工作目录') }}</h1>
                <span class="sec-count">{{ ws.dirs.length }}</span>
              </div>
              <div class="sec-actions">
                <template v-if="selectScope === 'dirs'">
                  <span class="sel-count">{{ t('已选 {0}', selectedCount) }}</span>
                  <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchCopy">
                    <Copy :size="13" />{{ t('复制') }}
                  </AppButton>
                  <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchMove">
                    <FolderInput :size="13" />{{ t('移动') }}
                  </AppButton>
                  <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchExport">
                    <Archive :size="13" />{{ t('导出') }}
                  </AppButton>
                  <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchDelete">
                    <Trash2 :size="13" />{{ t('移除') }}
                  </AppButton>
                  <AppButton size="sm" variant="ghost" @click="selectAllVisible">{{ t('全选') }}</AppButton>
                  <AppButton size="sm" variant="primary" @click="exitSelect">{{ t('完成') }}</AppButton>
                </template>
                <template v-else>
                  <!-- 多选固定在添加按钮左侧：两个按钮同属一组，位置不随标题宽度漂移 -->
                  <AppButton size="sm" variant="ghost" @click="enterSelect('dirs')">
                    <SquareDashed :size="13" />{{ t('多选') }}
                  </AppButton>
                  <div v-if="sandboxedFs" class="create-inline">
                    <input
                      v-model="newDirName"
                      class="text-input"
                      :placeholder="t('新目录名称')"
                      @keyup.enter="addDir"
                    />
                    <AppButton size="sm" variant="primary" :disabled="!newDirName.trim()" @click="addDir">
                      <FolderPlus :size="14" />{{ t('新建') }}
                    </AppButton>
                  </div>
                  <AppButton v-else size="sm" variant="ghost" @click="addDir">
                    <FolderPlus :size="13" />{{ t('添加工作目录…') }}
                  </AppButton>
                </template>
              </div>
            </header>

            <!-- 选择条下的提示:进入多选后行点击变选中,不再进入目录 -->
            <p v-if="selectScope === 'dirs'" class="select-hint">
              {{ t('点选或拖框选择目录，操作按钮在上方') }}
            </p>
            <div class="search-row">
              <Search :size="13" class="search-ic" />
              <input
                v-model="dirQuery"
                class="search-input"
                :placeholder="t('搜索工作目录…')"
                @keyup.esc="dirQuery = ''"
              />
              <button v-if="dirQuery" class="search-clear" :title="t('清除搜索')" @click="dirQuery = ''">
                <X :size="12" />
              </button>
            </div>
            <ul v-if="filteredDirs.length" class="dir-list" @pointerdown="onRubberDown('dirs', $event)">
              <li
                v-for="d in filteredDirs"
                :key="d.path"
                class="dir-row"
                :class="{ active: !isSelecting && ws.dir?.path === d.path, selecting: selectScope === 'dirs' && selected.has(d.path) }"
                :aria-busy="switchingDir === d.path"
                :data-dir-path="d.path"
                @click="onDirRowClick(d, $event)"
                @contextmenu.prevent="openDirMenu(d, $event.clientX, $event.clientY)"
                v-on="dirPress"
              >
                <span
                  v-if="selectScope === 'dirs'"
                  class="sel-dot"
                  :class="{ on: selected.has(d.path) }"
                  role="checkbox"
                  :aria-checked="selected.has(d.path)"
                >
                  <Check v-if="selected.has(d.path)" :size="12" />
                </span>
                <span class="dir-icon" :class="{ emoji: !!d.emoji }">
                  <template v-if="d.emoji">{{ d.emoji }}</template>
                  <FolderOpen v-else :size="14" />
                </span>
                <div class="dir-main">
                  <span class="dir-name">{{ d.name }}</span>
                  <span class="dir-path" :title="d.path">{{ d.path }}</span>
                </div>
                <LoaderCircle v-if="switchingDir === d.path" :size="13" class="dir-spin" />
                <span v-else class="dir-count">
                  {{ t('{0} 个项目', d.projects ?? '—') }}<template v-if="settings.showFileSizes"> · {{ sizeText(ws.dirSizes[d.path]) }}</template>
                </span>
                <AppDropdown
                  v-if="!isCoarse && selectScope !== 'dirs'"
                  align="right"
                  :items="dirMenuItems(d)"
                >
                  <!-- span 触发器：AppDropdown 外层已有 button，slot 内不可再嵌 button，
                       也不能裸 @click.stop——冒泡被截断菜单永远打不开（与项目卡触发器同构） -->
                  <template #trigger>
                    <span class="dir-tool" role="button" :title="t('目录操作')">
                      <MoreHorizontal :size="13" />
                    </span>
                  </template>
                </AppDropdown>
              </li>
            </ul>
            <p v-else class="empty">
              {{ dirQuery ? t('没有匹配的工作目录') : t('还没有工作目录') }}
            </p>
            <div
              v-if="rubberStyle && selectScope === 'dirs'"
              class="rubber"
              :style="rubberStyle"
              aria-hidden="true"
            ></div>
          </section>

          <!-- 页面 ②：工作项目（返回可回工作目录页；安卓侧滑返回同一层级） -->
          <section v-else key="projects" class="card grow subpage">
            <template v-if="fsAvailable && ws.dir">
              <header class="sec-head">
                <div class="sec-title">
                  <button class="back-btn" :title="t('返回工作目录')" @click="gotoDirs">
                    <ArrowLeft :size="15" />
                  </button>
                  <h1>{{ t('工作项目') }}</h1>
                  <span class="sec-count">{{ ws.projects.length }}</span>
                </div>
                <div class="sec-actions">
                  <template v-if="selectScope === 'projects'">
                    <span class="sel-count">{{ t('已选 {0}', selectedCount) }}</span>
                    <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchCopy">
                      <Copy :size="13" />{{ t('复制') }}
                    </AppButton>
                    <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchMove">
                      <FolderInput :size="13" />{{ t('移动') }}
                    </AppButton>
                    <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchExport">
                      <Archive :size="13" />{{ t('导出') }}
                    </AppButton>
                    <AppButton size="sm" variant="ghost" :disabled="!selectedCount" @click="batchDelete">
                      <Trash2 :size="13" />{{ t('删除') }}
                    </AppButton>
                    <AppButton size="sm" variant="ghost" @click="selectAllVisible">{{ t('全选') }}</AppButton>
                    <AppButton size="sm" variant="primary" @click="exitSelect">{{ t('完成') }}</AppButton>
                  </template>
                  <template v-else>
                    <!-- 多选固定在导入项目左侧：两者同属一组，位置不随标题宽度漂移 -->
                    <AppButton size="sm" variant="ghost" @click="enterSelect('projects')">
                      <SquareDashed :size="13" />{{ t('多选') }}
                    </AppButton>
                    <AppButton size="sm" variant="ghost" @click="importOpen = true">
                      <ArchiveRestore :size="13" />{{ t('导入项目') }}
                    </AppButton>
                  </template>
                </div>
              </header>
              <p class="cur-dir">{{ ws.dir.emoji ? `${ws.dir.emoji} ` : '' }}{{ ws.dir.name }}</p>
              <p v-if="selectScope === 'projects'" class="select-hint">
                {{ t('点选或拖框选择项目，操作按钮在上方') }}
              </p>

            <div class="search-row">
              <Search :size="13" class="search-ic" />
              <input
                v-model="prjQuery"
                class="search-input"
                :placeholder="t('搜索工作项目…')"
                @keyup.esc="prjQuery = ''"
              />
              <button v-if="prjQuery" class="search-clear" :title="t('清除搜索')" @click="prjQuery = ''">
                <X :size="12" />
              </button>
            </div>

            <div class="create">
              <input
                v-model="newName"
                class="text-input"
                :placeholder="t('新项目名称，如「2026 春季扫街」')"
                @keyup.enter="create"
              />
              <AppButton variant="primary" :disabled="!canCreate" @click="create">
                <FolderPlus :size="15" />{{ t('新建项目') }}
              </AppButton>
            </div>

            <div
              v-if="filteredProjects.length"
              class="grid"
              :style="gridStyle"
              @pointerdown="onRubberDown('projects', $event)"
            >
              <!-- div[role=button]：卡片内要挂操作菜单，button 不能嵌套 button -->
              <div
                v-for="p in filteredProjects"
                :key="p.id"
                class="prj-card"
                :class="[
                  `style-${settings.projectCardStyle}`,
                  { selecting: selectScope === 'projects' && selected.has(p.id) },
                ]"
                role="button"
                tabindex="0"
                :style="cardStyle"
                :data-prj-id="p.id"
                @click="onPrjCardClick(p)"
                @keyup.enter="onPrjCardClick(p)"
                @contextmenu.prevent="openProjectMenu(p, $event.clientX, $event.clientY)"
                v-on="prjPress"
              >
                <div
                  v-if="settings.projectCardStyle === 'thumbnail' && ws.projectThumbs[p.id]"
                  class="prj-cover"
                  :style="{ backgroundImage: `url(${ws.projectThumbs[p.id]})` }"
                  aria-hidden="true"
                ></div>
                <div
                  v-if="settings.projectCardStyle === 'thumbnail' && ws.projectThumbs[p.id]"
                  class="prj-wash"
                  aria-hidden="true"
                ></div>
                <span
                  v-if="selectScope === 'projects'"
                  class="sel-dot"
                  :class="{ on: selected.has(p.id) }"
                  role="checkbox"
                  :aria-checked="selected.has(p.id)"
                >
                  <Check v-if="selected.has(p.id)" :size="12" />
                </span>
                <span class="prj-icon" :class="{ emoji: !!p.emoji }">
                  <template v-if="p.emoji">{{ p.emoji }}</template>
                  <Images v-else :size="17" />
                </span>
                <span class="prj-name">{{ p.name }}</span>
                <span v-if="p.description" class="prj-desc">{{ p.description }}</span>
                <span class="prj-count">
                  {{ t('{0} 张照片', p.count) }}<template v-if="settings.showFileSizes"> · {{ sizeText(ws.projectSizes[p.id]) }}</template>
                </span>
                <span v-if="p.createdAt" class="prj-date">{{ fmtDate(p.createdAt) }}</span>
                <AppDropdown
                  v-if="!isCoarse && selectScope !== 'projects'"
                  class="prj-menu"
                  align="right"
                  :items="projectMenuItems(p)"
                >
                  <template #trigger>
                    <span class="prj-rm" role="button" :aria-label="t('项目操作')" :title="t('重命名 / 导出 / 删除')">
                      <MoreHorizontal :size="13" />
                    </span>
                  </template>
                </AppDropdown>
              </div>
            </div>
            <p v-else class="empty">
              {{ prjQuery ? t('没有匹配的工作项目') : t('这个目录里还没有工作项目') }}
            </p>
            <div
              v-if="rubberStyle && selectScope === 'projects'"
              class="rubber"
              :style="rubberStyle"
              aria-hidden="true"
            ></div>
          </template>

          <template v-else-if="fsAvailable && !sandboxedFs">
            <div class="glyph">
              <FolderOpen :size="30" :stroke-width="1.6" />
            </div>
            <h1>{{ t('选择工作目录') }}</h1>
            <AppButton variant="primary" class="cta" :disabled="ws.loading" @click="addDir">
              <FolderPlus :size="15" />{{ t('选择文件夹…') }}
            </AppButton>
            <AppButton variant="ghost" class="cta" @click="gotoDirs">
              <ArrowLeft :size="15" />{{ t('返回工作目录') }}
            </AppButton>
          </template>

          <template v-else-if="fsAvailable">
            <div class="glyph">
              <FolderOpen :size="30" :stroke-width="1.6" />
            </div>
            <h1>{{ t('选择工作目录') }}</h1>
            <AppButton variant="ghost" class="cta" @click="gotoDirs">
              <ArrowLeft :size="15" />{{ t('返回工作目录') }}
            </AppButton>
          </template>

          <template v-else>
            <h1>{{ t('开始辑录') }}</h1>
            <AppButton variant="primary" class="cta" @click="ws.openEphemeralProject()">
              <Layers :size="15" />{{ t('进入临时项目') }}
            </AppButton>
          </template>
        </section>
        </Transition>
      </div>
    </Transition>

    <!-- 打开项目 / 切换目录：页面级加载提示 -->
    <Transition name="fade">
      <div v-if="ws.loading" class="page-loading" aria-hidden="true">
        <span class="page-spin" />
        <p>{{ t('正在打开…') }}</p>
      </div>
    </Transition>

    <!-- 移除工作目录记录 -->
    <AppDialog :open="!!removeDirTarget" :title="t('移除工作目录')" :width="380" @close="removeDirTarget = null">
      <p class="confirm-text">
        {{ t('将从列表中移除「{0}」的记录。磁盘上的文件夹与项目不会被删除。', removeDirTarget?.name) }}
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeDirTarget = null">{{ t('取消') }}</AppButton>
        <AppButton variant="danger" @click="confirmRemoveDir"><Trash2 :size="13" />{{ t('移除记录') }}</AppButton>
      </div>
    </AppDialog>

    <!-- 删除工作项目：桌面移入系统回收站；移动端没有回收站，直接删除并明确警示 -->
    <AppDialog :open="!!removeTarget" :title="t('删除工作项目')" :width="380" @close="removeTarget = null">
      <p class="confirm-text">
        <template v-if="isTauri">
          {{ t('将把文件夹「{0}」及其中的全部照片移入回收站。确定删除吗？', removeTarget?.name) }}
        </template>
        <template v-else>
          {{ t('移动端没有回收站，项目「{0}」及其中的全部照片将被', removeTarget?.name) }}<strong>{{ t('直接删除') }}</strong>{{ t('，此操作') }}<strong>{{ t('不可撤销') }}</strong>{{ t('。') }}
        </template>
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeTarget = null">{{ t('取消') }}</AppButton>
        <AppButton variant="danger" @click="confirmRemove">
          <Trash2 :size="13" />{{ isTauri ? t('移入回收站') : t('直接删除') }}
        </AppButton>
      </div>
    </AppDialog>

    <!-- 重命名：目录与项目共用，确认后磁盘改名并同步记录 -->
    <AppDialog
      :open="!!renameTarget"
      :title="renameTarget?.kind === 'dir' ? t('重命名工作目录') : t('重命名工作项目')"
      :width="380"
      @close="renameTarget = null"
    >
      <input
        v-model="renameName"
        class="text-input"
        :placeholder="t('新名称')"
        @keyup.enter="confirmRename"
      />
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="renameTarget = null">{{ t('取消') }}</AppButton>
        <AppButton variant="primary" @click="confirmRename"><Pencil :size="13" />{{ t('重命名') }}</AppButton>
      </div>
    </AppDialog>

    <!-- 编辑信息：项目名 / 简介 / emoji 图标一次编辑 -->
    <AppDialog
      :open="!!editInfoTarget"
      :title="t('编辑项目信息')"
      :width="440"
      @close="editInfoTarget = null"
    >
      <div class="edit-info">
        <label class="field">
          <span class="field-label">{{ t('名称') }}</span>
          <input v-model="editName" class="text-input" :placeholder="t('项目名称')" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('简介（可选）') }}</span>
          <textarea
            v-model="editDesc"
            class="text-input area"
            rows="2"
            :placeholder="t('一句话介绍这个项目')"
          ></textarea>
        </label>
        <div class="field">
          <span class="field-label">{{ t('图标（可选）') }}</span>
          <EmojiPicker
            :model-value="editEmoji"
            @pick="editEmoji = $event"
            @clear="editEmoji = ''"
          />
        </div>
      </div>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="editInfoTarget = null">{{ t('取消') }}</AppButton>
        <AppButton variant="primary" :disabled="!editName.trim()" @click="confirmEditInfo">
          <Check :size="13" />{{ t('保存') }}
        </AppButton>
      </div>
    </AppDialog>

    <!-- 多选:批量删除二次确认(项目按平台区分回收站 / 直接删除文案) -->
    <AppDialog
      :open="confirmBatchDelete"
      :title="selectScope === 'dirs' ? t('移除目录记录') : t('删除工作项目')"
      :width="400"
      @close="confirmBatchDelete = false"
    >
      <p class="confirm-text">
        <template v-if="selectScope === 'dirs'">
          {{ t('将移除 {0} 条工作目录记录。磁盘上的文件夹与项目不会被删除。', selectedCount) }}
        </template>
        <template v-else-if="isTauri">
          {{ t('将把 {0} 个项目文件夹移入系统回收站。确定删除吗？', selectedCount) }}
        </template>
        <template v-else>
          {{ t('移动端没有回收站，{0} 个项目将被', selectedCount) }}<strong>{{ t('直接删除') }}</strong>{{ t('，此操作') }}<strong>{{ t('不可撤销') }}</strong>{{ t('。确定删除吗？') }}
        </template>
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="confirmBatchDelete = false">{{ t('取消') }}</AppButton>
        <AppButton variant="danger" @click="confirmBatchDeleteRun">
          <Trash2 :size="13" />{{ selectScope === 'dirs' ? t('移除记录') : isTauri ? t('移入回收站') : t('直接删除') }}
        </AppButton>
      </div>
    </AppDialog>

    <!-- 多选:项目移动目标目录选择 -->
    <AppDialog :open="moveTargetOpen" :title="t('移动到工作目录')" :width="380" @close="moveTargetOpen = false">
      <ul class="move-list">
        <li v-for="d in ws.dirs" :key="d.path">
          <button
            class="move-item"
            :class="{ on: d.path === ws.dir?.path }"
            :disabled="d.path === ws.dir?.path"
            @click="moveDirChoice = d; confirmMoveProjects()"
          >
            <span v-if="d.emoji" class="move-emoji">{{ d.emoji }}</span>
            <FolderOpen v-else :size="14" />
            <span class="move-name">{{ d.path === ws.dir?.path ? t('{0}（当前）', d.name) : d.name }}</span>
            <span class="move-count">{{ t('{0} 个项目', d.projects ?? '—') }}</span>
          </button>
        </li>
      </ul>
    </AppDialog>

    <!-- 设置 emoji 图标：目录与项目共用一个选择器，选择即保存 -->
    <AppDialog
      :open="!!emojiTarget"
      :title="emojiTarget?.kind === 'dir' ? t('目录图标') : t('项目图标')"
      :width="420"
      @close="emojiTarget = null"
    >
      <EmojiPicker
        :model-value="emojiTarget?.meta.emoji"
        @pick="confirmEmoji"
        @clear="clearEmoji"
      />
    </AppDialog>

    <!-- 导出：文件详情 + ZIP/文件夹选择，确认后打包或复制 -->
    <ExportProjectDialog :open="!!exportTarget" :target="exportTarget" @close="exportTarget = null" />
    <ImportProjectDialog :open="importOpen" @close="importOpen = false" />
  </div>
</template>

<style scoped>
.ws-page {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--canvas);
  overflow-y: auto;
  /* 滚动条常驻两侧留白：内容高度随项目数量变化时不再挤压居中排版。
     否则每次切页滚动条出现 / 消失都会让页面横向抖一下，和入场动画叠在一起就是闪烁 */
  scrollbar-gutter: stable both-edges;
}
.card {
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 34px 30px;
  border-radius: var(--r-l);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-2);
}
/* 两级页卡片:多选框选覆盖层的定位基准 */
.card.grow.subpage {
  position: relative;
}
.card.grow {
  width: 100%;
  align-self: stretch;
  text-align: left;
  align-items: stretch;
  padding: 22px 24px;
}
.projects-wrap {
  width: min(860px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
/* 右侧动作组：多选 / 导入 等按钮成组靠右，间距一致，
   不与标题平分剩余空间（space-between 会把中间那颗按钮甩到中线） */
.sec-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
  flex-wrap: wrap;
}
.sec-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
}
.sec-title h1 {
  font-size: calc(15px * var(--ui-zoom, 1));
  font-weight: 600;
  color: var(--text);
}
.sec-count {
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: var(--hover);
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.create-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.create-inline .text-input {
  width: 160px;
}
/* 工作目录列表 */
.dir-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dir-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--bg);
  /* 整行可点：进入该目录的工作项目页（⋯ 菜单与下拉已按点击来源放行） */
  cursor: pointer;
  transition: border-color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.dir-row:hover {
  border-color: var(--line-strong);
  background: var(--hover);
}
.dir-row.active {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.dir-row.active .dir-icon {
  color: var(--accent);
}
.dir-icon {
  display: grid;
  place-items: center;
  color: var(--text-3);
  flex: none;
}

/* ---------- 多选模式 ---------- */
.sel-count {
  flex: none;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.select-hint {
  margin: -4px 0 0;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.rubber {
  position: absolute;
  z-index: 5;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 3px;
  pointer-events: none;
}
.sel-dot {
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  /* deslop-ignore-next-line 19 —— 圆形选择圈，与基线内圆形控件同一有意设计 */
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  color: transparent;
  transition: background var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft);
}
.sel-dot.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.dir-row.selecting {
  background: var(--hover);
}
.prj-card.selecting {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.prj-card .sel-dot {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 3;
}
.prj-desc {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 编辑信息对话框 */
.edit-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.edit-info .field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.edit-info .field-label {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.text-input.area {
  resize: vertical;
  min-height: 52px;
  font-family: inherit;
  line-height: 1.5;
}

/* 移动目标目录选择 */
.move-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.move-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-radius: var(--r-m);
  color: var(--text-2);
  text-align: left;
  transition: background var(--dur-hover) var(--ease-soft);
}
.move-item:hover:not(:disabled) {
  background: var(--hover);
}
.move-item.on {
  color: var(--text-3);
  cursor: not-allowed;
}
.move-emoji {
  font-size: calc(14px * var(--ui-zoom, 1));
  flex: none;
}
.move-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.move-count {
  flex: none;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.dir-icon.emoji {
  font-size: calc(16px * var(--ui-zoom, 1));
}
.dir-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dir-name {
  font-size: calc(13px * var(--ui-zoom, 1));
  font-weight: 500;
}
.dir-path {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-count {
  flex: none;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
/* 目录扫描中的就地指示：只在被点的那一行转，不铺全屏遮罩 */
.dir-spin {
  flex: none;
  color: var(--text-3);
  animation: dir-spin 0.9s linear infinite;
}
@keyframes dir-spin {
  to {
    transform: rotate(360deg);
  }
}
.dir-rm {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.dir-rm:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
/* 目录行的操作菜单触发钮：中性悬停（危险动作收进菜单内） */
.dir-tool {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.dir-tool:hover {
  color: var(--text);
  background: var(--hover);
}
.mark {
  width: 108px;
  height: auto;
  margin-bottom: 16px;
  opacity: 0.95;
}
.glyph {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--accent);
  margin-bottom: 14px;
  align-self: center;
}
h1 {
  font-size: calc(21px * var(--ui-zoom, 1));
  letter-spacing: -0.02em;
}
.card.grow h1 {
  font-size: calc(15px * var(--ui-zoom, 1));
  font-weight: 600;
  letter-spacing: 0;
}
.oobe-dir {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 18px;
  padding: 11px 12px;
  border-radius: var(--r-m);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  text-align: left;
}
.dir-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dir-label {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.oobe-dir .dir-path {
  max-width: none;
}
.create {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.text-input {
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
/* 工作区搜索：与输入框同高的小胶囊，图标在左、清除在右 */
.search-row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  margin-bottom: 10px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--bg);
  transition: border-color var(--dur-hover) var(--ease-soft);
}
.search-row:focus-within {
  border-color: var(--accent);
}
.search-ic {
  flex: none;
  color: var(--text-3);
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.search-input:focus-visible {
  outline: none;
}
.search-input::placeholder {
  color: var(--text-3);
}
.search-clear {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: var(--text-3);
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.search-clear:hover {
  color: var(--text);
  background: var(--hover);
}
.prj-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 14px 14px 12px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  background: var(--bg);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft),
    transform var(--dur-fast) var(--ease);
}
.prj-card:hover {
  border-color: var(--line-strong);
  background: var(--hover);
}
.prj-card:active {
  transform: scale(0.98);
}
/* 缩略图卡片：首图铺底，自左上到右下渐显；左上留给图标与文字 */
.prj-cover {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0.82;
  transform: scale(1);
  transform-origin: center;
  -webkit-mask-image: linear-gradient(135deg, transparent 0%, #000 100%);
  mask-image: linear-gradient(135deg, transparent 0%, #000 100%);
  transition:
    opacity 520ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 640ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.prj-card.style-thumbnail:hover .prj-cover {
  opacity: 1;
  transform: scale(1.06);
}
/* 缩略图之上的内容统一抬一层，保证图标 / 名称 / 统计始终可读
   （绝对定位的封面 / 压暗层 / 选框 / 菜单不能套用 relative，否则会破坏原有定位） */
.prj-card > :not(.prj-cover):not(.prj-wash):not(.sel-dot):not(.prj-menu) {
  position: relative;
  z-index: 2;
}
/* 压在封面之上、文字之下的左上渐隐层：首图内容再花，名称与统计也有底。
   前 38% 用实色页面底铺满（文字都落在这一段），随后渐隐到 78%，
   右下仍保留首图的不透明度渐变观感 */
.prj-wash {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    135deg,
    var(--bg) 0%,
    var(--bg) 38%,
    color-mix(in srgb, var(--bg) 62%, transparent) 58%,
    transparent 78%
  );
  pointer-events: none;
}
.prj-icon {
  color: var(--accent);
  margin-bottom: 4px;
}
.prj-icon.emoji {
  font-size: calc(26px * var(--ui-zoom, 1));
}
.prj-name {
  font-size: calc(13px * var(--ui-zoom, 1));
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prj-count {
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.prj-date {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  opacity: 0.8;
}
/* 项目卡右上角的操作菜单：容器负责定位与悬停显现，触发钮只管视觉 */
.prj-menu {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-soft);
}
.prj-card:hover .prj-menu {
  opacity: 1;
}
.prj-rm {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--text-3);
  transition:
    color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft);
}
.prj-rm:hover {
  color: var(--text);
  background: var(--hover);
}
.empty {
  color: var(--text-3);
  padding: 14px 2px;
  font-size: calc(12.5px * var(--ui-zoom, 1));
  line-height: 1.6;
  text-align: center;
}
.cta {
  width: 100%;
  margin-top: 18px;
}
.confirm-text {
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-2);
  line-height: 1.6;
}
.confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* 步骤过渡：前进柔和推进 */
.fwd-enter-active,
.fwd-leave-active {
  transition:
    opacity 300ms var(--ease-soft),
    transform 300ms var(--ease-soft);
}
.fwd-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.fwd-leave-to {
  opacity: 0;
  transform: translateX(-22px);
}

/* ---------- 工作区两级页面切换：推入 / 弹出，路径对称可回放 ----------
   两页同时过渡（不用 out-in）才有「推挤」的空间感：离场页绝对定位脱离
   文档流、入场页正常布局接管高度；位移小、以透明度为主——页面级切换
   保持克制，非线性由 --ease-soft 承担 */
.projects-wrap {
  position: relative;
}
.wsp-push-enter-active,
.wsp-push-leave-active,
.wsp-pop-enter-active,
.wsp-pop-leave-active {
  transition:
    opacity 300ms var(--ease-soft),
    transform 300ms var(--ease-soft);
}
/* 离场页必须脱离文档流叠在新页之上；选择器带上 .card.grow.subpage
   提权——卡片自身的 position: relative（框选基准）优先级更高，
   会被覆盖成 relative，离场页留在流内把两页高度叠在一起，过渡全程炸跳 */
.card.grow.subpage.wsp-push-leave-active,
.card.grow.subpage.wsp-pop-leave-active {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
}
/* 位移幅度不超 .ws-page 的 24px padding：transform 溢出会计入滚动区域，
   超出 padding 就会短暂顶出横向滚动条、挤压内容高度，叠进入场动画里
   就是一下横向抖动。24/20 与 pop 侧保持镜像，路径对称可回放 */
.wsp-push-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.wsp-push-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
.wsp-pop-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}
.wsp-pop-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
@media (prefers-reduced-motion: reduce) {
  .wsp-push-enter-active,
  .wsp-push-leave-active,
  .wsp-pop-enter-active,
  .wsp-pop-leave-active {
    transition: opacity 200ms var(--ease-soft);
  }
  .wsp-push-enter-from,
  .wsp-push-leave-to,
  .wsp-pop-enter-from,
  .wsp-pop-leave-to {
    transform: none;
  }
}

/* 项目页头部：返回按钮 + 当前目录名（层级线索） */
.back-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--text-2);
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.back-btn:hover {
  color: var(--text);
  background: var(--hover);
}
.back-btn:active {
  transform: scale(0.94);
}
.cur-dir {
  margin: -6px 0 10px;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 打开项目 / 扫描中：居中加载提示 */
.page-loading {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.page-loading p {
  margin: 0;
  font-size: calc(12.5px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.page-spin {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid var(--line-strong);
  border-top-color: var(--accent);
  animation: page-spin 0.9s linear infinite;
}
@keyframes page-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .page-spin {
    animation-duration: 2s;
  }
}
</style>
