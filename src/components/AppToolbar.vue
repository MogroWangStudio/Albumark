<script setup lang="ts">
import { Download, ImagePlus } from 'lucide-vue-next'
import LogoText from '@/components/brand/LogoText.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useImagesStore } from '@/stores/images'

defineEmits<{
  import: []
  exportSheet: []
}>()

const images = useImagesStore()
</script>

<template>
  <header class="toolbar material">
    <div class="brand">
      <LogoText class="logo" />
    </div>
    <div class="actions">
      <AppButton @click="$emit('import')"><ImagePlus :size="15" />导入图片</AppButton>
      <AppButton variant="primary" :disabled="!images.count" @click="$emit('exportSheet')">
        <Download :size="15" />导出{{ images.count ? ` · ${images.count}` : '' }}
      </AppButton>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  padding: 0 14px;
  flex: none;
}
.logo {
  height: 20px;
  width: auto;
  display: block;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (max-width: 640px) {
  .logo {
    height: 16px;
  }
}
</style>
