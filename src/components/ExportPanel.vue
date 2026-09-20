<script setup lang="ts">
import { computed } from 'vue'
import { FolderOpen, Package } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import { isTauri } from '@/core/platform'
import { useExportStore } from '@/stores/export'
import { useImagesStore } from '@/stores/images'

const ex = useExportStore()
const images = useImagesStore()

const running = computed(() => ex.phase === 'running')
const finished = computed(() => ex.phase === 'done')
const exportable = computed(() => images.items.some((i) => i.blob))

const longEdgeModel = computed({
  get: () => String(ex.longEdge),
  set: (v: string) => (ex.longEdge = Number(v)),
})

const modeModel = computed({
  get: () => ex.mode,
  set: (v: unknown) => (ex.mode = v as 'zip' | 'folder'),
})

async function start(): Promise<void> {
  await ex.run()
}
</script>

<template>
  <div class="export panel-scroll">
    <template v-if="!running && !finished">
      <p class="lead">
        将导出全部 {{ images.count }} 张照片，当前水印与调节会一并应用。导出为重新编码的
        JPG，不回写 EXIF 信息。
      </p>
      <AppSlider v-model="ex.quality" :min="50" :max="100" label="JPEG 质量" :format="(v) => `${v}%`" @reset="ex.quality = 90" />
      <div class="field">
        <span class="fl">长边限制</span>
        <AppSegment
          v-model="longEdgeModel"
          small
          :options="[
            { value: '0', label: '原图' },
            { value: '2560', label: '2560 px' },
            { value: '1920', label: '1920 px' },
            { value: '1280', label: '1280 px' },
          ]"
        />
      </div>
      <div class="field">
        <span class="fl">文件名模板</span>
        <input v-model="ex.pattern" class="text-input" spellcheck="false" />
        <p class="hint">
          可用 {name} 原文件名、{index} 序号、{date} 日期，以及 {机型}、{拍摄日期} 等 EXIF
          令牌；同批重复名会自动加序号。
        </p>
      </div>
      <div class="field">
        <span class="fl">导出方式</span>
        <AppSegment
          v-model="modeModel"
          small
          :options="[
            { value: 'zip', label: 'ZIP 压缩包' },
            { value: 'folder', label: '文件夹（桌面端）', disabled: !isTauri },
          ]"
        />
        <p v-if="!isTauri" class="hint">当前为浏览器版本，仅支持导出 ZIP；桌面端可直接写入文件夹。</p>
      </div>
      <AppButton variant="primary" class="start" :disabled="!exportable" @click="start">
        <Package :size="15" />开始导出
      </AppButton>
    </template>

    <template v-else-if="running">
      <div class="progress-area">
        <div class="track">
          <div class="fill" :style="{ width: `${Math.round(ex.progress * 100)}%` }" />
        </div>
        <p class="status">{{ ex.done }} / {{ ex.total }}</p>
        <p class="current">{{ ex.current }}</p>
        <ul v-if="ex.errors.length" class="errors">
          <li v-for="e in ex.errors" :key="e">{{ e }}</li>
        </ul>
      </div>
    </template>

    <template v-else>
      <div class="done-area">
        <p>
          已导出 {{ ex.total - ex.errors.length }} 张照片<template v-if="ex.errors.length"
            >，{{ ex.errors.length }} 张失败</template
          >。
        </p>
        <ul v-if="ex.errors.length" class="errors">
          <li v-for="e in ex.errors" :key="e">{{ e }}</li>
        </ul>
        <div class="actions">
          <AppButton v-if="ex.resultPath" @click="ex.openResult()">
            <FolderOpen :size="15" />打开所在文件夹
          </AppButton>
          <AppButton variant="primary" @click="ex.reset()">完成</AppButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lead {
  color: var(--text-2);
  margin-bottom: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
}
.fl {
  font-size: 12px;
  color: var(--text-2);
}
.text-input {
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.hint {
  font-size: 11.5px;
  color: var(--text-3);
}
.start {
  width: 100%;
  margin-top: 6px;
}
.progress-area {
  padding: 8px 0;
}
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
  transition: width var(--dur) var(--ease);
}
.status {
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.current {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.errors {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  max-height: 120px;
  overflow-y: auto;
  font-size: 12px;
  color: var(--danger);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.done-area {
  padding: 4px 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
