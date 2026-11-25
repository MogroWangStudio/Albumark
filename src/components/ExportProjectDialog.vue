<script setup lang="ts">
import { ref, watch } from 'vue'
import { FileArchive, FolderDown, FolderOpen, TriangleAlert } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import { statFolder, zipFolderTo, type ArchiveStats } from '@/core/archive'
import { copyDir, joinPath, openWriter } from '@/core/fs'
import { fmtSize } from '@/core/format'
import { isTauri, pickDirectory, pickSavePath, revealInFolder } from '@/core/platform'
import { toast } from '@/stores/toast'
import { useI18n } from '@/i18n'

/**
 * 工作项目 / 工作目录的导出确认对话框：先看文件详情（文件数 · 总大小），
 * 选 ZIP / 文件夹，确认后落盘。导出内容是项目文件夹原样备份
 * （albumark.json + images/），解压到任意工作目录下即可被重新识别。
 */
const props = defineProps<{
  open: boolean
  target: { kind: 'project' | 'dir'; name: string; path: string } | null
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

type Phase = 'input' | 'running' | 'done'
const phase = ref<Phase>('input')
const format = ref<'zip' | 'folder'>('zip')
const stats = ref<ArchiveStats | null>(null)
const progress = ref({ done: 0, total: 0 })
const resultPath = ref<string | null>(null)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    phase.value = 'input'
    format.value = 'zip'
    stats.value = null
    progress.value = { done: 0, total: 0 }
    resultPath.value = null
    error.value = null
    const tgt = props.target
    if (tgt) {
      void statFolder(tgt.path).then(
        (s) => {
          if (props.target?.path === tgt.path) stats.value = s
        },
        () => {
          /* 统计失败保持空态，确认时仍可尝试导出 */
        },
      )
    }
  },
)

/** running 中不允许关闭（Esc / 遮罩都拦截），防止中断写盘产生半截文件 */
function requestClose(): void {
  if (phase.value === 'running') return
  emit('close')
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 确认导出：按平台与格式分流落盘（详见各分支注释） */
async function confirmExport(): Promise<void> {
  const tgt = props.target
  if (!tgt || phase.value === 'running') return
  phase.value = 'running'
  error.value = null
  resultPath.value = null
  try {
    if (format.value === 'zip') {
      let dest: string | null = null
      let displayPath: string
      if (isTauri) {
        dest = await pickSavePath(`${tgt.name}.zip`)
        if (!dest) {
          phase.value = 'input' // 用户取消另存为：留在确认态
          return
        }
        displayPath = dest
      } else {
        const sub = `${tgt.name}_${timestamp()}`
        dest = `Albumark/${sub}.zip`
        displayPath = `Documents/Albumark/${sub}.zip`
      }
      const w = await openWriter(dest, !isTauri)
      try {
        await zipFolderTo(tgt.path, (chunk) => w.write(chunk), (done, total) => {
          progress.value = { done, total }
        })
      } finally {
        await w.close()
      }
      resultPath.value = displayPath
    } else {
      if (isTauri) {
        const dir = await pickDirectory(t('选择导出位置'))
        if (!dir) {
          phase.value = 'input'
          return
        }
        const dest = await joinPath(dir, tgt.name)
        if (await fsExists(dest)) {
          toast(t('目标位置已有同名文件夹，换一个位置或重命名后再导出'), 'error')
          phase.value = 'input'
          return
        }
        await copyDir(tgt.path, dest)
        resultPath.value = dest
      } else {
        const sub = `${tgt.name}_${timestamp()}`
        await copyDir(tgt.path, `Albumark/${sub}`, true)
        resultPath.value = `Documents/Albumark/${sub}`
      }
    }
    phase.value = 'done'
  } catch (e) {
    phase.value = 'input'
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function fsExists(path: string): Promise<boolean> {
  const fs = await import('@tauri-apps/plugin-fs')
  return await fs.exists(path)
}

async function openResult(): Promise<void> {
  if (resultPath.value) await revealInFolder(resultPath.value)
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="target?.kind === 'dir' ? t('导出工作目录') : t('导出工作项目')"
    :width="420"
    @close="requestClose"
  >
    <!-- ① 确认态：文件详情 + 格式选择 -->
    <template v-if="phase === 'input'">
      <div class="count">
        <FolderOpen :size="15" />
        <span>
          {{ t('「{0}」', target?.name ?? '') }}
          <template v-if="stats">
            · <strong>{{ stats.files }}</strong> {{ t('个文件') }} · {{ fmtSize(stats.bytes) }}
          </template>
          <template v-else> · {{ t('正在统计文件…') }}</template>
        </span>
      </div>

      <div class="mode-pick">
        <span class="fl">{{ t('导出格式') }}</span>
        <AppSegment
          v-model="format"
          :options="[
            { value: 'zip', label: t('ZIP 压缩包') },
            { value: 'folder', label: t('文件夹') },
          ]"
        />
      </div>
      <p class="hint">
        {{
          isTauri
            ? (format === 'zip' ? t('确认后选择保存位置，打包为 ZIP 压缩包。') : t('确认后选择导出位置，文件夹原样复制。'))
            : t('将写入公共 Documents/Albumark/ 下按名称与时间命名的位置。')
        }}
        {{ t('导出内容为原样备份，含项目清单，解压到工作目录即可重新识别打开。') }}
      </p>

      <p v-if="error" class="error" role="alert">
        <TriangleAlert :size="13" />{{ t('导出失败：{0}', error) }}
      </p>

      <div class="btns">
        <AppButton variant="ghost" @click="requestClose">{{ t('取消') }}</AppButton>
        <AppButton variant="primary" @click="confirmExport">
          <FileArchive v-if="format === 'zip'" :size="14" /><FolderDown v-else :size="14" />{{ t('导出') }}
        </AppButton>
      </div>
    </template>

    <!-- ② 进行中：进度条 + 文件计数 -->
    <template v-else-if="phase === 'running'">
      <div class="count">
        <FolderDown :size="15" />
        <span>{{ t('正在导出「{0}」…', target?.name ?? '') }}</span>
      </div>
      <div class="track">
        <div
          class="fill"
          :style="{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }"
        />
      </div>
      <p class="status">{{ t('{0} / {1} 个文件', progress.done, progress.total) }}</p>
    </template>

    <!-- ③ 完成：目的地 + 打开所在文件夹 -->
    <template v-else>
      <div class="count">
        <FolderDown :size="15" />
        <span>{{ t('已导出「{0}」', target?.name ?? '') }}</span>
      </div>
      <p v-if="resultPath" class="dest mono">{{ resultPath }}</p>
      <div class="btns">
        <AppButton v-if="isTauri" @click="openResult">
          <FolderOpen :size="14" />{{ t('打开所在文件夹') }}
        </AppButton>
        <AppButton variant="primary" @click="requestClose">{{ t('完成') }}</AppButton>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.count strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.mode-pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
}
.fl {
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.hint {
  margin: 10px 0 0;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.55;
}
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
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
.fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width var(--dur) var(--ease);
}
.status {
  margin: 10px 0 0;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.dest {
  margin: 10px 0 0;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
}
</style>
