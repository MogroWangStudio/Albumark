<script setup lang="ts">
import { computed } from 'vue'
import { FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import {
  CROP_MIN,
  CROP_RATIOS,
  CROP_ROT_MAX,
  CROP_ROT_MIN,
  containCropRect,
  cropQuad,
  cropRatioOf,
  cropRot,
  cropSourceSize,
  fitScaleInQuad,
  isPlainFullCrop,
  type Crop,
} from '@/types/adjust'

const adjust = useAdjustStore()
const images = useImagesStore()

/** 裁剪后输出的像素尺寸（含旋转 / 翻转），显示在标题行 */
const draftState = computed(() => {
  const d = adjust.cropDraft
  const a = images.active
  if (!d || !a?.width || !a.height) return ''
  const src = cropSourceSize(a.width, a.height, d)
  return `${Math.round(d.w * src.w)} × ${Math.round(d.h * src.h)}`
})

const draftRot = computed(() => cropRot(adjust.cropDraft ?? undefined))

/**
 * 旋转角度变化：角度只决定画面的姿态，裁剪框尽量留在原位不动。
 *
 * 框的坐标是相对「旋转后包围盒」的，所以转动后同一组数值仍然对应屏幕上的
 * 同一块区域；只有框角真的被转到图片外时才向内收（先滑动、再等比缩小），
 * 保证任何时候都不越出图片。
 */
function setRot(v: number): void {
  const d = adjust.cropDraft
  const a = images.active
  if (!d || !a?.width || !a.height) return
  const rot = Math.round(Math.max(CROP_ROT_MIN, Math.min(CROP_ROT_MAX, v)) * 2) / 2
  if (rot === cropRot(d)) return
  const next: Crop = { ...d, rot }
  const rect = containCropRect({ x: d.x, y: d.y, w: d.w, h: d.h }, a.width, a.height, next)

  // 有比例锁时旋转会改变画幅比（源尺寸随角度变化），先按比例把框收回可放范围
  const ratio = cropRatioOf(adjust.cropRatio)
  if (ratio) {
    const src = cropSourceSize(a.width, a.height, next)
    const k = src.w / src.h / ratio // 归一化高 = 归一化宽 × k
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const quad = cropQuad(a.width, a.height, next)
    const s = fitScaleInQuad(cx, cy, rect.w, rect.w * k, quad)
    const w = Math.max(CROP_MIN, rect.w * s)
    const h = Math.max(CROP_MIN, w * k)
    const locked = containCropRect(
      { x: cx - w / 2, y: cy - h / 2, w, h },
      a.width,
      a.height,
      next,
    )
    adjust.cropDraft = { ...next, ...locked }
    return
  }

  adjust.cropDraft = { ...next, ...rect }
}

function toggleFlip(axis: 'h' | 'v'): void {
  const d = adjust.cropDraft
  if (!d) return
  const next: Crop = { ...d }
  if (axis === 'h') next.flipH = !d.flipH
  else next.flipV = !d.flipV
  adjust.cropDraft = next
}

/** 重置裁剪框为整图；离开裁剪页时草稿自动应用（整图即清除） */
function resetCropDraft(): void {
  adjust.cropDraft = { x: 0, y: 0, w: 1, h: 1, rot: 0, flipH: false, flipV: false }
  adjust.cropRatio = 'free'
}

/* ---------- 自定义比例：键入宽高数值即应用（custom:W:H 存入 cropRatio） ---------- */

/** 当前 cropRatio 为自定义时拆回两格显示，否则留空 */
const customRatio = computed(() => {
  if (!adjust.cropRatio.startsWith('custom:')) return { w: '', h: '' }
  const parts = adjust.cropRatio.split(':')
  return { w: parts[1] ?? '', h: parts[2] ?? '' }
})

function onCustomRatio(e: Event): void {
  // 两格一起从 DOM 读：computed 值派生自 cropRatio，输入第一格时第二格
  // 尚未写回，从派生值读会拿到旧空值
  const row = (e.target as HTMLElement).closest('.custom-ratio')
  const inputs = row?.querySelectorAll<HTMLInputElement>('input')
  if (!inputs || inputs.length < 2) return
  const w = Number(inputs[0].value.trim())
  const h = Number(inputs[1].value.trim())
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return
  // 输入合法性通过后立即应用（重排裁剪框）；输入未完成时保持旧比例
  adjust.cropRatio = `custom:${w}:${h}`
}
</script>

<template>
  <div class="panel-scroll">
    <div class="head">
      <h1>裁剪</h1>
      <span class="size">{{ draftState }}</span>
    </div>
    <AppSegment v-model="adjust.cropRatio" :options="CROP_RATIOS" small class="ratios" />
    <!-- 自定义比例：键入宽高数值即应用（选预设后两格清空） -->
    <div class="custom-ratio">
      <span class="fl">自定义</span>
      <input
        class="num"
        type="number"
        min="0.01"
        step="any"
        placeholder="宽"
        :value="customRatio.w"
        @input="onCustomRatio($event)"
      />
      <span class="colon">:</span>
      <input
        class="num"
        type="number"
        min="0.01"
        step="any"
        placeholder="高"
        :value="customRatio.h"
        @input="onCustomRatio($event)"
      />
    </div>
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
        :min="CROP_ROT_MIN"
        :max="CROP_ROT_MAX"
        :step="0.5"
        :bend="1"
        label="旋转"
        :format="(v) => `${v}°`"
        :default="0"
        @update:model-value="setRot"
        @reset="setRot(0)"
      />
    </div>
    <div class="row">
      <span class="hint">切到其他页时自动应用，可随时回来重新调整。</span>
      <AppButton
        variant="ghost"
        size="sm"
        :disabled="!adjust.cropDraft || isPlainFullCrop(adjust.cropDraft)"
        @click="resetCropDraft"
      >
        <RotateCcw :size="13" />重置
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
  font-size: calc(15px * var(--ui-zoom, 1));
  font-weight: 600;
  letter-spacing: 0;
}
.size {
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.ratios {
  display: flex;
  width: 100%;
}
/* 自定义比例：宽:高 两格数值，键入即应用 */
.custom-ratio {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 2px;
}
.custom-ratio .fl {
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.custom-ratio .num {
  width: 64px;
  height: calc(26px * var(--ui-zoom, 1));
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text);
  outline: none;
  transition: border-color var(--dur-hover) var(--ease-soft);
}
.custom-ratio .num:focus {
  border-color: var(--accent);
}
.custom-ratio .colon {
  color: var(--text-3);
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
.hint {
  flex: 1;
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.4;
}
</style>
