<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, LoaderCircle } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { compareVersions, type ReleaseEntry } from '@/core/updater'
import { APP_VERSION } from '@/core/version'
import { isCapacitor } from '@/core/platform'
import { useI18n } from '@/i18n'
import { useUpdaterStore } from '@/stores/updater'

/**
 * 版本列表：关于页「版本列表…」的落点。列出 GitHub Releases 的全部版本
 * （含预发布），每个版本可就地更新或降级，点行展开该版本的发布说明。
 * 降级是覆盖安装且不可自动回滚——必须在行内读到一个明确的警告并二次确认，
 * 不能只靠按钮文案暗示。选中版本后关闭本弹窗，交给全局更新弹窗走同一套
 * 下载 / 暂停 / 读秒安装流程。
 */

const updater = useUpdaterStore()
const { t } = useI18n()

interface Row {
  entry: ReleaseEntry
  version: string
  /** 与正在运行的版本比：>0 更新，<0 降级，0 当前 */
  cmp: number
  notes: string
  date: string
}

const lastReleased = computed(() => updater.releases[0]?.version ?? '')

const rows = computed<Row[]>(() =>
  updater.releases.map((entry) => ({
    entry,
    version: entry.version,
    cmp: compareVersions(entry.version, APP_VERSION),
    notes: entry.notes,
    date: formatDate(entry.publishedAt),
  })),
)

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 展开的版本（手风琴：同时只展开一个，避免长列表被说明撑散） */
const expanded = ref<string | null>(null)
/** 正在等待二次确认的降级目标 */
const confirming = ref<string | null>(null)

function toggle(version: string): void {
  expanded.value = expanded.value === version ? null : version
  // 换看别的版本即放弃未确认的降级：警告不能跟着滚动残留
  if (confirming.value && confirming.value !== version) confirming.value = null
}

function askDowngrade(version: string): void {
  expanded.value = version
  confirming.value = version
}

function cancelDowngrade(): void {
  confirming.value = null
}

async function confirmDowngrade(row: Row): Promise<void> {
  confirming.value = null
  await updater.selectRelease(row.entry)
}

/** 关闭时清掉确认态：下次打开不应带着上一次的红色警告 */
watch(
  () => updater.versionListOpen,
  (open) => {
    if (!open) {
      confirming.value = null
      expanded.value = null
    }
  },
)
</script>

<template>
  <AppDialog
    :open="updater.versionListOpen"
    :title="t('版本列表')"
    :width="560"
    @close="updater.closeVersionList"
  >
    <div class="lede">
      <span>{{ t('当前 v{0}', APP_VERSION) }}</span>
      <span v-if="rows.length" class="count">{{ t('{0} 个已发布版本', rows.length) }}</span>
    </div>

    <div v-if="updater.releasesState === 'loading' || updater.releasesState === 'idle'" class="state">
      <LoaderCircle :size="14" class="spin" />{{ t('正在读取版本列表…') }}
    </div>

    <div v-else-if="updater.releasesState === 'error'" class="state">
      <span>{{ t('版本列表读取失败，可能是网络或接口限流。') }}</span>
      <AppButton size="sm" @click="updater.loadReleases(true)">{{ t('重试') }}</AppButton>
    </div>

    <div v-else-if="!rows.length" class="state">{{ t('暂无已发布版本。') }}</div>

    <ul v-else class="list">
      <li v-for="row in rows" :key="row.version" class="item" :class="{ current: row.cmp === 0 }">
        <div class="item-head">
          <button
            class="summary"
            type="button"
            :aria-expanded="expanded === row.version"
            @click="toggle(row.version)"
          >
            <span class="ver">v{{ row.version }}</span>
            <span v-if="row.cmp === 0" class="tag now">{{ t('当前') }}</span>
            <span v-else-if="row.entry.prerelease" class="tag">{{ t('预发布') }}</span>
            <span v-if="row.version === lastReleased && row.cmp !== 0" class="tag latest">{{ t('最新') }}</span>
            <span class="date">{{ row.date }}</span>
            <ChevronDown :size="14" class="chev" :class="{ open: expanded === row.version }" />
          </button>

          <div class="ops">
            <span v-if="row.cmp === 0" class="now-hint">{{ t('正在使用') }}</span>
            <AppButton
              v-else-if="row.cmp > 0"
              size="sm"
              variant="primary"
              @click="updater.selectRelease(row.entry)"
            >
              {{ t('更新') }}
            </AppButton>
            <AppButton v-else size="sm" variant="danger" @click="askDowngrade(row.version)">
              {{ t('降级') }}
            </AppButton>
          </div>
        </div>

        <div v-if="expanded === row.version" class="detail">
          <!-- 降级确认：警告在读说明之前，先看清代价再决定 -->
          <div v-if="confirming === row.version" class="warn">
            <p class="warn-title">{{ t('降级到 v{0}？', row.version) }}</p>
            <p class="warn-body">
              {{
                t(
                  '降级会用旧版本覆盖当前安装，且不会自动回滚。项目数据与设置可能已被新版本改写，旧版本未必能完整读取，可能出现不可逆的 bug——请先备份工作目录。',
                )
              }}
            </p>
            <p v-if="isCapacitor" class="warn-body">
              {{ t('安卓系统不允许覆盖安装更低版本：确认后需先卸载当前应用，本地应用数据会一并清除。') }}
            </p>
            <div class="warn-actions">
              <AppButton size="sm" variant="ghost" @click="cancelDowngrade">{{ t('取消') }}</AppButton>
              <AppButton size="sm" variant="danger" @click="confirmDowngrade(row)">
                {{ t('仍要降级') }}
              </AppButton>
            </div>
          </div>

          <p v-if="row.notes" class="notes">{{ row.notes }}</p>
          <p v-else class="notes empty">{{ t('该版本没有附更新说明。') }}</p>
        </div>
      </li>
    </ul>
  </AppDialog>
</template>

<style scoped>
.lede {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 2px 0 12px;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.count {
  color: var(--text-3);
}

.state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 26px 0;
  font-size: calc(12.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  text-align: center;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: min(58vh, 440px);
  overflow-y: auto;
  margin: 0 -4px;
  padding: 0 4px;
}
.item {
  border-radius: var(--r-s);
  border-bottom: 1px solid var(--line);
}
.item:last-child {
  border-bottom: none;
}
.item.current .ver {
  color: var(--accent);
}

.item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: calc(38px * var(--ui-zoom, 1));
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 7px 4px;
  border-radius: var(--r-s);
  text-align: left;
  transition: background var(--dur-hover) var(--ease-soft);
}
.summary:hover {
  background: var(--hover);
}
.summary:active {
  background: var(--active);
}
.ver {
  font-size: calc(13px * var(--ui-zoom, 1));
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tag {
  font-size: calc(10px * var(--ui-zoom, 1));
  line-height: 1;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--text-3);
  border: 1px solid var(--line);
  white-space: nowrap;
}
.tag.now {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.tag.latest {
  color: var(--text-2);
  background: var(--hover);
  border-color: transparent;
}
.date {
  margin-left: auto;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.chev {
  flex: none;
  color: var(--text-3);
  transition: transform var(--dur-hover) var(--ease-soft);
}
.chev.open {
  transform: rotate(180deg);
}

.ops {
  flex: none;
  display: flex;
  align-items: center;
  padding-right: 4px;
}
.now-hint {
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  padding-right: 4px;
}

.detail {
  padding: 2px 4px 12px;
}
.notes {
  font-size: calc(12.5px * var(--ui-zoom, 1));
  line-height: 1.72;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 190px;
  overflow-y: auto;
  padding-left: 1px;
}
.notes.empty {
  color: var(--text-3);
}

.warn {
  margin: 2px 0 10px;
  padding: 10px 12px;
  border-radius: var(--r-s);
  border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}
.warn-title {
  font-size: calc(12.5px * var(--ui-zoom, 1));
  font-weight: 600;
  color: var(--danger);
  margin-bottom: 5px;
}
.warn-body {
  font-size: calc(12px * var(--ui-zoom, 1));
  line-height: 1.7;
  color: var(--text-2);
}
.warn-body + .warn-body {
  margin-top: 4px;
}
.warn-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 9px;
}

.spin {
  animation: version-spin 0.9s linear infinite;
}
@keyframes version-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation-duration: 2s;
  }
  .chev {
    transition: none;
  }
}
/* 窄屏（安卓竖屏）：版本行折成两行——摘要一行、操作一行，触控目标不挤在一起 */
@media (max-width: 520px) {
  .item-head {
    flex-wrap: wrap;
  }
  .summary {
    flex-basis: 100%;
  }
  .ops {
    width: 100%;
    justify-content: flex-end;
    padding: 0 4px 6px;
  }
}
</style>
