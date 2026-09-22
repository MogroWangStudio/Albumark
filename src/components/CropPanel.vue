<script setup lang="ts">
import { computed } from 'vue'
import { Check, RotateCcw, X } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { CROP_RATIOS, isFullCrop } from '@/types/adjust'

const adjust = useAdjustStore()
const images = useImagesStore()

const activeId = computed(() => images.active?.id ?? null)

function cropText(c: { w: number; h: number }): string {
  const a = images.active
  if (!a?.width || !a.height) return ''
  return `${Math.round(c.w * a.width)} × ${Math.round(c.h * a.height)}`
}

const draftState = computed(() => (adjust.cropDraft ? cropText(adjust.cropDraft) : ''))

/** 应用当前裁剪框并回到调节页；框为整图时等同于清除裁剪 */
function finishCrop(): void {
  const id = activeId.value
  const d = adjust.cropDraft
  if (id && d) {
    if (isFullCrop(d)) {
      adjust.clearCrop(id)
      void images.refreshThumb(id)
    } else {
      adjust.setCrop(id, d)
      void images.refreshThumb(id, d)
    }
  }
  adjust.exitCrop()
}

function resetCropDraft(): void {
  adjust.cropDraft = { x: 0, y: 0, w: 1, h: 1 }
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
    <div class="row">
      <AppButton
        variant="ghost"
        size="sm"
        :disabled="!adjust.cropDraft || isFullCrop(adjust.cropDraft)"
        @click="resetCropDraft"
      >
        <RotateCcw :size="13" />重置
      </AppButton>
      <span class="hint">拖动角点或边调整范围，框内拖动移动位置</span>
    </div>
    <div class="row end">
      <AppButton variant="ghost" size="sm" @click="adjust.exitCrop()">
        <X :size="13" />取消
      </AppButton>
      <AppButton variant="primary" size="sm" @click="finishCrop">
        <Check :size="13" />完成
      </AppButton>
    </div>
    <p class="note">
      裁剪随这张照片保存，预览与导出所见即所得；「重置」恢复完整画面。按 Esc 或「取消」放弃未确认的调整。
    </p>
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
.note {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
