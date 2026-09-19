<script setup lang="ts">
import { ImagePlus, Link2 } from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'

defineEmits<{
  pick: []
  openUrl: []
}>()

/** 按系统时间向用户问好 */
const hour = new Date().getHours()
const greeting =
  hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
</script>

<template>
  <div class="empty">
    <LogoMark class="mark" />
    <h1>{{ greeting }}</h1>
    <p>选择或拖入 JPG 照片开始今天的辑录。全部处理在本机完成，不会上传。</p>
    <div class="actions">
      <AppButton variant="primary" @click="$emit('pick')"><ImagePlus :size="15" />选择照片</AppButton>
      <AppButton @click="$emit('openUrl')"><Link2 :size="15" />导入链接</AppButton>
    </div>
    <p class="hint">支持直接拖入整个文件夹</p>
  </div>
</template>

<style scoped>
.empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 24px;
}
.mark {
  width: 148px;
  height: auto;
  margin-bottom: 18px;
  opacity: 0.95;
}
h1 {
  font-size: 22px;
  letter-spacing: -0.02em;
}
p {
  max-width: 400px;
  color: var(--text-2);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
