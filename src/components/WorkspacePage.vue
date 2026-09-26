<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Images,
  Layers,
  Trash2,
} from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { fsAvailable, sandboxedFs } from '@/core/fs'
import { isTauri } from '@/core/platform'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore, type WorkDirMeta } from '@/stores/workspace'

/**
 * 工作区页面：OOBE（仅桌面）→ 工作区总览（工作目录列表 + 工作项目卡片）。
 * 无文件能力的环境（浏览器）降级为会话内临时项目。
 */
const ws = useWorkspaceStore()
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

/** 安卓沙箱：在应用数据目录下新建命名工作目录；桌面：系统选择器（允许已有项目） */
async function addDir(): Promise<void> {
  if (sandboxedFs) {
    const ok = await ws.createDir(newDirName.value)
    if (ok) newDirName.value = ''
    return
  }
  await ws.addDir()
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

function confirmRemove(): void {
  const t = removeTarget.value
  removeTarget.value = null
  if (!t) return
  const meta = ws.projects.find((p) => p.id === t.id)
  if (meta) void ws.removeProject(meta)
}

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
        <h1>欢迎使用辑印</h1>

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

      <!-- ② 工作区总览：工作目录列表 + 工作项目 -->
      <div v-else key="projects" class="projects-wrap">
        <!-- 工作目录：列表式管理（查看 / 切换 / 移除记录） -->
        <section v-if="fsAvailable" class="card grow">
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
            >
              <span class="dir-icon">
                <Check v-if="ws.dir?.path === d.path" :size="14" />
                <FolderOpen v-else :size="14" />
              </span>
              <div class="dir-main">
                <span class="dir-name">{{ d.name }}</span>
                <span class="dir-path" :title="d.path">{{ d.path }}</span>
              </div>
              <span class="dir-count">{{ d.projects ?? '—' }} 个项目</span>
              <button
                v-if="ws.dir?.path !== d.path"
                class="dir-use"
                title="切换到此目录"
                @click="ws.useDir(d)"
              >
                <ArrowLeftRight :size="13" />使用
              </button>
              <button
                class="dir-rm"
                title="移除记录（不删除文件）"
                @click.stop="removeDirTarget = d"
              >
                <Trash2 :size="13" />
              </button>
            </li>
          </ul>
          <p v-else class="empty">还没有工作目录</p>
        </section>

        <!-- 工作项目 -->
        <section class="card grow">
          <template v-if="fsAvailable && ws.dir">
            <header class="sec-head">
              <div class="sec-title">
                <Images :size="15" />
                <h1>工作项目</h1>
                <span class="sec-count">{{ ws.projects.length }}</span>
              </div>
            </header>

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
              <button v-for="p in ws.projects" :key="p.id" class="prj-card" @click="ws.openProject(p)">
                <span class="prj-icon"><Images :size="17" /></span>
                <span class="prj-name">{{ p.name }}</span>
                <span class="prj-count">{{ p.count }} 张照片</span>
                <span v-if="p.createdAt" class="prj-date">{{ fmtDate(p.createdAt) }}</span>
                <span
                  class="prj-rm"
                  role="button"
                  aria-label="删除项目"
                  @click.stop="removeTarget = { id: p.id, name: p.name }"
                >
                  <Trash2 :size="13" />
                </span>
              </button>
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
          </template>

          <template v-else-if="fsAvailable">
            <div class="glyph">
              <FolderOpen :size="30" :stroke-width="1.6" />
            </div>
            <h1>选择工作目录</h1>
          </template>

          <template v-else>
            <h1>开始辑录</h1>
            <AppButton variant="primary" class="cta" @click="ws.openEphemeralProject()">
              <Layers :size="15" />进入临时项目
            </AppButton>
          </template>
        </section>
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

    <!-- 删除工作项目：移入回收站 -->
    <AppDialog :open="!!removeTarget" title="删除工作项目" :width="380" @close="removeTarget = null">
      <p class="confirm-text">
        将把文件夹「{{ removeTarget?.name }}」及其中的全部照片移入回收站。确定删除吗？
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeTarget = null">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">
          <Trash2 :size="13" />移入回收站
        </AppButton>
      </div>
    </AppDialog>
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
  font-size: 15px;
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
  font-size: 11px;
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
.dir-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dir-name {
  font-size: 13px;
  font-weight: 500;
}
.dir-path {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-count {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.dir-use {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--text-2);
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.dir-use:hover {
  background: var(--active);
  color: var(--text);
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
  font-size: 21px;
  letter-spacing: -0.02em;
}
.card.grow h1 {
  font-size: 15px;
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
  font-size: 11px;
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
  font-size: 12.5px;
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
.prj-name {
  font-size: 13px;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prj-count {
  font-size: 11.5px;
  color: var(--text-3);
}
.prj-date {
  font-size: 11px;
  color: var(--text-3);
  opacity: 0.8;
}
.prj-rm {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--text-3);
  opacity: 0;
  transition:
    opacity var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft);
}
.prj-card:hover .prj-rm {
  opacity: 1;
}
.prj-rm:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.empty {
  color: var(--text-3);
  padding: 14px 2px;
  font-size: 12.5px;
  line-height: 1.6;
  text-align: center;
}
.cta {
  width: 100%;
  margin-top: 18px;
}
.confirm-text {
  font-size: 13px;
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
  font-size: 12.5px;
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
