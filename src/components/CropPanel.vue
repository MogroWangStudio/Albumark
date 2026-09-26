<script setup lang="ts">
import { computed } from 'vue'
import { Check, FlipHorizontal2, FlipVertical2, RotateCcw, X } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import {
  CROP_RATIOS,
  cropRatioOf,
  cropRot,
  cropSourceSize,
  isPlainFullCrop,
  rotatedInnerRect,
  type Crop,
} from '@/types/adjust'

const adjust = useAdjustStore()
const images = useImagesStore()

const activeId = computed(() => images.active?.id ?? null)

/** 裁剪后输出的像素尺寸（含拉直 / 翻转），显示在标题行 */
const draftState = computed(() => {
  const d = adjust.cropDraft
  const a = images.active
  if (!d || !a?.width || !a.height) return ''
  const src = cropSourceSize(a.width, a.height, d)
  return `${Math.round(d.w * src.w)} × ${Math.round(d.h * src.h)}`
})

const draftRot = computed(() => cropRot(adjust.cropDraft ?? undefined))

/** 拉直角度变化：框重置为无透明区域的最大内接矩形（保持当前比例预设） */
function setRot(v: number): void {
  const d = adjust.cropDraft
  const a = images.active
  if (!d || !a?.width || !a.height) return
  const rot = Math.round(Math.max(-45, Math.min(45, v)) * 2) / 2
  const inner = rotatedInnerRect(a.width, a.height, rot)
  const src = cropSourceSize(a.width, a.height, { rot, flipH: d.flipH, flipV: d.flipV })
  const ratio = cropRatioOf(adjust.cropRatio)
  let w = inner.w
  let h = inner.h
  if (ratio) {
    // 在内接矩形内取该比例的最大矩形
    const target = ratio * inner.h
    w = Math.min(inner.w, target)
    h = w / ratio
  }
  adjust.cropDraft = {
    ...d,
    rot,
    x: (src.w - w) / 2 / src.w,
    y: (src.h - h) / 2 / src.h,
    w: w / src.w,
    h: h / src.h,
  }
}

function toggleFlip(axis: 'h' | 'v'): void {
  const d = adjust.cropDraft
  if (!d) return
  const next: Crop = { ...d }
  if (axis === 'h') next.flipH = !d.flipH
  else next.flipV = !d.flipV
  adjust.cropDraft = next
}

/** 应用当前裁剪框并回到调节页；无实际变化（纯整图）时等同清除 */
function finishCrop(): void {
  const id = activeId.value
  const d = adjust.cropDraft
  if (id && d) {
    if (isPlainFullCrop(d)) adjust.clearCrop(id)
    else adjust.setCrop(id, d)
  }
  adjust.exitCrop()
}

function resetCropDraft(): void {
  adjust.cropDraft = { x: 0, y: 0, w: 1, h: 1, rot: 0, flipH: false, flipV: false }
  adjust.cropRatio = 'free'
}
</script>

<template>
  <div class="panel-scroll">
    <div class="head">
      <h1>裁剪</h1>
      <span class="size">{{ draftState }}</span>
    </div>
    <AppSegment v-model="adjust.cropRatio" :options="CROP_RATIOS" small class="ratios" />
    <div class="geom">
      <div class="flips">
        <button
          class="flip"
          :class="{ on: adjust.cropDraft?.flipH }"
          title="水平翻转"
          aria-label="水平翻转"
          @click="toggleFlip('h')"
        >
          <FlipHorizontal2 :size="14" />
        </button>
        <button
          class="flip"
          :class="{ on: adjust.cropDraft?.flipV }"
          title="垂直翻转"
          aria-label="垂直翻转"
          @click="toggleFlip('v')"
        >
          <FlipVertical2 :size="14" />
        </button>
      </div>
      <AppSlider
        class="rot"
        :model-value="draftRot"
        :min="-45"
        :max="45"
        :step="0.5"
        label="拉直"
        :format="(v) => `${v}°`"
        :default="0"
        @update:model-value="setRot"
        @reset="setRot(0)"
      />
    </div>
    <div class="row">
      <AppButton
        variant="ghost"
        size="sm"
        :disabled="!adjust.cropDraft || isPlainFullCrop(adjust.cropDraft)"
        @click="resetCropDraft"
      >
        <RotateCcw :size="13" />重置
      </AppButton>
    </div>
    <div class="row end">
      <AppButton variant="ghost" size="sm" @click="adjust.exitCrop()">
        <X :size="13" />取消
      </AppButton>
      <AppButton variant="primary" size="sm" @click="finishCrop">
        <Check :size="13" />完成
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
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
.size {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.ratios {
  display: flex;
  width: 100%;
}
.ratios :deep(button) {
  flex: 1;
  padding: 0 4px;
}
.geom {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.flips {
  display: flex;
  gap: 4px;
  flex: none;
}
.flip {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text-2);
  transition:
    background var(--dur-hover) var(--ease-soft),
    color var(--dur-hover) var(--ease-soft),
    border-color var(--dur-hover) var(--ease-soft);
}
.flip:hover {
  color: var(--text);
  border-color: var(--line-strong);
}
.flip.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
.rot {
  flex: 1;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}
.row.end {
  justify-content: flex-end;
}
.hint {
  flex: 1;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.4;
}
</style>
