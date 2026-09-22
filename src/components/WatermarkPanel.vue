<script setup lang="ts">
import { computed, watch } from 'vue'
import LayerEditor from '@/components/LayerEditor.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { useImagesStore } from '@/stores/images'
import { useWatermarkStore } from '@/stores/watermark'

/** 悬浮面板的水印页：单独水印开关 + 图层编辑器，工作室入口在主窗口顶栏 */
const images = useImagesStore()
const wm = useWatermarkStore()

const activeId = computed(() => images.active?.id ?? null)
const individual = computed(() => wm.isIndividual(activeId.value))

// 编辑上下文跟随当前照片：带独立水印的照片编辑其副本，其余编辑全局
watch(
  activeId,
  (id) => wm.setEditContext(id),
  { immediate: true },
)

/** 像素距离基于当前照片的原始尺寸 */
const imgW = computed(() => images.active?.width || 1600)
const imgH = computed(() => images.active?.height || 1067)
</script>

<template>
  <div class="panel-scroll">
    <div class="head">
      <h1>水印</h1>
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
    <p class="note">
      开启「单独水印」后，这张照片使用独立的图层副本，对它的编辑不再影响其他照片，也不再应用全局水印；关闭即恢复。编辑上下文会跟随选中的照片自动切换。
    </p>
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
.note {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
