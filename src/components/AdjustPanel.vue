<script setup lang="ts">
import { computed } from 'vue'
import { Aperture, Circle, CloudMoon, Contrast, Droplet, RotateCcw, Sun, SunDim, Thermometer } from 'lucide-vue-next'
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
    <div class="mode">
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
    <p class="note">
      调节默认应用到全部照片，与水印一同导出；开启「单独调节」后，这张照片使用独立参数，不再应用全局调节。双击名称可复位单项，双击数值可直接键入。
    </p>
  </div>
</template>

<style scoped>
.panel-scroll {
  display: flex;
  flex-direction: column;
}
.mode {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.fl {
  font-size: 12px;
  color: var(--text-2);
}
.foot {
  margin-top: 12px;
}
.note {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
