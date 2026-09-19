<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ArrowLeftRight,
  ArrowRight,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Images,
  Layers,
  MapPin,
  Trash2,
} from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { isTauri } from '@/core/platform'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 工作区页面：OOBE 定位软件数据 → 选择工作目录 → 项目管理。
 * 三步之间用方向感知的非线性过渡衔接。
 */
const ws = useWorkspaceStore()
const settings = useSettingsStore()

type Step = 'oobe' | 'dir' | 'projects'

const step = computed<Step>(() => {
  if (isTauri && !settings.oobeDone) return 'oobe'
  if (isTauri && !ws.dir) return 'dir'
  return 'projects'
})

const ORDER: Record<Step, number> = { oobe: 0, dir: 1, projects: 2 }
const dir2 = ref<'fwd' | 'back'>('fwd')
watch(step, (to, from) => {
  dir2.value = ORDER[to] >= ORDER[from] ? 'fwd' : 'back'
})

/* OOBE：软件数据位置 */
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

/* 项目管理 */
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
    <Transition :name="dir2" mode="out-in">
      <!-- ① OOBE：软件数据位置 -->
      <div v-if="step === 'oobe'" key="oobe" class="card">
        <LogoMark class="mark" animated />
        <h1>欢迎使用辑印</h1>
        <p class="lead">选择软件数据的存放位置。数据目录保存你的工作目录记录与水印预设。</p>

        <div class="oobe-dir">
          <HardDrive :size="16" />
          <div class="dir-text">
            <span class="dir-label">数据位置</span>
            <span class="dir-path">{{ oobeDir }}</span>
          </div>
          <AppButton size="sm" @click="pickDataDir">浏览…</AppButton>
        </div>
        <p class="hint">便携版默认放在程序所在文件夹（随 U 盘携带）；换位置后软件会记住。数据子文件夹为「AlbumarkData」。</p>

        <AppButton variant="primary" class="cta" @click="finishOobe">
          开始使用<ArrowRight :size="15" />
        </AppButton>
      </div>

      <!-- ② 选择工作目录 -->
      <div v-else-if="step === 'dir'" key="dir" class="card">
        <div class="glyph">
          <FolderOpen :size="30" :stroke-width="1.6" />
        </div>
        <h1>选择工作目录</h1>
        <p class="lead">
          工作目录是一个用来收纳全部工作项目的空文件夹，相当于你的图片资料库。
          选定后会记录在软件数据里，下次启动直接进入。
        </p>
        <ul class="rules">
          <li><FolderPlus :size="13" />工作目录必须是一个<strong>空文件夹</strong></li>
          <li><Layers :size="13" />里面的每个项目都是它的子文件夹</li>
          <li><ArrowLeftRight :size="13" />之后可随时换一个工作目录</li>
        </ul>
        <AppButton variant="primary" class="cta" :disabled="ws.loading" @click="ws.chooseDir()">
          <FolderOpen :size="15" />选择空文件夹…
        </AppButton>
      </div>

      <!-- ③ 项目管理 -->
      <div v-else key="projects" class="projects-wrap">
        <div v-if="isTauri && ws.dir" class="prj-head">
          <div class="prj-title">
            <FolderOpen :size="15" />
            <div class="prj-meta">
              <h1>工作项目</h1>
              <span class="dir-path" :title="ws.dir.path">{{ ws.dir.name }}</span>
            </div>
          </div>
          <AppButton size="sm" variant="ghost" @click="ws.switchDir()">
            <MapPin :size="13" />更换工作目录
          </AppButton>
        </div>

        <div class="card grow">
          <template v-if="isTauri && ws.dir">
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
            <p v-else class="empty">还没有工作项目。起个名字，创建第一个项目开始辑录。</p>
          </template>

          <template v-else>
            <h1>开始辑录</h1>
            <p class="lead">此设备不支持文件夹工作目录，可使用仅保留在本次会话的临时项目。</p>
            <AppButton variant="primary" class="cta" @click="ws.openEphemeralProject()">
              <Layers :size="15" />进入临时项目
            </AppButton>
          </template>
        </div>
      </div>
    </Transition>

    <AppDialog :open="!!removeTarget" title="删除工作项目" :width="380" @close="removeTarget = null">
      <p class="confirm-text">
        将删除文件夹「{{ removeTarget?.name }}」及其中的全部照片，此操作不可恢复。确定删除吗？
      </p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeTarget = null">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">
          <Trash2 :size="13" />删除
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
}
.projects-wrap {
  width: min(860px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.prj-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.prj-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-2);
}
.prj-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.prj-meta h1 {
  font-size: 18px;
  color: var(--text);
}
.dir-path {
  font-size: 11.5px;
  color: var(--text-3);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
}
h1 {
  font-size: 21px;
  letter-spacing: -0.02em;
}
.lead {
  margin-top: 6px;
  max-width: 400px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.6;
}
.rules {
  list-style: none;
  padding: 0;
  margin: 18px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.rules li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-2);
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--bg);
}
.rules svg {
  color: var(--accent);
  flex: none;
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
  width: 100%;
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
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
  width: 100%;
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
  padding: 18px 2px;
  font-size: 12.5px;
}
.hint {
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.55;
  margin-top: 10px;
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

/* 三步之间的方向感知过渡：前进向左推、返回向右推，非线性缓动 */
.fwd-enter-active,
.fwd-leave-active,
.back-enter-active,
.back-leave-active {
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
.back-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}
.back-leave-to {
  opacity: 0;
  transform: translateX(22px);
}
</style>
