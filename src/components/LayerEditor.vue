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
import { useFontsStore, FONT_CATEGORY_LABELS } from '@/stores/fonts'
import { useTemplatesStore } from '@/stores/templates'
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
const fonts = useFontsStore()

const fileInput = ref<HTMLInputElement | null>(null)
const replaceTargetId = ref<string | null>(null)
const showSave = ref(false)
const saveName = ref('')
const contentEl = ref<HTMLTextAreaElement | null>(null)
const showCustomFont = ref(false)

const selectedText = computed(() =>
  wm.selected?.type === 'text' ? (wm.selected as TextLayer) : null,
)
const selectedImage = computed(() =>
  wm.selected?.type === 'image' ? (wm.selected as ImageLayer) : null,
)

const DEFAULT_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'

const isCustomFont = computed(
  () => !!selectedText.value && selectedText.value.fontFamily !== DEFAULT_FONT && !fontInList(selectedText.value.fontFamily),
)

function fontInList(fontFamily: string): boolean {
  return fonts.fonts.some((f) => `"${f.family}"` === fontFamily) || fontLabelOf(fontFamily) !== null
}

/** 内置分组里按值反查显示名（兜底清单场景） */
function fontLabelOf(value: string): string | null {
  for (const g of fonts.grouped()) {
    const hit = g.items.find((f) => `"${f.family}"` === value)
    if (hit) return hit.family
  }
  return null
}

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

/* 偏移即固定像素：所有照片上距离一致，不随图片尺寸 / 比例缩放 */
const offX = computed(() => wm.selected?.offsetX ?? 0)
const offY = computed(() => wm.selected?.offsetY ?? 0)
function setOffsetX(px: number): void {
  if (!wm.selected) return
  wm.update(wm.selected.id, { offsetX: Math.round(px) })
}
function setOffsetY(px: number): void {
  if (!wm.selected) return
  wm.update(wm.selected.id, { offsetY: Math.round(px) })
}

/* 文字大小：以当前参照图长边上的像素值呈现（不同尺寸照片按比例换算） */
const long = computed(() => Math.max(props.imgW, props.imgH))
const fontPx = computed(() =>
  selectedText.value ? (selectedText.value.scale / 100) * long.value : 0,
)
function setFontPx(px: number): void {
  if (!selectedText.value) return
  wm.update(selectedText.value.id, { scale: (px / long.value) * 100 })
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
  // 自定义名称优先（默认名「文本水印」视为未命名，继续显示内容前缀）
  if (l.name.trim() && l.name !== '文本水印') return l.name
  if (l.type === 'text') return l.content.split('\n')[0]?.slice(0, 16) || '文本水印'
  return l.name
}

/* 双击图层名称：行内重命名（Enter/失焦确认，Escape 取消） */
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(l: WatermarkLayer): void {
  renamingId.value = l.id
  renameValue.value = layerName(l)
}

function commitRename(): void {
  const l = wm.layers.find((x) => x.id === renamingId.value)
  if (l) wm.update(l.id, { name: renameValue.value.trim() })
  renamingId.value = null
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

/* 自定义字体：字体列表由 fonts store 提供（系统扫描或兜底清单），也支持手动键入名称 */
const manualFontName = ref('')
function openCustomFont(): void {
  showCustomFont.value = true
  void fonts.ensureFonts()
}
async function scanFonts(): Promise<void> {
  await fonts.ensureFonts()
  if (fonts.denied) toast('无法访问系统字体，可手动输入名称', 'error')
  else if (!fonts.fonts.length) toast('没有扫描到系统字体，可手动输入名称')
}
function applyCustomFont(): void {
  const t = selectedText.value
  const name = manualFontName.value.trim()
  if (!t || !name) return
  wm.update(t.id, { fontFamily: `"${name}"` })
  showCustomFont.value = false
  manualFontName.value = ''
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
        <input
          v-if="renamingId === l.id"
          v-model="renameValue"
          class="name-edit"
          spellcheck="false"
          @click.stop
          @keyup.enter="commitRename"
          @keyup.escape="renamingId = null"
          @blur="commitRename"
        />
        <span v-else class="name" title="双击重命名" @dblclick.stop="startRename(l)">{{ layerName(l) }}</span>
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
              :value="isCustomFont ? '__current__' : selectedText!.fontFamily"
              @focus="fonts.ensureFonts()"
              @pointerdown="fonts.ensureFonts()"
              @change="
                ($event.target as HTMLSelectElement).value === '__custom__'
                  ? openCustomFont()
                  : wm.update(selectedText!.id, { fontFamily: ($event.target as HTMLSelectElement).value })
              "
            >
              <option v-if="isCustomFont" value="__current__">
                自定义：{{ selectedText!.fontFamily.replace(/"/g, '') }}
              </option>
              <option :value="DEFAULT_FONT">系统默认</option>
              <optgroup
                v-for="g in fonts.grouped()"
                :key="g.category"
                :label="FONT_CATEGORY_LABELS[g.category]"
              >
                <option v-for="f in g.items" :key="f.family" :value="`&quot;${f.family}&quot;`">
                  {{ f.family }}
                </option>
              </optgroup>
              <option value="__custom__">手动输入字体名…</option>
            </select>
          </label>
          <div class="field">
            <span>字重</span>
            <AppSlider
              :model-value="selectedText!.fontWeight"
              :min="100"
              :max="900"
              :step="1"
              :default="600"
              @update:model-value="wm.update(selectedText!.id, { fontWeight: $event })"
              @reset="wm.update(selectedText!.id, { fontWeight: 600 })"
            />
          </div>
        </div>
        <p v-if="fonts.loading" class="hint">正在读取系统字体…</p>
        <p v-else-if="fonts.denied" class="hint">浏览器未授权读取系统字体，以下为常用字体清单，也可手动键入。</p>
        <div v-if="showCustomFont" class="custom-font">
          <input
            v-model="manualFontName"
            class="text-input"
            list="local-font-list"
            placeholder="输入系统已安装的字体名称"
            spellcheck="false"
            @keyup.enter="applyCustomFont"
          />
          <datalist id="local-font-list">
            <option v-for="f in fonts.fonts" :key="f.family" :value="f.family" />
          </datalist>
          <AppButton size="sm" @click="scanFonts">重新扫描</AppButton>
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
        <p class="anchor-label">定位锚点</p>
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
        <template v-if="wm.selected!.type === 'text'">
          <p class="anchor-label">文字框锚点</p>
          <div class="anchor-grid" role="group" aria-label="文字框锚点">
            <button
              v-for="a in anchors"
              :key="a.key"
              :title="a.label"
              :class="{ on: (selectedText!.boxAnchor ?? 'middle-center') === a.key }"
              @click="wm.update(selectedText!.id, { boxAnchor: a.key })"
            >
              <span />
            </button>
          </div>
          <p class="hint">决定文字框的哪个位置对准定位锚点：居中即框中心对准，选角时文字向另一侧展开。</p>
        </template>
        <AppSlider
          :model-value="offX"
          :min="-1200"
          :max="1200"
          label="距锚点 · 水平"
          :format="(v) => `${Math.round(v)} px`"
          @update:model-value="setOffsetX"
          @reset="setOffsetX(0)"
        />
        <AppSlider
          :model-value="offY"
          :min="-1200"
          :max="1200"
          label="距锚点 · 垂直"
          :format="(v) => `${Math.round(v)} px`"
          @update:model-value="setOffsetY"
          @reset="setOffsetY(0)"
        />
        <p class="hint">以锚点为起点的固定像素距离：所有照片上保持一致，不随图片尺寸或比例缩放。</p>
        <AppSlider
          v-if="wm.selected!.type === 'text'"
          :model-value="fontPx"
          :min="8"
          :max="Math.round(long * 0.35)"
          :step="0.5"
          label="文字大小"
          :format="(v) => `${Math.round(v)} px`"
          @update:model-value="setFontPx"
          @reset="setFontPx(Math.round(long * 0.036))"
        />
        <AppSlider
          v-else
          :model-value="wm.selected!.scale"
          :min="1"
          :max="80"
          :step="0.1"
          label="素材高度"
          :format="(v) => `${v.toFixed(1)}%`"
          @update:model-value="wm.update(wm.selected!.id, { scale: $event })"
          @reset="wm.update(wm.selected!.id, { scale: 20 })"
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
  width: 100%;
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
.name-edit {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--bg);
  font-size: 12px;
  outline: none;
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
.anchor-label {
  font-size: 11.5px;
  color: var(--text-3);
  text-align: center;
  margin-bottom: 5px;
}
.anchor-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  width: 132px;
  margin: 0 auto 10px;
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
