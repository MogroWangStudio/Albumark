<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Aperture,
  Blend,
  Bookmark,
  ChevronDown,
  Circle,
  CloudFog,
  CloudMoon,
  Contrast,
  Droplet,
  Focus,
  Palette,
  Pipette,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  SunDim,
  Thermometer,
  Zap,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AdjustPresetCard from '@/components/ui/AdjustPresetCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import CurveEditor from '@/components/ui/CurveEditor.vue'
import { buildPresetBase } from '@/core/presetThumb'
import { useAdjustStore } from '@/stores/adjust'
import { useAdjustPresetsStore, type AdjustPreset } from '@/stores/adjustPresets'
import { useImagesStore } from '@/stores/images'
import { toast } from '@/stores/toast'
import {
  ADJUST_DEFS,
  DENOISE_DEFAULT,
  DENOISE_METHODS,
  HSL_BANDS,
  isCurvesNeutral,
  isCurveNeutral,
  isHslNeutral,
  isNeutral,
  neutralHsl,
  sameAdjustments,
  type Adjustments,
  type Curves,
  type SliderKey,
} from '@/types/adjust'

const adjust = useAdjustStore()
const presets = useAdjustPresetsStore()
const images = useImagesStore()

const icons: Record<string, Component> = {
  exposure: Aperture,
  brightness: Sun,
  contrast: Contrast,
  highlights: SunDim,
  shadows: CloudMoon,
  temperature: Thermometer,
  tint: Droplet,
  vibrance: Blend,
  saturation: Palette,
  dehaze: CloudFog,
  clarity: Focus,
  sharpen: Zap,
  grain: Sparkles,
  vignette: Circle,
}

const activeId = computed(() => images.active?.id ?? null)
const individual = computed(() => adjust.isIndividual(activeId.value))

/** 当前生效的参数对象：单独调节时写入该照片的独立参数，否则写全局 */
const target = computed<Adjustments>(() =>
  individual.value && activeId.value ? adjust.perImage[activeId.value] : adjust.values,
)

function sameAdjust(a: Adjustments, b: Adjustments): boolean {
  return sameAdjustments(a, b)
}

const matchesGlobal = computed(() => {
  if (!individual.value || !activeId.value) return false
  return sameAdjust(target.value, adjust.values)
})

function onReset(): void {
  if (individual.value) adjust.resetToGlobal(activeId.value)
  else adjust.reset()
}

/**
 * 单项复位：只把这一项归零。
 * 这里曾经在「单独调节」下调用 resetToGlobal()——点某一项的复位按钮会把
 * 整张照片的所有调节一起还原成全局，属于明显的误伤。
 */
function resetOne(key: SliderKey): void {
  target.value[key] = 0
}

/* ---------- 曲线：合成通道 + R/G/B ---------- */

/** 旧数据只有合成曲线 curve：读时并给 rgb 通道，写回时清掉旧字段避免二次应用 */
const curvesModel = computed<Curves | undefined>({
  get: () => target.value.curves ?? (target.value.curve ? { rgb: target.value.curve } : undefined),
  set: (v) => {
    if (target.value.curve) delete target.value.curve
    if (v && Object.keys(v).length) target.value.curves = v
    else delete target.value.curves
  },
})

/* ---------- 白平衡吸管 ---------- */

function togglePick(): void {
  if (!activeId.value) return
  const next = !adjust.pickingWb
  adjust.setPickingWb(next)
  if (next) toast('在画面上点按中性灰或白色的位置')
}

/* ---------- 调节预设 ---------- */

const presetOpen = ref(false)
const presetSaving = ref(false)
const presetName = ref('')

/** 应用目标：多选模式取勾选的照片，否则当前照片 */
const presetTargetIds = computed<string[]>(() => {
  const picked = [...images.selectedIds]
  if (images.multiSelect && picked.length) return picked
  return activeId.value ? [activeId.value] : []
})

const presetHint = computed(() =>
  presetTargetIds.value.length > 1
    ? `已选 ${presetTargetIds.value.length} 张，点击预设套用到这些照片`
    : '点击预设套用到当前照片',
)

/**
 * 卡片缩略图的底图：优先用当前照片的图库缩略图，套上预设参数实时算出效果；
 * 没有照片时用内置合成样张。切换照片时异步换底，逐张缓存。
 */
const presetBase = ref<ImageData | null>(null)
let baseSeq = 0
watch(
  () => images.active?.thumbUrl ?? '',
  async (url) => {
    const seq = ++baseSeq
    const data = await buildPresetBase(url)
    // 连续切图时只认最后一次，避免旧底图覆盖新照片
    if (seq === baseSeq) presetBase.value = data
  },
  { immediate: true },
)

/** 当前照片的参数与哪条预设完全一致（用于「已应用」标记与选中态） */
const activePresetId = computed(
  () => presets.list.find((p) => sameAdjustments(target.value, p.values))?.id ?? null,
)

/** 卡片第二行：有效调节项数 + 保存日期 */
function presetInfo(p: AdjustPreset): string {
  const v = p.values
  let n = 0
  for (const { key } of ADJUST_DEFS) if (v[key] !== 0) n++
  if (v.vignette !== 0) n++
  if ((v.denoise ?? 0) > 0) n++
  if (!isCurvesNeutral(v.curves) || !isCurveNeutral(v.curve)) n++
  if (!isHslNeutral(v.hsl)) n++
  const d = new Date(p.createdAt)
  return `${n ? `${n} 项调节` : '中性参数'} · ${d.getMonth() + 1}月${d.getDate()}日`
}

function openPresetSave(): void {
  presetName.value = `调节预设 ${presets.list.length + 1}`
  presetSaving.value = true
}

function confirmPresetSave(): void {
  const p = presets.save(presetName.value, adjust.snapshotFor(activeId.value))
  presetSaving.value = false
  presetOpen.value = true
  toast(`已保存预设「${p.name}」`, 'success')
}

function applyPreset(p: AdjustPreset): void {
  const n = presets.apply(p)
  if (!n) {
    toast('先选择一张照片', 'error')
    return
  }
  toast(n > 1 ? `已将「${p.name}」套用到 ${n} 张照片` : `已套用「${p.name}」`, 'success')
}

function applyPresetAll(p: AdjustPreset): void {
  presets.applyToAll(p)
  toast(`已将「${p.name}」应用为全局调节`, 'success')
}

/* ---------- HSL 分色 ---------- */

const hslOpen = ref(false)
const selectedBand = ref(0)
const hslNeutral = computed(() => isHslNeutral(target.value.hsl))

function hslVal(band: number, ch: 'h' | 's' | 'l'): number {
  return target.value.hsl?.[ch]?.[band] ?? 0
}

function hslSet(band: number, ch: 'h' | 's' | 'l', v: number): void {
  // 三通道一律重建纯数组：从旧对象展开会把未编辑通道的响应式 Proxy 一起带进
  // values.hsl，Worker 的 structuredClone 拒绝 Proxy —— 第二次调整起渲染静默失败
  const cur = target.value.hsl
  const base = neutralHsl()
  if (cur) {
    base.h = [...cur.h]
    base.s = [...cur.s]
    base.l = [...cur.l]
  }
  base[ch][band] = v
  target.value.hsl = base
}

function bandDirty(band: number): boolean {
  return (
    !!target.value.hsl &&
    (target.value.hsl.h[band] !== 0 || target.value.hsl.s[band] !== 0 || target.value.hsl.l[band] !== 0)
  )
}

function resetHsl(): void {
  if (individual.value && activeId.value) {
    const p = adjust.perImage[activeId.value]
    if (p) delete p.hsl
  } else {
    delete adjust.values.hsl
  }
}

/* ---------- 晕影：强度 / 半径 / 羽化 / 形状 ---------- */

const vigOpen = ref(false)

const vigDirty = computed(
  () =>
    target.value.vignette !== 0 ||
    (target.value.vignetteRadius ?? 50) !== 50 ||
    (target.value.vignetteFeather ?? 50) !== 50 ||
    (target.value.vignetteShape ?? 'ellipse') !== 'ellipse',
)

const vigRadiusModel = computed({
  get: () => target.value.vignetteRadius ?? 50,
  set: (v: number) => (target.value.vignetteRadius = v),
})
const vigFeatherModel = computed({
  get: () => target.value.vignetteFeather ?? 50,
  set: (v: number) => (target.value.vignetteFeather = v),
})
const vigShapeModel = computed({
  get: () => target.value.vignetteShape ?? 'ellipse',
  set: (v: unknown) => (target.value.vignetteShape = v as 'ellipse' | 'circle'),
})

function resetVignette(): void {
  target.value.vignette = 0
  delete target.value.vignetteRadius
  delete target.value.vignetteFeather
  delete target.value.vignetteShape
}

/** 单项恢复缺省：删除可选字段即回到引擎里的默认值（半径 / 羽化都是 50） */
function resetVigField(k: 'vignetteRadius' | 'vignetteFeather'): void {
  delete target.value[k]
}

/* ---------- 降噪：强度 + 算法 ---------- */

const dnOpen = ref(false)

const dnDirty = computed(() => (target.value.denoise ?? 0) > 0)

const denoiseModel = computed({
  get: () => target.value.denoise ?? 0,
  set: (v: number) => (target.value.denoise = v),
})
const denoiseMethodModel = computed({
  get: () => target.value.denoiseMethod ?? DENOISE_DEFAULT,
  set: (v: unknown) => (target.value.denoiseMethod = v as Adjustments['denoiseMethod']),
})

function resetDenoise(): void {
  delete target.value.denoise
  delete target.value.denoiseMethod
}
</script>

<template>
  <div class="panel-scroll">
    <div class="head">
      <h1>调节</h1>
      <span class="fl">单独调节这张照片</span>
      <AppSwitch
        :model-value="individual"
        :disabled="!activeId"
        @update:model-value="adjust.setIndividual(activeId, $event)"
      />
    </div>
    <section class="group presets-group">
      <header class="group-head" @click="presetOpen = !presetOpen">
        <Bookmark :size="13" />
        <span>调节预设</span>
        <span class="flex" />
        <span v-if="presets.list.length" class="count">{{ presets.list.length }}</span>
        <button
          class="mini"
          title="把当前调节存为预设"
          :disabled="!activeId"
          @click.stop="openPresetSave"
        >
          <Plus :size="12" />
        </button>
        <ChevronDown :size="13" class="chev" :class="{ open: presetOpen }" />
      </header>
      <template v-if="presetOpen">
        <div v-if="presets.list.length" class="preset-scroll">
          <div class="preset-grid">
            <AdjustPresetCard
              v-for="p in presets.list"
              :key="p.id"
              :preset="p"
              :base="presetBase"
              :active="activePresetId === p.id"
              :info="presetInfo(p)"
              @apply="applyPreset(p)"
              @apply-all="applyPresetAll(p)"
              @remove="presets.remove(p.id)"
            />
          </div>
        </div>
        <p v-if="!presets.list.length" class="preset-empty">
          还没有预设。调好当前照片后点右上角「+」保存，之后可一键套用到其他照片。
        </p>
        <p v-else class="preset-hint">{{ presetHint }}</p>
      </template>
    </section>
    <template v-for="def in ADJUST_DEFS" :key="def.key">
      <AppSlider
        v-model="target[def.key]"
        :min="-100"
        :max="100"
        :label="def.label"
        :icon="icons[def.key]"
        :default="0"
        @reset="resetOne(def.key)"
      />
      <!-- 白平衡吸管紧跟色温 / 色调：取色校正与这两根滑杆是同一件事 -->
      <div v-if="def.key === 'tint'" class="wb">
        <button
          class="wb-pick"
          :class="{ on: adjust.pickingWb }"
          :disabled="!activeId"
          :aria-pressed="adjust.pickingWb"
          @click="togglePick"
        >
          <Pipette :size="13" />{{ adjust.pickingWb ? '取消取样' : '吸管取白平衡' }}
        </button>
        <span class="wb-hint">{{
          adjust.pickingWb ? '在画面点按中性灰或白色处' : '点按画面中性色，自动校正偏色'
        }}</span>
      </div>
    </template>
    <CurveEditor v-model="curvesModel" />
    <section class="group">
      <header class="group-head" @click="hslOpen = !hslOpen">
        <Palette :size="13" />
        <span>HSL 分色调整</span>
        <span class="flex" />
        <button v-if="!hslNeutral" class="mini" title="全部归零" @click.stop="resetHsl">
          <RotateCcw :size="11" />
        </button>
        <ChevronDown :size="13" class="chev" :class="{ open: hslOpen }" />
      </header>
      <template v-if="hslOpen">
        <div class="bands">
          <button
            v-for="(b, i) in HSL_BANDS"
            :key="b.label"
            class="band"
            :class="{ on: selectedBand === i, dirty: bandDirty(i) }"
            :style="{ '--sw': b.swatch }"
            @click="selectedBand = i"
          >
            {{ b.label }}
          </button>
        </div>
        <div v-if="selectedBand >= 0" class="band-edit">
          <div class="band-title">
            <span class="dot" :style="{ background: HSL_BANDS[selectedBand].swatch }" />
            {{ HSL_BANDS[selectedBand].label }}色
          </div>
          <AppSlider
            :model-value="hslVal(selectedBand, 'h')"
            :min="-100"
            :max="100"
            label="色相"
            :default="0"
            @update:model-value="hslSet(selectedBand, 'h', $event)"
            @reset="hslSet(selectedBand, 'h', 0)"
          />
          <AppSlider
            :model-value="hslVal(selectedBand, 's')"
            :min="-100"
            :max="100"
            label="饱和度"
            :default="0"
            @update:model-value="hslSet(selectedBand, 's', $event)"
            @reset="hslSet(selectedBand, 's', 0)"
          />
          <AppSlider
            :model-value="hslVal(selectedBand, 'l')"
            :min="-100"
            :max="100"
            label="亮度"
            :default="0"
            @update:model-value="hslSet(selectedBand, 'l', $event)"
            @reset="hslSet(selectedBand, 'l', 0)"
          />
        </div>
      </template>
    </section>
    <section class="group">
      <header class="group-head" @click="vigOpen = !vigOpen">
        <Circle :size="13" />
        <span>晕影</span>
        <span class="flex" />
        <button v-if="vigDirty" class="mini" title="全部归零" @click.stop="resetVignette">
          <RotateCcw :size="11" />
        </button>
        <ChevronDown :size="13" class="chev" :class="{ open: vigOpen }" />
      </header>
      <template v-if="vigOpen">
        <AppSlider
          v-model="target.vignette"
          :min="0"
          :max="100"
          label="强度"
          :default="0"
          @reset="target.vignette = 0"
        />
        <AppSlider v-model="vigRadiusModel" :min="0" :max="100" label="半径" :default="50" @reset="resetVigField('vignetteRadius')" />
        <AppSlider v-model="vigFeatherModel" :min="0" :max="100" label="羽化" :default="50" @reset="resetVigField('vignetteFeather')" />
        <div class="row-inline">
          <span class="fl2">形状</span>
          <AppSegment
            small
            :model-value="vigShapeModel"
            :options="[
              { value: 'ellipse', label: '椭圆' },
              { value: 'circle', label: '圆形' },
            ]"
            @update:model-value="vigShapeModel = $event"
          />
        </div>
      </template>
    </section>
    <section class="group">
      <header class="group-head" @click="dnOpen = !dnOpen">
        <Sparkles :size="13" />
        <span>降噪</span>
        <span class="flex" />
        <button v-if="dnDirty" class="mini" title="关闭降噪" @click.stop="resetDenoise">
          <RotateCcw :size="11" />
        </button>
        <ChevronDown :size="13" class="chev" :class="{ open: dnOpen }" />
      </header>
      <template v-if="dnOpen">
        <AppSlider
          v-model="denoiseModel"
          :min="0"
          :max="100"
          label="强度"
          :default="0"
          @reset="denoiseModel = 0"
        />
        <template v-if="(target.denoise ?? 0) > 0">
          <div class="row-inline">
            <span class="fl2">算法</span>
            <AppSegment
              small
              :model-value="denoiseMethodModel"
              :options="DENOISE_METHODS"
              @update:model-value="denoiseMethodModel = $event"
            />
          </div>
          <p class="dn-hint">
            {{ (target.denoiseMethod ?? 'edge') === 'median'
              ? '中值：去除孤点噪斑与椒盐噪，边缘最硬。'
              : (target.denoiseMethod ?? 'edge') === 'smooth'
                ? '平滑：快速均匀柔化，力度最强。'
                : '边缘保持：联合双边滤波，去噪同时保住细节边缘。' }}
          </p>
        </template>
      </template>
    </section>
    <div class="foot">
      <AppButton
        variant="ghost"
        size="sm"
        :disabled="individual ? matchesGlobal : isNeutral(adjust.values)"
        @click="onReset"
      >
        <RotateCcw :size="13" />{{ individual ? '还原为全局' : '全部重置' }}
      </AppButton>
    </div>

    <AppDialog
      :open="presetSaving"
      title="存为调节预设"
      :width="360"
      @close="presetSaving = false"
    >
      <p class="dlg-note">保存当前照片的全部调节参数（不含水印与裁剪），之后可套用到其他照片。</p>
      <input
        v-model="presetName"
        class="dlg-input"
        placeholder="预设名称"
        spellcheck="false"
        @keyup.enter="confirmPresetSave"
      />
      <div class="dlg-actions">
        <AppButton variant="ghost" size="sm" @click="presetSaving = false">取消</AppButton>
        <AppButton variant="primary" size="sm" @click="confirmPresetSave">保存</AppButton>
      </div>
    </AppDialog>
  </div>
</template>

<style scoped>
.panel-scroll {
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.head h1 {
  font-size: calc(15px * var(--ui-zoom, 1));
  font-weight: 600;
  letter-spacing: 0;
}
.fl {
  flex: 1;
  text-align: right;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.foot {
  margin-top: 12px;
}
/* ---------- 白平衡吸管 ---------- */
.wb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 12px;
}
.wb-pick {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: calc(26px * var(--ui-zoom, 1));
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--bg);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    border-color var(--dur-hover) var(--ease-soft);
}
.wb-pick:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line-strong);
}
.wb-pick.on {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--accent);
}
.wb-pick:disabled {
  opacity: 0.45;
}
.wb-hint {
  flex: 1;
  min-width: 0;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.35;
}
/* ---------- 调节预设 ---------- */
.presets-group {
  margin-top: 0;
  margin-bottom: 4px;
}
.count {
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: var(--hover);
  font-size: calc(10.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.group-head .mini:disabled {
  opacity: 0.35;
}
/* 预设卡片：沿用工作室模板卡片的语言——缩略图在上、名称与信息在下，
   悬停抬起，当前生效的一条带强调色描边 */
.preset-scroll {
  /* 悬停时卡片上移 2px，顶部留出同样的余量，避免被滚动容器裁掉 */
  margin-top: 4px;
  padding-top: 2px;
  /* 预设多时在组内滚动：不把整块面板撑长，也不打断下方的滑杆 */
  max-height: clamp(200px, 40vh, 340px);
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding-right: 1px;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 8px;
  padding-bottom: 2px;
}
.preset-empty,
.preset-hint {
  margin: 8px 0 2px;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.5;
}
/* ---------- 存为预设对话框 ---------- */
.dlg-note {
  margin: 0 0 10px;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  line-height: 1.6;
}
.dlg-input {
  width: 100%;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.dlg-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
/* ---------- 折叠分组（HSL / 晕影 / 降噪 / 预设） ---------- */
.group {
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-m, 10px);
  padding: 8px 10px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}
.group-head .flex {
  flex: 1;
}
.group-head .mini {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: var(--text-3);
}
.group-head .mini:hover {
  color: var(--text);
  background: var(--hover);
}
.chev {
  transition: transform var(--dur-hover) var(--ease-soft);
}
.chev.open {
  transform: rotate(180deg);
}
.bands {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0;
}
.band {
  position: relative;
  padding: 3px 9px 3px 18px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  transition: color var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft);
}
.band::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sw);
}
.band:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
.band.on {
  border-color: var(--accent);
  color: var(--accent);
}
.band.dirty::after {
  content: '';
  position: absolute;
  top: 1px;
  right: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
}
.band-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text);
  margin-bottom: 4px;
}
.band-title .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.row-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 2px;
}
.row-inline .fl2 {
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.dn-hint {
  margin: 6px 0 0;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.5;
}
/* 触屏（安卓）适配：折叠头 / 色带 / 小重置按钮的热区放大到易命中的尺寸 */
@media (pointer: coarse) {
  .group {
    padding: 8px 12px;
  }
  .group-head {
    padding: 6px 0;
  }
  .group-head .mini {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }
  .band {
    padding: 6px 12px 6px 22px;
  }
  .band::before {
    left: 9px;
  }
  /* 触屏没有 hover：预设卡片按更窄的列宽排布，滚动区给得更高一些 */
  .wb-pick {
    height: 32px;
    padding: 0 12px;
  }
  .preset-scroll {
    max-height: clamp(240px, 46vh, 420px);
  }
  .preset-grid {
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  }
}
</style>
