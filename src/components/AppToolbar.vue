<script setup lang="ts">
import { ImagePlus, Settings, Upload } from 'lucide-vue-next'
import LogoText from '@/components/brand/LogoText.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useImagesStore } from '@/stores/images'

defineEmits<{
  import: []
  exportSheet: []
  settings: []
}>()

const images = useImagesStore()
</script>

<template>
  <header class="toolbar material">
    <div class="brand">
      <LogoText class="logo" />
    </div>
    <div class="actions">
      <AppButton variant="ghost" class="icon-btn" aria-label="设置" title="设置" @click="$emit('settings')">
        <Settings :size="16" />
      </AppButton>
      <AppButton @click="$emit('import')"><ImagePlus :size="15" />导入图片</AppButton>
      <AppButton variant="primary" :disabled="!images.count" @click="$emit('exportSheet')">
        <Upload :size="15" />导出{{ images.count ? ` · ${images.count}` : '' }}
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
  height: calc(52px + var(--safe-top));
  padding: var(--safe-top) calc(14px + var(--safe-right)) 0 calc(14px + var(--safe-left));
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
.icon-btn {
  width: var(--control-h);
  padding: 0;
}
@media (max-width: 640px) {
  .logo {
    height: 16px;
  }
}
</style>
