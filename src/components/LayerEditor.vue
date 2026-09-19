<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Replace,
  TriangleAlert,
  Trash2,
  Type,
} from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import type { DropdownItem } from '@/components/ui/AppDropdown.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { TOKENS, missingTokens } from '@/core/tokens'
import { toast } from '@/stores/toast'
import { useTemplatesStore } from '@/stores/templates'
import { usePresetsStore } from '@/stores/presets'
import { useWatermarkStore } from '@/stores/watermark'
import type { AnchorPreset, ImageLayer, TextLayer, WatermarkLayer } from '@/types/watermark'
import type { ExifSummary } from '@/types/image'

const props = withDefaults(
  defineProps<{
    /** 像素距离换算用的图片尺寸（预览样张或当前照片） */
    imgW?: number
    imgH?: number
    /** 当前照片 EXIF（用于缺失令牌警告与令牌替换预览） */
    exif?: ExifSummary
    baseName?: string
    /** 隐藏模板/预设相关入口（工作室里由页面自己管理） */
    showTemplates?: boolean
  }>(),
  { imgW: 1600, imgH: 1067, exif: undefined, baseName: undefined, showTemplates: true },
)

const wm = useWatermarkStore()
const templates = useTemplatesStore()
const presets = usePresetsStore()

const fileInput = ref<HTMLInputElement | null>(null)
const replaceTargetId = ref<string | null>(null)
const showSave = ref(false)
const saveName = ref('')
const contentEl = ref<HTMLTextAreaElement | null>(null)
const showCustomFont = ref(false)
const customFontName = ref('')

const selectedText = computed(() =>
  wm.selected?.type === 'text' ? (wm.selected as TextLayer) : null,
)
const selectedImage = computed(() =>
  wm.selected?.type === 'image' ? (wm.selected as ImageLayer) : null,
)

const FONT_OPTIONS = [
  { value: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif', label: '系统黑体' },
  { value: '"Songti SC", "STSong", "SimSun", serif', label: '宋体' },
  { value: '"Kaiti SC", "STKaiti", "KaiTi", serif', label: '楷体' },
  { value: 'Arial, "Helvetica Neue", sans-serif', label: 'Arial' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: 'ui-monospace, "SF Mono", Menlo, monospace', label: '等宽字体' },
]

const isCustomFont = computed(
  () => !!selectedText.value && !FONT_OPTIONS.some((f) => f.value === selectedText.value!.fontFamily),
)

const BLEND_OPTIONS = [
  { value: 'normal', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'soft-light', label: '柔光' },
  { value: 'difference', label: '差值' },
  { value: 'luminosity', label: '明度' },
]

const anchors: { key: AnchorPreset; label: string }[] = [
  { key: 'top-left', label: '左上' },
  { key: 'top-center', label: '上中' },
  { key: 'top-right', label: '右上' },
  { key: 'middle-left', label: '左中' },
  { key: 'middle-center', label: '居中' },
  { key: 'middle-right', label: '右中' },
  { key: 'bottom-left', label: '左下' },
  { key: 'bottom-center', label: '下中' },
  { key: 'bottom-right', label: '右下' },
]

/** 内容里用到的 EXIF 令牌在当前照片上解析不出值 → 常驻警告 */
const missing = computed(() => {
  const t = selectedText.value
  if (!t) return []
  return missingTokens(t.content, props.exif, props.baseName)
})

/* 像素距离 ↔ 百分比偏移 */
const offX = computed(() => (wm.selected ? (wm.selected.offsetX / 100) * props.imgW : 0))
const offY = computed(() => (wm.selected ? (wm.selected.offsetY / 100) * props.imgH : 0))
function setOffsetX(px: number): void {
  if (!wm.selected) return
  wm.update(wm.selected.id, { offsetX: (px / props.imgW) * 100 })
}
function setOffsetY(px: number): void {
  if (!wm.selected) return
  wm.update(wm.selected.id, { offsetY: (px / props.imgH) * 100 })
}

function pickImage(replaceId: string | null): void {
  replaceTargetId.value = replaceId
  fileInput.value?.click()
}

async function onImageFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    if (replaceTargetId.value) {
      await wm.replaceImageFile(replaceTargetId.value, file)
      toast('素材已替换')
    } else {
      await wm.addImageFile(file)
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : '素材导入失败', 'error')
  }
  replaceTargetId.value = null
}

function layerName(l: WatermarkLayer): string {
  if (l.type === 'text') return l.content.split('\n')[0]?.slice(0, 16) || '文本水印'
  return l.name
}

function templateItems(): DropdownItem[] {
  return [
    { label: '把当前配置存为模板…', action: () => (showSave.value = true) },
    ...templates.all.map((t) => ({
      label: `应用模板「${t.name}」`,
      action: () => {
        void templates.apply(t.id)
        toast(`已应用模板「${t.name}」`)
      },
    })),
    ...presets.all.map((p) => ({
      label: `应用水印「${p.name}」`,
      action: () => {
        presets.apply(p.id)
        toast(`已应用水印「${p.name}」`)
      },
    })),
  ]
}

async function saveTemplate(): Promise<void> {
  const name = saveName.value.trim()
  if (!name) return
  if (!templates.save(name)) {
    toast('模板过大，保存失败', 'error')
    return
  }
  showSave.value = false
  saveName.value = ''
  toast(`已保存模板「${name}」`, 'success')
}

function insertToken(key: string): void {
  const layer = selectedText.value
  if (!layer) return
  const token = `{${key}}`
  const el = contentEl.value
  if (el && el.selectionStart != null && el.selectionEnd != null) {
    const s = el.selectionStart
    const e2 = el.selectionEnd
    wm.update(layer.id, { content: layer.content.slice(0, s) + token + layer.content.slice(e2) })
    void nextTick(() => {
      el.focus()
      el.setSelectionRange(s + token.length, s + token.length)
    })
  } else {
    wm.update(layer.id, { content: layer.content + token })
  }
}

/* 自定义字体：优先扫描系统字体（Chromium 内核），否则手动输入名称 */
interface FontDataLike {
  family: string
}
function supportLocalFonts(): boolean {
  return typeof (window as { queryLocalFonts?: unknown }).queryLocalFonts === 'function'
}
const scannedFonts = ref<string[]>([])
async function scanFonts(): Promise<void> {
  try {
    const fonts = (await (window as unknown as {
      queryLocalFonts: () => Promise<FontDataLike[]>
    }).queryLocalFonts()) as FontDataLike[]
    scannedFonts.value = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
    if (!scannedFonts.value.length) toast('没有扫描到系统字体，可手动输入名称')
  } catch {
    toast('无法访问系统字体，可手动输入名称', 'error')
  }
}
function applyCustomFont(): void {
  const t = selectedText.value
  const name = customFontName.value.trim()
  if (!t || !name) return
  wm.update(t.id, { fontFamily: `"${name}"` })
  showCustomFont.value = false
  toast(`已使用字体「${name}」`, 'success')
}
</script>

<template>
  <div class="panel-scroll">
    <div class="row">
      <AppButton size="sm" @click="wm.addText()"><Type :size="13" />文本</AppButton>
      <AppButton size="sm" @click="pickImage(null)"><ImageIcon :size="13" />图片 / SVG</AppButton>
      <span class="flex" />
      <AppDropdown v-if="showTemplates" :items="templateItems()" align="right">
        <template #trigger>
          <AppButton size="sm">模板</AppButton>
        </template>
      </AppDropdown>
    </div>

    <div v-if="showSave" class="save-row">
      <input v-model="saveName" class="text-input" placeholder="模板名称" @keyup.enter="saveTemplate" />
      <AppButton size="sm" variant="primary" @click="saveTemplate">保存</AppButton>
      <AppButton size="sm" variant="ghost" @click="showSave = false">取消</AppButton>
    </div>

    <ul class="layers" v-if="wm.layers.length">
      <li
        v-for="(l, i) in wm.layers"
        :key="l.id"
        class="layer"
        :class="{ active: l.id === wm.selectedId }"
        @click="wm.selectedId = l.id"
      >
        <Type v-if="l.type === 'text'" :size="13" class="icon" />
        <ImageIcon v-else :size="13" class="icon" />
        <span class="name">{{ layerName(l) }}</span>
        <button
          class="tool"
          :aria-label="l.visible ? '隐藏图层' : '显示图层'"
          @click.stop="wm.update(l.id, { visible: !l.visible })"
        >
          <Eye v-if="l.visible" :size="13" />
          <EyeOff v-else :size="13" />
        </button>
        <button class="tool" aria-label="上移" :disabled="i === 0" @click.stop="wm.move(i, -1)">
          <ArrowUp :size="13" />
        </button>
        <button
          class="tool"
          aria-label="下移"
          :disabled="i === wm.layers.length - 1"
          @click.stop="wm.move(i, 1)"
        >
          <ArrowDown :size="13" />
        </button>
        <button class="tool danger" aria-label="删除图层" @click.stop="wm.remove(l.id)">
          <Trash2 :size="13" />
        </button>
      </li>
    </ul>
    <p v-else class="empty">还没有图层。添加文本或图片，开始制作水印。</p>

    <template v-if="selectedText">
      <section>
        <h3>内容</h3>
        <div v-if="missing.length" class="warn" role="alert">
          <TriangleAlert :size="13" />
          <span>这张照片缺少：{{ missing.map((m) => m.label).join('、') }}，对应令牌会留空。</span>
        </div>
        <textarea
          ref="contentEl"
          :value="selectedText.content"
          rows="3"
          class="text-input area"
          spellcheck="false"
          @input="wm.update(selectedText!.id, { content: ($event.target as HTMLTextAreaElement).value })"
        />
        <p class="tokens-hint">点击插入 EXIF 令牌，导出时按每张照片的信息替换：</p>
        <div class="tokens">
          <button v-for="t in TOKENS" :key="t.key" class="chip" @click="insertToken(t.key)">
            {{ t.label }}
          </button>
        </div>

        <div class="grid2">
          <label class="field">
            <span>字体</span>
            <select
              class="select"
              :value="isCustomFont ? '__custom__' : selectedText!.fontFamily"
              @change="
                ($event.target as HTMLSelectElement).value === '__custom__'
                  ? (showCustomFont = true)
                  : wm.update(selectedText!.id, { fontFamily: ($event.target as HTMLSelectElement).value })
              "
            >
              <option v-if="isCustomFont" value="__custom__">
                自定义：{{ selectedText!.fontFamily.replace(/"/g, '') }}
              </option>
              <option v-for="f in FONT_OPTIONS" :key="f.label" :value="f.value">{{ f.label }}</option>
              <option value="__custom__">自定义字体…</option>
            </select>
          </label>
          <label class="field">
            <span>字重</span>
            <select
              class="select"
              :value="String(selectedText!.fontWeight)"
              @change="wm.update(selectedText!.id, { fontWeight: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option value="300">细</option>
              <option value="400">常规</option>
              <option value="500">中等</option>
              <option value="600">半粗</option>
              <option value="700">粗</option>
            </select>
          </label>
        </div>
        <div v-if="showCustomFont" class="custom-font">
          <input
            v-model="customFontName"
            class="text-input"
            list="local-font-list"
            placeholder="输入系统已安装的字体名称"
            spellcheck="false"
          />
          <datalist id="local-font-list">
            <option v-for="f in scannedFonts" :key="f" :value="f" />
          </datalist>
          <AppButton v-if="supportLocalFonts()" size="sm" @click="scanFonts">扫描系统字体</AppButton>
          <AppButton size="sm" variant="primary" @click="applyCustomFont">应用</AppButton>
          <AppButton size="sm" variant="ghost" @click="showCustomFont = false">取消</AppButton>
        </div>
        <div class="row-inline">
          <span class="fl">颜色</span>
          <input
            type="color"
            class="color"
            :value="selectedText.color"
            @input="wm.update(selectedText!.id, { color: ($event.target as HTMLInputElement).value })"
          />
          <AppSwitch
            :model-value="selectedText.italic"
            @update:model-value="wm.update(selectedText!.id, { italic: $event })"
          />
          <span class="fl">斜体</span>
          <span class="flex" />
          <AppSegment
            small
            :model-value="selectedText.align"
            :options="[
              { value: 'left', label: '左' },
              { value: 'center', label: '中' },
              { value: 'right', label: '右' },
            ]"
            @update:model-value="wm.update(selectedText!.id, { align: $event as TextLayer['align'] })"
          />
        </div>
        <AppSlider
          :model-value="selectedText.letterSpacing"
          :min="0"
          :max="30"
          :step="0.5"
          label="字距"
          @update:model-value="wm.update(selectedText!.id, { letterSpacing: $event })"
          @reset="wm.update(selectedText!.id, { letterSpacing: 4 })"
        />
        <AppSlider
          :model-value="selectedText.lineHeight"
          :min="1"
          :max="2.5"
          :step="0.05"
          label="行高"
          :format="(v) => v.toFixed(2)"
          @update:model-value="wm.update(selectedText!.id, { lineHeight: $event })"
          @reset="wm.update(selectedText!.id, { lineHeight: 1.45 })"
        />

        <details class="group">
          <summary>描边</summary>
          <AppSwitch
            :model-value="selectedText.stroke.enabled"
            @update:model-value="wm.update(selectedText!.id, { stroke: { ...selectedText!.stroke, enabled: $event } })"
          />
          <template v-if="selectedText.stroke.enabled">
            <AppSlider
              :model-value="selectedText.stroke.width"
              :min="0"
              :max="20"
              :step="0.5"
              label="描边宽度"
              @update:model-value="wm.update(selectedText!.id, { stroke: { ...selectedText!.stroke, width: $event } })"
              @reset="wm.update(selectedText!.id, { stroke: { ...selectedText!.stroke, width: 6 } })"
            />
            <input
              type="color"
              class="color"
              :value="selectedText.stroke.color"
              @input="wm.update(selectedText!.id, { stroke: { ...selectedText!.stroke, color: ($event.target as HTMLInputElement).value } })"
            />
          </template>
        </details>

        <details class="group">
          <summary>阴影</summary>
          <AppSwitch
            :model-value="selectedText.shadow.enabled"
            @update:model-value="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, enabled: $event } })"
          />
          <template v-if="selectedText.shadow.enabled">
            <AppSlider
              :model-value="selectedText.shadow.blur"
              :min="0"
              :max="60"
              label="模糊"
              @update:model-value="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, blur: $event } })"
              @reset="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, blur: 18 } })"
            />
            <AppSlider
              :model-value="selectedText.shadow.opacity"
              :min="0"
              :max="100"
              label="不透明度"
              @update:model-value="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, opacity: $event } })"
              @reset="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, opacity: 55 } })"
            />
            <AppSlider
              :model-value="selectedText.shadow.x"
              :min="-40"
              :max="40"
              label="水平偏移"
              @update:model-value="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, x: $event } })"
              @reset="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, x: 0 } })"
            />
            <AppSlider
              :model-value="selectedText.shadow.y"
              :min="-40"
              :max="40"
              label="垂直偏移"
              @update:model-value="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, y: $event } })"
              @reset="wm.update(selectedText!.id, { shadow: { ...selectedText!.shadow, y: 8 } })"
            />
          </template>
        </details>

        <details class="group">
          <summary>背景填充</summary>
          <AppSwitch
            :model-value="selectedText.background.enabled"
            @update:model-value="wm.update(selectedText!.id, { background: { ...selectedText!.background, enabled: $event } })"
          />
          <template v-if="selectedText.background.enabled">
            <div class="row-inline">
              <span class="fl">颜色</span>
              <input
                type="color"
                class="color"
                :value="selectedText.background.color"
                @input="wm.update(selectedText!.id, { background: { ...selectedText!.background, color: ($event.target as HTMLInputElement).value } })"
              />
            </div>
            <AppSlider
              :model-value="selectedText.background.opacity"
              :min="0"
              :max="100"
              label="不透明度"
              @update:model-value="wm.update(selectedText!.id, { background: { ...selectedText!.background, opacity: $event } })"
              @reset="wm.update(selectedText!.id, { background: { ...selectedText!.background, opacity: 45 } })"
            />
            <AppSlider
              :model-value="selectedText.background.padding"
              :min="0"
              :max="30"
              :step="0.5"
              label="内边距"
              @update:model-value="wm.update(selectedText!.id, { background: { ...selectedText!.background, padding: $event } })"
              @reset="wm.update(selectedText!.id, { background: { ...selectedText!.background, padding: 6 } })"
            />
            <AppSlider
              :model-value="selectedText.background.radius"
              :min="0"
              :max="50"
              label="圆角"
              @update:model-value="wm.update(selectedText!.id, { background: { ...selectedText!.background, radius: $event } })"
              @reset="wm.update(selectedText!.id, { background: { ...selectedText!.background, radius: 14 } })"
            />
          </template>
        </details>
      </section>
    </template>

    <template v-if="selectedImage">
      <section>
        <h3>素材</h3>
        <p class="asset-name">{{ selectedImage.name }}</p>
        <AppButton size="sm" @click="pickImage(selectedImage.id)">
          <Replace :size="13" />替换图片
        </AppButton>
      </section>
    </template>

    <template v-if="wm.selected">
      <section>
        <h3>位置与变换</h3>
        <div class="anchor-grid" role="group" aria-label="定位锚点">
          <button
            v-for="a in anchors"
            :key="a.key"
            :title="a.label"
            :class="{ on: wm.selected!.anchor === a.key }"
            @click="wm.positionPreset(a.key)"
          >
            <span />
          </button>
        </div>
        <AppSlider
          :model-value="offX"
          :min="-Math.round(imgW * 0.6)"
          :max="Math.round(imgW * 0.6)"
          label="距锚点 · 水平"
          :format="(v) => `${Math.round(v)} px`"
          @update:model-value="setOffsetX"
          @reset="setOffsetX(0)"
        />
        <AppSlider
          :model-value="offY"
          :min="-Math.round(imgH * 0.6)"
          :max="Math.round(imgH * 0.6)"
          label="距锚点 · 垂直"
          :format="(v) => `${Math.round(v)} px`"
          @update:model-value="setOffsetY"
          @reset="setOffsetY(0)"
        />
        <p class="hint">以锚点为起点，按当前照片的像素距离确定位置；不同尺寸的照片按比例换算。</p>
        <AppSlider
          :model-value="wm.selected.scale"
          :min="wm.selected.type === 'image' ? 1 : 0.5"
          :max="wm.selected.type === 'image' ? 80 : 40"
          :step="0.1"
          :label="wm.selected.type === 'image' ? '素材高度' : '文字大小'"
          :format="(v) => `${v.toFixed(1)}%`"
          @update:model-value="wm.update(wm.selected!.id, { scale: $event })"
          @reset="wm.update(wm.selected!.id, { scale: wm.selected!.type === 'image' ? 20 : 3.6 })"
        />
        <AppSlider
          :model-value="wm.selected.rotation"
          :min="-180"
          :max="180"
          label="旋转"
          :format="(v) => `${v}°`"
          @update:model-value="wm.update(wm.selected!.id, { rotation: $event })"
          @reset="wm.update(wm.selected!.id, { rotation: 0 })"
        />
        <AppSlider
          :model-value="wm.selected.opacity"
          :min="0"
          :max="100"
          label="不透明度"
          @update:model-value="wm.update(wm.selected!.id, { opacity: $event })"
          @reset="wm.update(wm.selected!.id, { opacity: 100 })"
        />
        <div class="row-inline">
          <span class="fl">混合</span>
          <select
            class="select grow"
            :value="wm.selected.blend"
            @change="wm.update(wm.selected!.id, { blend: ($event.target as HTMLSelectElement).value as WatermarkLayer['blend'] })"
          >
            <option v-for="b in BLEND_OPTIONS" :key="b.value" :value="b.value">{{ b.label }}</option>
          </select>
        </div>

        <details class="group" :open="wm.selected.tile.enabled">
          <summary>平铺整图</summary>
          <div class="row-inline">
            <AppSwitch
              :model-value="wm.selected.tile.enabled"
              @update:model-value="wm.update(wm.selected!.id, { tile: { ...wm.selected!.tile, enabled: $event } })"
            />
            <span class="fl">铺满整张照片</span>
          </div>
          <template v-if="wm.selected.tile.enabled">
            <AppSlider
              :model-value="wm.selected.tile.gapX"
              :min="0"
              :max="300"
              label="水平间距"
              :format="(v) => `${v}%`"
              @update:model-value="wm.update(wm.selected!.id, { tile: { ...wm.selected!.tile, gapX: $event } })"
              @reset="wm.update(wm.selected!.id, { tile: { ...wm.selected!.tile, gapX: 120 } })"
            />
            <AppSlider
              :model-value="wm.selected.tile.gapY"
              :min="0"
              :max="300"
              label="垂直间距"
              :format="(v) => `${v}%`"
              @update:model-value="wm.update(wm.selected!.id, { tile: { ...wm.selected!.tile, gapY: $event } })"
              @reset="wm.update(wm.selected!.id, { tile: { ...wm.selected!.tile, gapY: 90 } })"
            />
          </template>
        </details>
      </section>
    </template>

    <input
      ref="fileInput"
      type="file"
      accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp"
      hidden
      @change="onImageFile"
    />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.flex {
  flex: 1;
}
.save-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
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
.text-input.area {
  height: auto;
  padding: 8px 10px;
  line-height: 1.6;
  resize: vertical;
}
.warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 9px;
  margin-bottom: 8px;
  border-radius: var(--r-s);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent-soft);
  color: var(--text-2);
  font-size: 11.5px;
  line-height: 1.5;
}
.warn svg {
  flex: none;
  margin-top: 1px;
  color: var(--accent);
}
.custom-font {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}
.layers {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.layer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background var(--dur-hover) var(--ease-soft);
}
.layer:hover {
  background: var(--hover);
}
.layer.active {
  background: var(--accent-soft);
}
.layer .icon {
  color: var(--text-3);
  flex: none;
}
.layer .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--text-3);
  flex: none;
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.tool:hover:not(:disabled) {
  color: var(--text);
  background: var(--active);
}
.tool.danger:hover {
  color: var(--danger);
}
.tool:disabled {
  opacity: 0.3;
}
.empty {
  color: var(--text-3);
  padding: 8px 2px 12px;
}
section {
  border-top: 1px solid var(--line);
  padding: 10px 0 14px;
}
h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}
.tokens-hint {
  font-size: 11.5px;
  color: var(--text-3);
  margin: 8px 0 4px;
}
.tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 10px;
}
.chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-2);
  transition: all var(--dur-hover) var(--ease-soft);
}
.chip:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 10px 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field span,
.fl {
  font-size: 12px;
  color: var(--text-2);
}
.select {
  height: var(--control-h);
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  padding: 0 8px;
  font-size: 12.5px;
}
.select.grow {
  flex: 1;
}
.row-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.color {
  width: 30px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.group {
  margin-top: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  padding: 8px 10px;
}
.group summary {
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text-2);
  user-select: none;
}
.group summary:hover {
  color: var(--text);
}
.anchor-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  max-width: 132px;
  margin-bottom: 10px;
}
.anchor-grid button {
  aspect-ratio: 1;
  border-radius: 6px;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  transition: all var(--dur-hover) var(--ease-soft);
}
.anchor-grid button span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-3);
  transition: background var(--dur-hover) var(--ease-soft), transform var(--dur-hover) var(--ease-soft);
}
.anchor-grid button:hover {
  border-color: var(--accent);
}
.anchor-grid button.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.anchor-grid button.on span {
  background: var(--accent);
  transform: scale(1.5);
}
.hint {
  font-size: 11px;
  color: var(--text-3);
  margin: -4px 0 8px;
  line-height: 1.5;
}
.asset-name {
  font-size: 12.5px;
  color: var(--text-2);
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
