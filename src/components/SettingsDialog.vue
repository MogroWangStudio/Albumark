<script setup lang="ts">
import { computed } from 'vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { useSettingsStore, type ThemeMode } from '@/stores/settings'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

const themeModel = computed({
  get: () => settings.theme,
  set: (v: unknown) => (settings.theme = v as ThemeMode),
})
</script>

<template>
  <AppDialog :open="open" title="设置" :width="420" @close="emit('close')">
    <div class="row">
      <div class="text">
        <span class="label">外观</span>
        <p class="desc">深浅色跟随此设置或系统。</p>
      </div>
      <AppSegment
        v-model="themeModel"
        :options="[
          { value: 'auto', label: '跟随系统' },
          { value: 'dark', label: '深色' },
          { value: 'light', label: '浅色' },
        ]"
      />
    </div>
    <div class="row">
      <div class="text">
        <span class="label">EXIF 缺失提醒</span>
        <p class="desc">导入时检测到照片缺少拍摄参数时给出提示。</p>
      </div>
      <AppSwitch v-model="settings.exifNotice" />
    </div>
    <footer class="about">
      <span>辑印 Albumark v0.2.0</span>
      <span class="sep">·</span>
      <span>本地优先处理，不上传照片</span>
      <span class="sep">·</span>
      <span>MogroWang Studio</span>
    </footer>
  </AppDialog>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.text {
  min-width: 0;
}
.label {
  font-size: 13px;
}
.desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}
.about {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--text-3);
}
.sep {
  color: var(--text-3);
}
</style>
