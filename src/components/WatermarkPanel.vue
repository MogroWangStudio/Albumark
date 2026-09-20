<script setup lang="ts">
import { computed } from 'vue'
import LayerEditor from '@/components/LayerEditor.vue'
import { useImagesStore } from '@/stores/images'

/** 悬浮面板的水印页：直接铺开图层编辑器，工作室入口在主窗口顶栏 */
const images = useImagesStore()

/** 像素距离基于当前照片的原始尺寸 */
const imgW = computed(() => images.active?.width || 1600)
const imgH = computed(() => images.active?.height || 1067)
</script>

<template>
  <div class="panel-scroll">
    <LayerEditor
      :img-w="imgW"
      :img-h="imgH"
      :exif="images.active?.exif"
      :base-name="images.active?.baseName"
    />
  </div>
</template>
