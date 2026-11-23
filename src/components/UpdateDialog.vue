<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Download, ExternalLink, LoaderCircle, Pause, Play, RefreshCw } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { APP_VERSION } from '@/core/version'
import { openReleasePage } from '@/core/updater'
import { isCapacitor } from '@/core/platform'
import { useUpdaterStore } from '@/stores/updater'

const updater = useUpdaterStore()

/** 进度条宽度：总大小未知（null）时不驱动宽度，走不确定态动画 */
const fillWidth = computed(() =>
  updater.updateProgress === null ? undefined : `${Math.round(updater.updateProgress)}%`,
)
</script>

<template>
  <AppDialog
    :open="updater.dialogOpen"
    :title="updater.isDowngrade ? '版本回退' : '软件更新'"
    :width="520"
    @close="updater.closeDialog"
  >
    <div v-if="updater.updateInfo" class="update">
      <!-- 版本去向一行说清：当前 → 新 -->
      <div class="ver-row">
        <span class="ver">v{{ APP_VERSION }}</span>
        <ArrowRight :size="14" class="ver-arrow" />
        <span class="ver new" :class="{ down: updater.isDowngrade }">v{{ updater.updateInfo.version }}</span>
      </div>

      <!-- 降级警告：覆盖安装、不可自动回滚，先讲清代价再给下载入口 -->
      <div v-if="updater.isDowngrade" class="downgrade-warn">
        <p>
          这是降级安装：旧版本会覆盖当前版本，且不会自动回滚。项目数据与设置可能已被新版本改写，
          旧版本未必能完整读取，可能出现不可逆的 bug——建议先备份工作目录。
        </p>
        <p v-if="isCapacitor">安卓系统不允许覆盖安装更低版本，需先卸载当前应用，本地应用数据会一并清除。</p>
      </div>

      <!-- 下载与安装状态：进度条 + 就地走字的状态行 -->
      <div
        v-if="updater.isDownloading || updater.updateState === 'paused'"
        class="progress-area"
      >
        <div class="track">
          <div
            class="fill"
            :class="{ indeterminate: updater.updateProgress === null }"
            :style="fillWidth ? { width: fillWidth } : undefined"
          ></div>
        </div>
        <p class="status" :class="{ paused: updater.updateState === 'paused' }">
          {{ updater.isDownloading ? updater.progressText : updater.pausedText }}
        </p>
      </div>
      <p v-else-if="updater.updateState === 'ready' || updater.updateState === 'installing'" class="status ready">
        {{ updater.readyText }}
      </p>

      <!-- 更新日志：Release 说明原文（纯文本，外部内容不注入 DOM 结构） -->
      <section class="notes">
        <h3>更新内容</h3>
        <p class="notes-text">{{ updater.updateInfo.notes || '本次更新没有附更新说明。' }}</p>
      </section>

      <!-- 动作随状态切换，按钮永远朝着一个明确的下一步 -->
      <div class="actions">
        <template v-if="updater.updateState === 'ready' || updater.updateState === 'installing'">
          <AppButton
            size="sm"
            variant="primary"
            :disabled="updater.updateState === 'installing'"
            @click="updater.installStaged"
          >
            <LoaderCircle v-if="updater.updateState === 'installing'" :size="13" class="spin" />
            <RefreshCw v-else :size="13" />立即重启安装
          </AppButton>
          <AppButton
            size="sm"
            variant="ghost"
            :disabled="updater.updateState === 'installing'"
            @click="updater.deferInstall"
          >
            稍后
          </AppButton>
        </template>
        <template v-else-if="updater.updateInfo.assetUrl">
          <template v-if="updater.isDownloading">
            <AppButton size="sm" variant="primary" @click="updater.pauseDownload">
              <Pause :size="13" />暂停
            </AppButton>
            <AppButton size="sm" variant="ghost" @click="updater.cancelDownload">取消</AppButton>
          </template>
          <template v-else-if="updater.updateState === 'paused'">
            <AppButton size="sm" variant="primary" @click="updater.resumeDownload">
              <Play :size="13" />继续下载
            </AppButton>
            <AppButton size="sm" variant="ghost" @click="updater.cancelDownload">取消</AppButton>
          </template>
          <template v-else>
            <AppButton size="sm" variant="primary" @click="updater.installUpdate">
              <Download :size="13" />{{ updater.isDowngrade ? '下载并降级' : '立即更新' }}
            </AppButton>
            <AppButton size="sm" variant="ghost" @click="openReleasePage(updater.updateInfo.url)">
              <ExternalLink :size="13" />发布页
            </AppButton>
          </template>
        </template>
        <template v-else>
          <!-- 没有本平台包体：自动更新走不通，引导去发布页手动获取 -->
          <span class="no-asset">本平台暂无自动更新包，请前往发布页手动下载</span>
          <AppButton size="sm" variant="primary" @click="openReleasePage(updater.updateInfo.url)">
            <ExternalLink :size="13" />打开发布页
          </AppButton>
        </template>
      </div>
    </div>
    <!-- 防御：弹窗在没有检查结果时被打开（正常入口不会走到这里） -->
    <p v-else class="empty">尚未检查更新。</p>
  </AppDialog>
</template>

<style scoped>
.ver-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 2px 0 16px;
}
.ver {
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.ver.new {
  color: var(--accent);
  font-weight: 600;
}
.ver.new.down {
  color: var(--danger);
}
.ver-arrow {
  color: var(--text-3);
}

/* 降级警告：与版本列表里的确认块同语义（危险色描边 + 低浓背景） */
.downgrade-warn {
  margin: 0 0 14px;
  padding: 9px 12px;
  border-radius: var(--r-s);
  border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  font-size: calc(12px * var(--ui-zoom, 1));
  line-height: 1.7;
  color: var(--text-2);
}
.downgrade-warn p + p {
  margin-top: 4px;
}

.progress-area {
  margin-bottom: 14px;
}
/* 进度条与导出面板同一套形制（6px 圆角轨道 + accent 填充） */
.track {
  height: 6px;
  border-radius: 3px;
  background: var(--line);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  /* deslop-ignore-next-line 26 —— 进度条宽度过渡是数值反馈，与导出面板进度条同构 */
  transition: width var(--dur) var(--ease);
}
/* 总大小未知：短条在轨道内往返，表示仍在进行 */
.fill.indeterminate {
  width: 32%;
  animation: indeterminate 1.4s var(--ease-soft) infinite;
}
@keyframes indeterminate {
  from {
    transform: translateX(-40%);
  }
  to {
    transform: translateX(260%);
  }
}
.status {
  margin-top: 8px;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.status.paused {
  color: var(--text-3);
}
.status.ready {
  margin: 0 0 14px;
  text-align: center;
}

.notes {
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
.notes h3 {
  font-size: calc(12px * var(--ui-zoom, 1));
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 8px;
}
.notes-text {
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-2);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}

.actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.no-asset {
  margin-right: auto;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-3);
}

.empty {
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-3);
  text-align: center;
  padding: 12px 0;
}

.spin {
  animation: page-spin 0.9s linear infinite;
}
@keyframes page-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
