<script setup lang="ts">
import { computed, watch } from 'vue'
import { Folder } from 'lucide-vue-next'
import LayerEditor from '@/components/LayerEditor.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { croppedSize } from '@/types/adjust'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { useWatermarkStore } from '@/stores/watermark'
import { useWorkspaceStore } from '@/stores/workspace'

/** 悬浮面板的水印页：单独水印开关 + 图层编辑器，工作室入口在主窗口顶栏 */
const images = useImagesStore()
const wm = useWatermarkStore()
const adjust = useAdjustStore()
const ws = useWorkspaceStore()

/** 作用域提示：这份水印只属于当前工作目录，切换目录不会带过去 */
const scopeName = computed(() => ws.dir?.name ?? '临时项目')
const scopeHint = computed(() =>
  ws.dir
    ? `水印只作用于工作目录「${ws.dir.name}」，其他工作目录不受影响`
    : '水印只作用于当前临时项目',
)

const activeId = computed(() => images.active?.id ?? null)
const individual = computed(() => wm.isIndividual(activeId.value))

// 编辑上下文跟随当前照片：带独立水印的照片编辑其副本，其余编辑全局
watch(
  activeId,
  (id) => wm.setEditContext(id),
  { immediate: true },
)

// 离开水印工作室后恢复编辑上下文（工作室期间恒为全局草稿）
watch(
  () => wm.studioActive,
  (active) => {
    if (!active) wm.setEditContext(activeId.value)
  },
)

/** 像素距离基于当前照片的生效尺寸（裁剪 / 拉直后的长边） */
const imgW = computed(() => {
  const a = images.active
  if (!a?.width) return 1600
  return croppedSize(a.width, a.height, adjust.cropOf(activeId.value)).w
})
const imgH = computed(() => {
  const a = images.active
  if (!a?.height) return 1067
  return croppedSize(a.width, a.height, adjust.cropOf(activeId.value)).h
})
</script>

<template>
  <div class="panel-scroll">
    <div class="head">
      <h1>水印</h1>
      <span class="scope" :title="scopeHint"><Folder :size="10" />{{ scopeName }}</span>
      <span class="fl">单独水印这张照片</span>
      <AppSwitch
        :model-value="individual"
        :disabled="!activeId"
        @update:model-value="wm.setIndividual(activeId, $event)"
      />
    </div>
    <LayerEditor
      :img-w="imgW"
      :img-h="imgH"
      :exif="images.active?.exif"
      :base-name="images.active?.baseName"
    />
  </div>
</template>

<style scoped>
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
/* 作用域徽标：目录名过长时省略，完整说明在悬停提示里 */
.scope {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 92px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text-3);
  font-size: calc(10.5px * var(--ui-zoom, 1));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: none;
}
.scope svg {
  flex: none;
  opacity: 0.8;
}
</style>
