<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, Database, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import { analyzeStorage, type DirUsage, type StorageReport } from '@/core/storageReport'
import { fmtSize } from '@/core/format'
import { useI18n } from '@/i18n'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  /** 软件数据根（…/AlbumarkData） */
  root: string
  /** 数据分组可见时才扫描：全屏页 v-show 会让组件常驻，不该在打开时白扫磁盘 */
  active: boolean
}>()

const { t } = useI18n()
const ws = useWorkspaceStore()

const report = ref<StorageReport | null>(null)
const scanning = ref(false)
const expanded = ref<Set<string>>(new Set())
let seq = 0
/** 扫描中又收到新的统计请求（例如刚改了数据位置）：本轮结束后补跑一次 */
let rerun = false

async function refresh(): Promise<void> {
  if (!props.root) return
  if (scanning.value) {
    rerun = true
    return
  }
  const mine = ++seq
  scanning.value = true
  try {
    const r = await analyzeStorage(
      props.root,
      ws.dirs.map((d) => ({ path: d.path, name: d.name })),
    )
    if (mine === seq) report.value = r
  } finally {
    if (mine === seq) {
      scanning.value = false
      if (rerun) {
        rerun = false
        void refresh()
      }
    }
  }
}

watch(
  () => props.active,
  (on) => {
    if (on && !report.value && !scanning.value) void refresh()
  },
  { immediate: true },
)

// 数据位置被改到别处：旧报告不再适用，重新统计
watch(
  () => props.root,
  (next, prev) => {
    if (next && next !== prev && props.active) {
      report.value = null
      void refresh()
    }
  },
)

onBeforeUnmount(() => {
  seq++
})

/** 分类占比：照片 / 项目清单 / 其余（只用于一根分段的占用条） */
const segments = computed(() => {
  const r = report.value
  if (!r || !r.totals.bytes) return []
  return [
    { key: 'photo', bytes: r.totals.imageBytes },
    { key: 'manifest', bytes: r.totals.manifestBytes },
    { key: 'other', bytes: r.totals.otherBytes },
  ].filter((s) => s.bytes > 0)
})

function pct(bytes: number): string {
  const total = report.value?.totals.bytes || 0
  return total ? `${(bytes / total) * 100}%` : '0%'
}

function toggle(path: string): void {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function expandable(d: DirUsage): boolean {
  return d.projects.length > 0
}

/** 目录行里最大项目占用（子行的小条按它归一，绝不画满整行） */
function projectWidth(d: DirUsage, bytes: number): string {
  const max = d.projects[0]?.bytes || 0
  return max ? `${Math.max(2, (bytes / max) * 100)}%` : '0%'
}
</script>

<template>
  <div class="storage">
    <div class="st-head">
      <div class="text">
        <span class="label">{{ t('存储占用') }}</span>
        <p v-if="report" class="desc">
          {{ t('{0} 个项目 · {1} 张照片 · {2} 个文件', report.totals.projects, report.totals.imageFiles, report.totals.files) }}
        </p>
      </div>
      <AppButton size="sm" variant="ghost" :disabled="scanning" @click="refresh">
        <LoaderCircle v-if="scanning" :size="13" class="spin" />
        <RefreshCw v-else :size="13" />{{ scanning ? t('统计中…') : t('重新统计') }}
      </AppButton>
    </div>

    <div v-if="scanning && !report" class="st-empty">
      <LoaderCircle :size="15" class="spin" />
      <span>{{ t('正在统计数据目录…') }}</span>
    </div>

    <template v-else-if="report">
      <div class="total">
        <span class="total-num">{{ fmtSize(report.totals.bytes) }}</span>
        <span class="total-cap">{{ t('全部占用') }}</span>
      </div>

      <!-- 一根分段条：照片 / 清单 / 其余，只用主题色与中性层级，不做渐变 -->
      <div v-if="segments.length" class="bar" role="img" :aria-label="t('数据占用构成')">
        <span
          v-for="s in segments"
          :key="s.key"
          class="seg"
          :class="s.key"
          :style="{ width: pct(s.bytes) }"
        />
      </div>
      <div class="legend">
        <span class="lg"><i class="dot photo" />{{ t('照片') }} {{ fmtSize(report.totals.imageBytes) }}</span>
        <span class="lg"><i class="dot manifest" />{{ t('项目清单') }} {{ fmtSize(report.totals.manifestBytes) }}</span>
        <span class="lg"><i class="dot other" />{{ t('其他数据') }} {{ fmtSize(report.totals.otherBytes) }}</span>
      </div>

      <p class="meta mono">
        {{ t('软件数据') }} {{ fmtSize(report.rootBytes) }} · {{ report.root }}
      </p>

      <div class="dirs">
        <div v-for="d in report.workdirs" :key="d.path" class="dir">
          <button
            class="dir-row"
            :disabled="!expandable(d)"
            :aria-expanded="expandable(d) ? expanded.has(d.path) : undefined"
            @click="toggle(d.path)"
          >
            <ChevronDown v-if="expandable(d)" :size="13" class="chev" :class="{ open: expanded.has(d.path) }" />
            <Database v-else :size="13" class="chev off" />
            <span class="dir-name">{{ d.name }}</span>
            <span v-if="d.unreadable" class="dir-warn">{{ t('部分不可读') }}</span>
            <span class="dir-projects">{{ t('{0} 个项目', d.projects.length) }}</span>
            <span class="dir-size">{{ fmtSize(d.bytes) }}</span>
          </button>
          <div v-if="expandable(d)" v-show="expanded.has(d.path)" class="projects">
            <div v-for="p in d.projects" :key="p.path" class="prj">
              <span class="prj-name" :title="p.name">{{ p.name }}</span>
              <span class="prj-photos">{{ t('{0} 张', p.imageFiles) }}</span>
              <span class="prj-bar"><i :style="{ width: projectWidth(d, p.bytes) }" /></span>
              <span class="prj-size">{{ fmtSize(p.bytes) }}</span>
            </div>
          </div>
        </div>
        <p v-if="!report.workdirs.length" class="desc">{{ t('还没有工作目录。') }}</p>
      </div>

      <p v-if="report.partial" class="warn">{{ t('部分文件或目录暂时不可读，数字为已扫描到的部分。') }}</p>
    </template>
  </div>
</template>

<style scoped>
.storage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.st-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.label {
  font-size: calc(13px * var(--ui-zoom, 1));
}
.desc {
  margin-top: 2px;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.spin {
  animation: rotate 0.9s linear infinite;
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
.st-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  color: var(--text-3);
  font-size: calc(12px * var(--ui-zoom, 1));
}
.total {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
/* 总占用是这组数据的主指标：字号抬一档，数字用表格数字宽度避免跳动 */
.total-num {
  font-size: calc(22px * var(--ui-zoom, 1));
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.total-cap {
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.bar {
  display: flex;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--hover);
}
.seg {
  height: 100%;
}
.seg.photo {
  background: var(--accent);
}
.seg.manifest {
  background: var(--text-2);
}
.seg.other {
  background: var(--text-3);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
/* 分类色块：小方块而非圆点，避免把数据图例画成头像式圆标 */
.dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.dot.photo {
  background: var(--accent);
}
.dot.manifest {
  background: var(--text-2);
}
.dot.other {
  background: var(--text-3);
}
.meta {
  font-size: calc(10.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dirs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dir-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 4px;
  border-radius: var(--r-s);
  text-align: left;
  transition: background var(--dur-hover) var(--ease-soft);
}
.dir-row:hover:not(:disabled) {
  background: var(--hover);
}
.chev {
  flex: none;
  color: var(--text-3);
  transition: transform var(--dur) var(--ease-soft);
}
.chev.open {
  transform: rotate(-180deg);
}
.chev.off {
  opacity: 0.35;
}
.dir-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(12px * var(--ui-zoom, 1));
}
.dir-warn {
  font-size: calc(10.5px * var(--ui-zoom, 1));
  color: var(--accent);
}
.dir-projects {
  flex: none;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.dir-size {
  flex: none;
  min-width: 64px;
  text-align: right;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
.projects {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0 6px 20px;
}
.prj {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border-radius: var(--r-s);
}
.prj-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.prj-photos {
  flex: none;
  font-size: calc(10.5px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.prj-bar {
  flex: none;
  width: 72px;
  height: 3px;
  border-radius: 999px;
  background: var(--hover);
  overflow: hidden;
}
.prj-bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  opacity: 0.55;
}
.prj-size {
  flex: none;
  min-width: 56px;
  text-align: right;
  font-size: calc(10.5px * var(--ui-zoom, 1));
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}
.warn {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation-duration: 1.6s;
  }
}
</style>
