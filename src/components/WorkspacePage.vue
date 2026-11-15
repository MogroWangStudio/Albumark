<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArchiveRestore,
  ArrowRight,
  Check,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Images,
  Layers,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import EmojiPicker from '@/components/ui/EmojiPicker.vue'
import ExportProjectDialog from '@/components/ExportProjectDialog.vue'
import ImportProjectDialog from '@/components/ImportProjectDialog.vue'
import type { ContextMenuItem } from '@/components/AppContextMenu.vue'
import { useLongPress } from '@/core/longpress'
import { fsAvailable, sandboxedFs } from '@/core/fs'
import { isTauri } from '@/core/platform'
import { openCtxMenu } from '@/stores/ctxMenu'
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
  const d = await pickDirectory('选择软件数据位置')
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
const renameName = ref('')
/** 导出目标：交给 ExportProjectDialog */
const exportTarget = ref<{ kind: 'project' | 'dir'; name: string; path: string } | null>(null)
/** 导入工作项目对话框（ZIP / 桌面端文件夹 → 当前工作目录） */
const importOpen = ref(false)

/* ---------- 两级页面：工作目录页 ⇄ 工作项目页 ---------- */

/** 切换方向决定过渡编排：进项目页推入、回目录页弹出，路径对称可回放 */
const navDir = ref<'push' | 'pop'>('push')
watch(
  () => ws.subPage,
  (v) => {
    navDir.value = v === 'projects' ? 'push' : 'pop'
  },
)

/** 点击目录行 / 「使用」：切换到该目录并进入工作项目页。
 *  ⋯ 触发器与其下拉面板上的点击不算「进入目录」——不能在这里
 *  @click.stop 截断（会连带拦掉下拉组件自身的 toggle，菜单打不开） */
function onDirRowClick(d: WorkDirMeta, e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (t?.closest('.dir-tool, .dropdown-menu')) return
  enterDir(d)
}

function enterDir(d: WorkDirMeta): void {
  if (ws.dir?.path !== d.path) void ws.useDir(d)
  ws.gotoSubPage('projects')
}

function gotoDirs(): void {
  ws.gotoSubPage('dirs')
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

function openProjectMenu(p: ProjectMeta, x: number, y: number): void {
  const items: ContextMenuItem[] = [
    { label: '打开', action: () => void ws.openProject(p) },
    { label: '重命名', action: () => startRename('project', p) },
    { label: '设置图标…', action: () => (emojiTarget.value = { kind: 'project', meta: p }) },
    { label: '导出…', action: () => (exportTarget.value = { kind: 'project', name: p.name, path: p.path }) },
    { label: '删除', danger: true, action: () => (removeTarget.value = { id: p.id, name: p.name }) },
  ]
  openCtxMenu(x, y, items)
}

function openDirMenu(d: WorkDirMeta, x: number, y: number): void {
  const items: ContextMenuItem[] = []
  if (ws.dir?.path !== d.path) items.push({ label: '打开', action: () => enterDir(d) })
  else items.push({ label: '进入项目', action: () => ws.gotoSubPage('projects') })
  items.push(
    { label: '重命名', action: () => startRename('dir', d) },
    { label: '设置图标…', action: () => (emojiTarget.value = { kind: 'dir', meta: d }) },
    { label: '导出…', action: () => (exportTarget.value = { kind: 'dir', name: d.name, path: d.path }) },
    { label: '移除记录', danger: true, action: () => (removeDirTarget.value = d) },
  )
  openCtxMenu(x, y, items)
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
        <h1>欢迎使用 Albumark</h1>

        <div class="oobe-dir">
          <HardDrive :size="16" />
          <div class="dir-text">
            <span class="dir-label">数据位置</span>
            <span class="dir-path">{{ oobeDir }}</span>
          </div>
          <AppButton size="sm" @click="pickDataDir">浏览…</AppButton>
        </div>

        <AppButton variant="primary" class="cta" @click="finishOobe">
          开始使用<ArrowRight :size="15" />
        </AppButton>
      </div>

      <!-- ② 工作区：工作目录页 ⇄ 工作项目页 两级导航 -->
      <div v-else key="projects" class="projects-wrap">
        <Transition :name="navDir === 'push' ? 'wsp-push' : 'wsp-pop'">
          <!-- 页面 ①：工作目录（列表式管理，点击行进入该项目目录的工作项目页） -->
          <section v-if="fsAvailable && ws.subPage === 'dirs'" key="dirs" class="card grow subpage">
            <header class="sec-head">
              <div class="sec-title">
                <FolderOpen :size="15" />
                <h1>工作目录</h1>
                <span class="sec-count">{{ ws.dirs.length }}</span>
              </div>
              <div v-if="sandboxedFs" class="create-inline">
                <input
                  v-model="newDirName"
                  class="text-input"
                  placeholder="新目录名称"
                  @keyup.enter="addDir"
                />
                <AppButton size="sm" variant="primary" :disabled="!newDirName.trim()" @click="addDir">
                  <FolderPlus :size="14" />新建
                </AppButton>
              </div>
              <AppButton v-else size="sm" variant="ghost" @click="addDir">
                <FolderPlus :size="13" />添加工作目录…
              </AppButton>
            </header>

            <ul v-if="ws.dirs.length" class="dir-list">
              <li
                v-for="d in ws.dirs"
                :key="d.path"
                class="dir-row"
                :class="{ active: ws.dir?.path === d.path }"
                :data-dir-path="d.path"
                @click="onDirRowClick(d, $event)"
                v-on="dirPress"
              >
                <span class="dir-icon" :class="{ emoji: !!d.emoji }">
                  <template v-if="d.emoji">{{ d.emoji }}</template>
                  <Check v-else-if="ws.dir?.path === d.path" :size="14" />
                  <FolderOpen v-else :size="14" />
                </span>
                <div class="dir-main">
                  <span class="dir-name">{{ d.name }}</span>
                  <span class="dir-path" :title="d.path">{{ d.path }}</span>
                </div>
                <span class="dir-count">{{ d.projects ?? '—' }} 个项目</span>
                <AppDropdown
                  v-if="!isCoarse"
                  align="right"
                  :items="[
                    { label: '重命名', action: () => startRename('dir', d) },
                    { label: '设置图标…', action: () => (emojiTarget = { kind: 'dir', meta: d }) },
                    { label: '导出…', action: () => (exportTarget = { kind: 'dir', name: d.name, path: d.path }) },
                    { label: '移除记录', danger: true, action: () => (removeDirTarget = d) },
                  ]"
                >
                  <!-- span 触发器：AppDropdown 外层已有 button，slot 内不可再嵌 button，
                       也不能裸 @click.stop——冒泡被截断菜单永远打不开（与项目卡触发器同构） -->
                  <template #trigger>
                    <span class="dir-tool" role="button" title="目录操作">
                      <MoreHorizontal :size="13" />
                    </span>
                  </template>
                </AppDropdown>
              </li>
            </ul>
            <p v-else class="empty">还没有工作目录</p>
          </section>

          <!-- 页面 ②：工作项目（返回可回工作目录页；安卓侧滑返回同一层级） -->
          <section v-else key="projects" class="card grow subpage">
            <template v-if="fsAvailable && ws.dir">
              <header class="sec-head">
                <div class="sec-title">
                  <button class="back-btn" title="返回工作目录" @click="gotoDirs">
                    <ArrowLeft :size="15" />
                  </button>
                  <h1>工作项目</h1>
                  <span class="sec-count">{{ ws.projects.length }}</span>
                </div>
                <AppButton size="sm" variant="ghost" @click="importOpen = true">
                  <ArchiveRestore :size="13" />导入项目
                </AppButton>
              </header>
              <p class="cur-dir">{{ ws.dir.name }}</p>

            <div class="create">
              <input
                v-model="newName"
                class="text-input"
                placeholder="新项目名称，如「2026 春季扫街」"
                @keyup.enter="create"
              />
              <AppButton variant="primary" :disabled="!canCreate" @click="create">
                <FolderPlus :size="15" />新建项目
              </AppButton>
            </div>

            <div v-if="ws.projects.length" class="grid">
              <!-- div[role=button]：卡片内要挂操作菜单，button 不能嵌套 button -->
              <div
                v-for="p in ws.projects"
                :key="p.id"
                class="prj-card"
                role="button"
                tabindex="0"
                :data-prj-id="p.id"
                @click="ws.openProject(p)"
                @keyup.enter="ws.openProject(p)"
                v-on="prjPress"
              >
                <span class="prj-icon" :class="{ emoji: !!p.emoji }">
                  <template v-if="p.emoji">{{ p.emoji }}</template>
                  <Images v-else :size="17" />
                </span>
                <span class="prj-name">{{ p.name }}</span>
                <span class="prj-count">{{ p.count }} 张照片</span>
                <span v-if="p.createdAt" class="prj-date">{{ fmtDate(p.createdAt) }}</span>
                <AppDropdown
                  v-if="!isCoarse"
                  class="prj-menu"
                  align="right"
                  :items="[
                    { label: '重命名', action: () => startRename('project', p) },
                    { label: '设置图标…', action: () => (emojiTarget = { kind: 'project', meta: p }) },
                    { label: '导出…', action: () => (exportTarget = { kind: 'project', name: p.name, path: p.path }) },
                    { label: '删除', danger: true, action: () => (removeTarget = { id: p.id, name: p.name }) },
                  ]"
                >
                  <template #trigger>
                    <span class="prj-rm" role="button" aria-label="项目操作" title="重命名 / 导出 / 删除">
                      <MoreHorizontal :size="13" />
                    </span>
                  </template>
                </AppDropdown>
              </div>
            </div>
            <p v-else class="empty">这个目录里还没有工作项目</p>
          </template>

          <template v-else-if="fsAvailable && !sandboxedFs">
            <div class="glyph">
              <FolderOpen :size="30" :stroke-width="1.6" />
            </div>
            <h1>选择工作目录</h1>
            <AppButton variant="primary" class="cta" :disabled="ws.loading" @click="addDir">
              <FolderPlus :size="15" />选择文件夹…
            </AppButton>
            <AppButton variant="ghost" class="cta" @click="gotoDirs">
              <ArrowLeft :size="15" />返回工作目录
            </AppButton>
          </template>

          <template v-else-if="fsAvailable">
            <div class="glyph">
              <FolderOpen :size="30" :stroke-width="1.6" />
            </div>
            <h1>选择工作目录</h1>
            <AppButton variant="ghost" class="cta" @click="gotoDirs">
              <ArrowLeft :size="15" />返回工作目录
            </AppButton>
          </template>

          <template v-else>
            <h1>开始辑录</h1>
            <AppButton variant="primary" class="cta" @click="ws.openEphemeralProject()">
              <Layers :size="15" />进入临时项目
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
        <p>正在打开…</p>
      </div>
    </Transition>

    <!-- 移除工作目录记录 -->
    <AppDialog :open="!!removeDirTarget" title="移除工作目录" :width="380" @close="removeDirTarget = null">
      <p class="confirm-text">
        将从列表中移除「{{ removeDirTarget?.name }}」的记录。磁盘上的文件夹与项目不会被删除。
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeDirTarget = null">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemoveDir"><Trash2 :size="13" />移除记录</AppButton>
      </div>
    </AppDialog>

    <!-- 删除工作项目：桌面移入系统回收站；移动端没有回收站，直接删除并明确警示 -->
    <AppDialog :open="!!removeTarget" title="删除工作项目" :width="380" @close="removeTarget = null">
      <p class="confirm-text">
        <template v-if="isTauri">
          将把文件夹「{{ removeTarget?.name }}」及其中的全部照片移入回收站。确定删除吗？
        </template>
        <template v-else>
          移动端没有回收站，项目「{{ removeTarget?.name }}」及其中的全部照片将被<strong>直接删除</strong>，此操作<strong>不可撤销</strong>。
        </template>
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeTarget = null">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">
          <Trash2 :size="13" />{{ isTauri ? '移入回收站' : '直接删除' }}
        </AppButton>
      </div>
    </AppDialog>

    <!-- 重命名：目录与项目共用，确认后磁盘改名并同步记录 -->
    <AppDialog
      :open="!!renameTarget"
      :title="renameTarget?.kind === 'dir' ? '重命名工作目录' : '重命名工作项目'"
      :width="380"
      @close="renameTarget = null"
    >
      <input
        v-model="renameName"
        class="text-input"
        placeholder="新名称"
        @keyup.enter="confirmRename"
      />
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="renameTarget = null">取消</AppButton>
        <AppButton variant="primary" @click="confirmRename"><Pencil :size="13" />重命名</AppButton>
      </div>
    </AppDialog>

    <!-- 设置 emoji 图标：目录与项目共用一个选择器，选择即保存 -->
    <AppDialog
      :open="!!emojiTarget"
      :title="emojiTarget?.kind === 'dir' ? '目录图标' : '项目图标'"
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
.wsp-push-leave-active,
.wsp-pop-leave-active {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
}
.wsp-push-enter-from {
  opacity: 0;
  transform: translateX(36px);
}
.wsp-push-leave-to {
  opacity: 0;
  transform: translateX(-28px);
}
.wsp-pop-enter-from {
  opacity: 0;
  transform: translateX(-28px);
}
.wsp-pop-leave-to {
  opacity: 0;
  transform: translateX(36px);
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
