<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArchiveRestore, FolderOpen, FolderUp, TriangleAlert } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { baseName } from '@/core/fs'
import { isTauri, pickDirectory, pickZipPath, readFileBytes } from '@/core/platform'
import { useWorkspaceStore, type ProjectMeta } from '@/stores/workspace'
import { useI18n } from '@/i18n'

/**
 * 工作项目导入对话框：选择导出产物（ZIP 压缩包 / 桌面端文件夹），
 * 流式导入到当前工作目录。ZIP 走系统文件选择器（桌面 dialog、
 * 触屏 <input type="file">），解压逐条目写盘、不整包驻留内存。
 */
const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const ws = useWorkspaceStore()

type Phase = 'input' | 'running' | 'done'
const phase = ref<Phase>('input')
const progress = ref({ done: 0, name: '' })
/** 导入结果:单项目 ZIP 一项,批量归档多项 */
const imported = ref<ProjectMeta[]>([])
const error = ref<string | null>(null)
/** 触屏的 ZIP 选择器：WebView 的 input file 会调起系统文件选择，无需额外插件 */
const zipInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    phase.value = 'input'
    progress.value = { done: 0, name: '' }
    imported.value = []
    error.value = null
  },
)

/** running 中不允许关闭，防止中断解压产生半截项目文件夹 */
function requestClose(): void {
  if (phase.value === 'running') return
  emit('close')
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function importZip(): Promise<void> {
  if (phase.value === 'running') return
  error.value = null
  let blob: Blob
  let fallback: string
  if (isTauri) {
    const path = await pickZipPath()
    if (!path) return // 用户取消：留在选择态
    const bytes = await readFileBytes(path)
    blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' })
    fallback = baseName(path).replace(/\.zip$/i, '')
  } else {
    const picked = await new Promise<File | null>((resolve) => {
      const el = zipInput.value
      if (!el) return resolve(null)
      el.value = ''
      el.onchange = () => resolve(el.files?.[0] ?? null)
      el.click()
    })
    if (!picked) return
    blob = picked
    fallback = picked.name.replace(/\.zip$/i, '')
  }
  phase.value = 'running'
  progress.value = { done: 0, name: '' }
  try {
    imported.value = await ws.importProjectsZip(blob, fallback, (done, name) => {
      progress.value = { done, name }
    })
    phase.value = 'done'
  } catch (e) {
    phase.value = 'input'
    error.value = errorMessage(e)
  }
}

async function importFolder(): Promise<void> {
  if (phase.value === 'running') return
  error.value = null
  const dir = await pickDirectory(t('选择工作项目文件夹'))
  if (!dir) return
  phase.value = 'running'
  progress.value = { done: 0, name: t('复制文件夹…') }
  try {
    imported.value = [await ws.importProjectFolder(dir)]
    phase.value = 'done'
  } catch (e) {
    phase.value = 'input'
    error.value = errorMessage(e)
  }
}
</script>

<template>
  <AppDialog :open="open" :title="t('导入工作项目')" :width="420" @close="requestClose">
    <!-- ① 选择态：ZIP / 文件夹入口 -->
    <template v-if="phase === 'input'">
      <p class="hint first">
        {{ t('从导出的备份导入一个工作项目到当前工作目录——ZIP 压缩包或项目文件夹（含 albumark.json 清单）均可识别。') }}
      </p>
      <div class="btns-start">
        <AppButton variant="primary" @click="importZip">
          <ArchiveRestore :size="14" />{{ t('选择 ZIP 文件…') }}
        </AppButton>
        <AppButton v-if="isTauri" @click="importFolder">
          <FolderOpen :size="14" />{{ t('选择项目文件夹…') }}
        </AppButton>
      </div>
      <input ref="zipInput" type="file" accept=".zip,application/zip,application/x-zip-compressed" class="hidden" />

      <p v-if="error" class="error" role="alert">
        <TriangleAlert :size="13" />{{ t('导入失败：{0}', error) }}
      </p>

      <div class="btns">
        <AppButton variant="ghost" @click="requestClose">{{ t('关闭') }}</AppButton>
      </div>
    </template>

    <!-- ② 进行中：文件计数 + 当前条目 -->
    <template v-else-if="phase === 'running'">
      <div class="count">
        <FolderUp :size="15" />
        <span>{{ t('正在导入…') }}</span>
      </div>
      <div class="track">
        <div class="fill indeterminate" />
      </div>
      <p class="status">
        {{ t('已导入 {0} 个文件', progress.done) }}
        <span v-if="progress.name" class="cur mono">{{ progress.name }}</span>
      </p>
    </template>

    <!-- ③ 完成：导入结果 -->
    <template v-else>
      <div class="count">
        <ArchiveRestore :size="15" />
        <span>{{
          imported.length > 1
            ? t('已导入 {0} 个工作项目', imported.length)
            : t('已导入「{0}」', imported[0]?.name ?? '')
        }}</span>
      </div>
      <p class="dest">
        {{ t('{0} 张照片 · 已加入当前工作目录的项目列表', imported.reduce((n, p) => n + p.count, 0)) }}
      </p>
      <div class="btns">
        <AppButton variant="primary" @click="requestClose">{{ t('完成') }}</AppButton>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.hint.first {
  margin: 0 0 12px;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.55;
}
.btns-start {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.hidden {
  display: none;
}
.count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--danger);
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.track {
  height: 6px;
  margin-top: 14px;
  border-radius: 3px;
  background: var(--line);
  overflow: hidden;
}
/* 条目计数未知总量：循环流动的进度条表达进行中 */
.fill.indeterminate {
  height: 100%;
  width: 36%;
  border-radius: 3px;
  background: var(--accent);
  animation: slide 1.1s var(--ease-soft) infinite;
}
@keyframes slide {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(300%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .fill.indeterminate {
    animation-duration: 2.4s;
  }
}
.status {
  margin: 10px 0 0;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.status strong {
  color: var(--text);
}
.cur {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
}
.mono {
  font-family: var(--font-mono);
}
.dest {
  margin: 10px 0 0;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-3);
}
</style>
