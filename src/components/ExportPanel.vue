<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Check, FolderOpen, Images, Package, Share2 } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { TOKENS } from '@/core/tokens'
import { isCapacitor, isTauri } from '@/core/platform'
import { useExportStore } from '@/stores/export'
import { useImagesStore } from '@/stores/images'

const ex = useExportStore()
const images = useImagesStore()

const running = computed(() => ex.phase === 'running')
const finished = computed(() => ex.phase === 'done')
const exportable = computed(() => {
  if (ex.scope === 'picked') {
    return ex.pickedCount > 0 && images.items.some((i) => i.blob && ex.picked.has(i.id))
  }
  return images.items.some((i) => i.blob)
})
/** 文件夹逐张写入：桌面自选目录，安卓写入公共 Documents；浏览器不支持 */
const canFolder = isTauri || isCapacitor
/** 系统分享面板：移动端专属 */
const canShare = isCapacitor

const LONG_EDGE_PRESETS = ['0', '2560', '1920', '1280']

const longEdgeModel = computed({
  get: () => String(ex.longEdge),
  set: (v: string) => (ex.longEdge = Number(v)),
})

/** 自定义长边输入：落在预设值上时留空提示，否则显示当前数值 */
const customLongEdge = computed(() =>
  LONG_EDGE_PRESETS.includes(String(ex.longEdge)) ? '' : String(ex.longEdge),
)

function onCustomLongEdge(e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  const n = Number(raw)
  if (raw === '' || !Number.isFinite(n)) return
  ex.longEdge = Math.min(20000, Math.max(0, Math.round(n)))
}

const modeModel = computed({
  get: () => ex.mode,
  set: (v: unknown) => (ex.mode = v as 'zip' | 'folder' | 'share'),
})

/** 安卓多一项「分享」；桌面与浏览器没有系统分享面板，不占位置 */
const modeOptions = computed(() => [
  { value: 'zip', label: 'ZIP 压缩包' },
  { value: 'folder', label: '文件夹（逐张写入）', disabled: !canFolder },
  ...(canShare ? [{ value: 'share', label: '分享' }] : []),
])

const formatModel = computed({
  get: () => ex.format,
  set: (v: unknown) => (ex.format = v as 'jpg' | 'png'),
})

/* ---------- 导出范围：全部 / 自选（缩略图网格勾选） ---------- */

const scopeModel = computed({
  get: () => ex.scope,
  set: (v: unknown) => (ex.scope = v as 'all' | 'picked'),
})

// 切到自选时先全选：用户只需取消不要的，比从零勾选省力
watch(
  () => ex.scope,
  (v) => {
    if (v === 'picked' && ex.pickedCount === 0) ex.pickAll()
  },
)

const scopeCountText = computed(() =>
  ex.scope === 'picked' ? `已选 ${ex.pickedCount} / ${images.items.length} 张` : `共 ${images.items.length} 张`,
)

/* ---------- 大小预估：设置 / 范围 / 照片清单变化后防抖重算 ---------- */

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

const estimateText = computed(() =>
  ex.estimating ? '估算中…' : ex.estimate != null ? `约 ${fmtSize(ex.estimate)}` : '',
)

let estimateTimer = 0
function scheduleEstimate(): void {
  window.clearTimeout(estimateTimer)
  // 质量滑杆拖动会连续触发：停顿后才发起抽样渲染，避免估算排队堆积
  estimateTimer = window.setTimeout(() => void ex.refreshEstimate(), 500)
}
onMounted(() => scheduleEstimate())
watch(
  () => [
    ex.scope,
    ex.picked,
    ex.format,
    ex.quality,
    ex.longEdge,
    ex.keepExif,
    images.items.length,
    images.items.map((i) => i.id).join(','),
  ],
  scheduleEstimate,
)

/* ---------- 文件名模板：点按令牌插入光标处 ---------- */

const patternEl = ref<HTMLInputElement | null>(null)

async function insertPatternToken(key: string): Promise<void> {
  const token = `{${key}}`
  const el = patternEl.value
  if (el && el.selectionStart != null && el.selectionEnd != null) {
    const s = el.selectionStart
    const e2 = el.selectionEnd
    ex.pattern = ex.pattern.slice(0, s) + token + ex.pattern.slice(e2)
    await nextTick()
    el.focus()
    el.setSelectionRange(s + token.length, s + token.length)
  } else {
    ex.pattern += token
  }
}

async function start(): Promise<void> {
  await ex.run()
}
</script>

<template>
  <div class="export panel-scroll">
    <div class="head">
      <h1>导出</h1>
    </div>
    <template v-if="!running && !finished">
      <div class="field">
        <div class="scope-head">
          <span class="fl">导出范围</span>
          <span class="scope-count">{{ scopeCountText }}</span>
        </div>
        <AppSegment
          v-model="scopeModel"
          small
          :options="[
            { value: 'all', label: '全部照片' },
            { value: 'picked', label: '自选' },
          ]"
        />
        <!-- 自选网格：点击缩略图勾选 / 取消，超出面板高度内部滚动 -->
        <div v-if="ex.scope === 'picked'" class="pick-grid">
          <button
            v-for="it in images.items"
            :key="it.id"
            class="pick-cell"
            :class="{ on: ex.picked.has(it.id) }"
            :title="it.baseName || it.name"
            @click="ex.togglePick(it.id)"
          >
            <img v-if="it.thumbUrl" :src="it.thumbUrl" alt="" />
            <span v-else class="no-thumb"><Images :size="14" /></span>
            <span class="tick"><Check :size="11" /></span>
          </button>
        </div>
        <p v-if="ex.scope === 'picked' && ex.pickedCount === 0" class="mode-hint">
          尚未选择照片，点击上方缩略图勾选要导出的图片。
        </p>
      </div>
      <div class="field">
        <span class="fl">图像格式</span>
        <AppSegment
          v-model="formatModel"
          small
          :options="[
            { value: 'jpg', label: 'JPG（体积小）' },
            { value: 'png', label: 'PNG（无损）' },
          ]"
        />
      </div>
      <AppSlider
        v-if="ex.format === 'jpg'"
        v-model="ex.quality"
        :min="50"
        :max="100"
        label="图像质量"
        :format="(v) => `${v}%`"
        @reset="ex.quality = 90"
      />
      <div v-if="ex.format === 'jpg'" class="switch-row">
        <div class="text">
          <span class="fl">保留 EXIF 元数据</span>
        </div>
        <AppSwitch v-model="ex.keepExif" />
      </div>
      <div class="field">
        <span class="fl">图像长边像素</span>
        <div class="long-edge">
          <AppSegment
            v-model="longEdgeModel"
            small
            :options="[
              { value: '0', label: '原图' },
              { value: '2560', label: '2560' },
              { value: '1920', label: '1920' },
              { value: '1280', label: '1280' },
            ]"
          />
          <input
            class="num-input"
            type="number"
            min="0"
            max="20000"
            step="1"
            placeholder="自定义"
            :value="customLongEdge"
            @input="onCustomLongEdge"
          />
        </div>
      </div>
      <div class="field">
        <span class="fl">文件名模板</span>
        <input ref="patternEl" v-model="ex.pattern" class="text-input" spellcheck="false" />
        <div class="tokens">
          <button v-for="t in TOKENS" :key="t.key" class="chip" @click="insertPatternToken(t.key)">
            {{ t.label }}
          </button>
        </div>
      </div>
      <div class="field">
        <span class="fl">导出方式</span>
        <AppSegment v-model="modeModel" small :options="modeOptions" />
        <p v-if="modeModel === 'folder'" class="mode-hint">
          {{ isTauri ? '选择一个文件夹，照片逐张写入其中。' : '照片逐张写入公共 Documents/Albumark/ 下的按时间命名的文件夹。' }}
        </p>
        <p v-else-if="modeModel === 'share'" class="mode-hint">
          导出完成后打开系统分享面板，选择应用直接发送，不在公共目录留副本。
        </p>
      </div>
      <p v-if="estimateText" class="estimate" :class="{ computing: ex.estimating }" aria-live="polite">
        预计大小<strong>{{ estimateText }}</strong>
      </p>
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
        <p v-if="ex.resultPath" class="dest mono">{{ ex.resultPath }}</p>
        <ul v-if="ex.errors.length" class="errors">
          <li v-for="e in ex.errors" :key="e">{{ e }}</li>
        </ul>
        <div class="actions">
          <AppButton v-if="ex.resultPath && isTauri" @click="ex.openResult()">
            <FolderOpen :size="15" />打开所在文件夹
          </AppButton>
          <AppButton v-if="canShare && ex.shareUris.length" @click="ex.reshare()">
            <Share2 :size="15" />分享
          </AppButton>
          <AppButton variant="primary" @click="ex.reset()">完成</AppButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.head h1 {
  font-size: calc(15px * var(--ui-zoom, 1));
  font-weight: 600;
  letter-spacing: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
}
.fl {
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
}
/* 导出范围：标题行计数 + 自选缩略图网格 */
.scope-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.scope-count {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 6px;
  max-height: 168px;
  overflow-y: auto;
  padding: 2px;
  margin: 0 -2px;
}
.pick-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 7px;
  overflow: hidden;
  background: var(--hover);
  cursor: pointer;
  opacity: 0.45;
  /* 未选中的淡显 + 选中态描边：一眼分清哪些会导出 */
  transition: opacity var(--dur-hover) var(--ease-soft), box-shadow var(--dur-hover) var(--ease-soft),
    transform 90ms ease-out;
}
.pick-cell:active {
  transform: scale(0.94);
}
.pick-cell.on {
  opacity: 1;
  box-shadow: 0 0 0 2px var(--accent);
}
.pick-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pick-cell .no-thumb {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.pick-cell .tick {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  /* deslop-ignore-next-line 19 勾选徽标取圆形：多选控件的通用语言，与开关圆点一致 */
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-contrast, #1a1a1a);
  opacity: 0;
  transform: scale(0.6);
  transition: opacity var(--dur-hover) var(--ease-soft), transform var(--dur-hover) var(--ease-soft);
}
.pick-cell.on .tick {
  opacity: 1;
  transform: scale(1);
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0;
}
.switch-row .text {
  min-width: 0;
}
.mode-hint {
  margin: 0;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.5;
}
/* 大小预估：抽样实算的近似值，随设置变化防抖刷新 */
.estimate {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 14px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.estimate strong {
  font-variant-numeric: tabular-nums;
  color: var(--text);
  font-weight: 600;
}
.estimate.computing strong {
  color: var(--text-3);
  font-weight: 400;
}
.dest {
  margin: 6px 0 0;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text-input {
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.long-edge {
  display: flex;
  align-items: center;
  gap: 6px;
}
.long-edge .num-input {
  width: 72px;
  height: var(--control-h);
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: calc(12px * var(--ui-zoom, 1));
  font-variant-numeric: tabular-nums;
}
.long-edge .num-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  transition: color var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft);
}
.chip:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
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
  font-size: calc(15px * var(--ui-zoom, 1));
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.current {
  margin-top: 2px;
  font-size: calc(12px * var(--ui-zoom, 1));
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
  font-size: calc(12px * var(--ui-zoom, 1));
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
