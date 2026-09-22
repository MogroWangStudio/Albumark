<script setup lang="ts">
import { computed } from 'vue'
import {
  Aperture,
  Check,
  ChevronRight,
  Circle,
  CloudMoon,
  Contrast,
  Crop,
  Droplet,
  RotateCcw,
  Sun,
  SunDim,
  Thermometer,
  X,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import CurveEditor from '@/components/ui/CurveEditor.vue'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { ADJUST_DEFS, CROP_RATIOS, isNeutral, isFullCrop, type Adjustments } from '@/types/adjust'

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

/* ---------- 裁剪 ---------- */

const appliedCrop = computed(() => (activeId.value ? adjust.cropOf(activeId.value) : undefined))

function cropText(c: { w: number; h: number }): string {
  const a = images.active
  if (!a?.width || !a.height) return '已裁剪'
  return `${Math.round(c.w * a.width)} × ${Math.round(c.h * a.height)}`
}

const cropState = computed(() =>
  appliedCrop.value ? cropText(appliedCrop.value) : '未裁剪',
)

const draftState = computed(() =>
  adjust.cropDraft ? cropText(adjust.cropDraft) : '',
)

function finishCrop(): void {
  const id = activeId.value
  const d = adjust.cropDraft
  if (id && d) {
    if (isFullCrop(d)) adjust.clearCrop(id)
    else adjust.setCrop(id, d)
  }
  adjust.cropMode = false
}

function resetCropDraft(): void {
  adjust.cropDraft = { x: 0, y: 0, w: 1, h: 1 }
  adjust.cropRatio = 'free'
}
</script>

<template>
  <div class="panel-scroll">
    <!-- 裁剪编辑模式：比例选择与确认，画布上直接拖框 -->
    <template v-if="adjust.cropMode">
      <div class="crop-head">
        <span class="crop-title">裁剪</span>
        <span class="crop-size">{{ draftState }}</span>
      </div>
      <AppSegment v-model="adjust.cropRatio" :options="CROP_RATIOS" small class="crop-ratios" />
      <div class="crop-actions">
        <AppButton variant="ghost" size="sm" :disabled="!!adjust.cropDraft && isFullCrop(adjust.cropDraft)" @click="resetCropDraft">
          <RotateCcw :size="13" />重置
        </AppButton>
        <span class="crop-hint">拖动角点或边调整，框内拖动移位置</span>
      </div>
      <div class="crop-actions">
        <AppButton variant="ghost" size="sm" @click="adjust.cropMode = false">
          <X :size="13" />取消
        </AppButton>
        <AppButton variant="primary" size="sm" @click="finishCrop">
          <Check :size="13" />完成
        </AppButton>
      </div>
      <p class="note">
        裁剪随这张照片保存，导出时同样生效；「重置」恢复完整画面。按 Esc 或「取消」放弃未确认的调整。
      </p>
    </template>

    <!-- 常规调节 -->
    <template v-else>
      <div class="mode">
        <span class="fl">单独调节这张照片</span>
        <AppSwitch
          :model-value="individual"
          :disabled="!activeId"
          @update:model-value="adjust.setIndividual(activeId, $event)"
        />
      </div>
      <button class="crop-row" :disabled="!activeId" @click="adjust.cropMode = true">
        <Crop :size="15" />
        <span class="crop-label">裁剪</span>
        <span class="crop-state">{{ cropState }}</span>
        <ChevronRight :size="13" class="crop-go" />
      </button>
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
    </template>
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
/* 裁剪入口：与「单独调节」行同一套行样式 */
.crop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin-bottom: 10px;
  padding: 0 2px;
  color: var(--text-2);
  text-align: left;
  transition: color var(--dur-hover) var(--ease-soft);
}
.crop-row:disabled {
  opacity: 0.4;
}
.crop-row:hover:not(:disabled) {
  color: var(--text);
}
.crop-label {
  flex: 1;
  font-size: 12.5px;
  color: var(--text);
}
.crop-state {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.crop-go {
  color: var(--text-3);
}
/* 裁剪编辑工具 */
.crop-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.crop-title {
  font-size: 13px;
  font-weight: 600;
}
.crop-size {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.crop-ratios {
  display: flex;
  width: 100%;
}
.crop-ratios :deep(button) {
  flex: 1;
  padding: 0 4px;
}
.crop-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}
.crop-actions:last-of-type {
  justify-content: flex-end;
}
.crop-hint {
  flex: 1;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.4;
}
</style>
