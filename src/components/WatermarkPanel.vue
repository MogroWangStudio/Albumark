<script setup lang="ts">
import { computed } from 'vue'
import { Brush } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import LayerEditor from '@/components/LayerEditor.vue'
import { useImagesStore } from '@/stores/images'

const emit = defineEmits<{ studio: [] }>()

const images = useImagesStore()

/** 像素距离基于当前照片的原始尺寸 */
const imgW = computed(() => images.active?.width || 1600)
const imgH = computed(() => images.active?.height || 1067)
</script>

<template>
  <div class="panel-scroll">
    <div class="studio-row">
      <span class="hint-text">在水印工作室里制作、保存常用水印</span>
      <AppButton size="sm" @click="emit('studio')"><Brush :size="13" />工作室</AppButton>
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
.studio-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
}
.hint-text {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
