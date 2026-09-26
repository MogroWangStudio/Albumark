<script setup lang="ts">
import { computed } from 'vue'
import {
  Aperture,
  Circle,
  CloudFog,
  CloudMoon,
  Contrast,
  Droplet,
  Focus,
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
import { ADJUST_DEFS, isNeutral, type Adjustments } from '@/types/adjust'

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
  return (
    ADJUST_DEFS.every(({ key }) => a[key] === b[key]) &&
    JSON.stringify(a.curve ?? []) === JSON.stringify(b.curve ?? [])
  )
}

const matchesGlobal = computed(() => {
  if (!individual.value || !activeId.value) return false
  return sameAdjust(target.value, adjust.values)
})

function onReset(): void {
  if (individual.value) adjust.resetToGlobal(activeId.value)
  else adjust.reset()
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
</style>
