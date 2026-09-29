<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Aperture,
  Blend,
  ChevronDown,
  Circle,
  CloudFog,
  CloudMoon,
  Contrast,
  Droplet,
  Focus,
  Palette,
  RotateCcw,
  Sparkles,
  Sun,
  SunDim,
  Thermometer,
  Zap,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import CurveEditor from '@/components/ui/CurveEditor.vue'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import {
  ADJUST_DEFS,
  DENOISE_DEFAULT,
  DENOISE_METHODS,
  HSL_BANDS,
  isHslNeutral,
  isNeutral,
  neutralHsl,
  sameAdjustments,
  type Adjustments,
} from '@/types/adjust'

const adjust = useAdjustStore()
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

/* ---------- HSL 分色 ---------- */

const hslOpen = ref(false)
const selectedBand = ref(0)
const hslNeutral = computed(() => isHslNeutral(target.value.hsl))

function hslVal(band: number, ch: 'h' | 's' | 'l'): number {
  return target.value.hsl?.[ch]?.[band] ?? 0
}

function hslSet(band: number, ch: 'h' | 's' | 'l', v: number): void {
  const base = target.value.hsl ? { ...target.value.hsl } : neutralHsl()
  base[ch] = [...base[ch]]
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
    <AppSlider
      v-for="def in ADJUST_DEFS"
      :key="def.key"
      v-model="target[def.key]"
      :min="-100"
      :max="100"
      :label="def.label"
      :icon="icons[def.key]"
      :default="0"
      @reset="individual ? adjust.resetToGlobal(activeId) : adjust.set(def.key, 0)"
    />
    <CurveEditor v-model="target.curve" />
    <section class="hsl">
      <header class="hsl-head" @click="hslOpen = !hslOpen">
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
    <section class="hsl">
      <header class="hsl-head" @click="vigOpen = !vigOpen">
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
        <AppSlider v-model="vigRadiusModel" :min="0" :max="100" label="半径" :default="50" />
        <AppSlider v-model="vigFeatherModel" :min="0" :max="100" label="羽化" :default="50" />
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
    <section class="hsl">
      <header class="hsl-head" @click="dnOpen = !dnOpen">
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
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}
.fl {
  flex: 1;
  text-align: right;
  font-size: 12px;
  color: var(--text-2);
}
.foot {
  margin-top: 12px;
}
/* ---------- HSL 分色 ---------- */
.hsl {
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-m, 10px);
  padding: 8px 10px;
}
.hsl-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}
.hsl-head .flex {
  flex: 1;
}
.hsl-head .mini {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: var(--text-3);
}
.hsl-head .mini:hover {
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
  font-size: 11.5px;
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
  font-size: 12px;
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
  font-size: 12px;
  color: var(--text-2);
}
.dn-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
}
</style>
