<script setup lang="ts">
import { computed } from 'vue'
import { ImagePlus, Link2 } from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import { isTauri } from '@/core/platform'
import { useWorkspaceStore, type ImportMode } from '@/stores/workspace'

defineEmits<{
  pick: []
  openUrl: []
}>()

const ws = useWorkspaceStore()

/** 按系统时间向用户问好 */
const hour = new Date().getHours()
const greeting =
  hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

const modeModel = computed({
  get: () => ws.importMode,
  set: (v: unknown) => (ws.importMode = v as ImportMode),
})

const projectName = computed(() => ws.current?.name ?? '')
</script>

<template>
  <div class="empty">
    <LogoMark class="mark" />
    <h1>{{ greeting }}，{{ projectName }}</h1>
    <p>选择或拖入 JPG 照片开始今天的辑录。全部处理在本机完成，不会上传。</p>
    <div class="mode" v-if="isTauri">
      <span class="mode-label">照片入库方式</span>
      <AppSegment
        v-model="modeModel"
        :options="[
          { value: 'copy', label: '复制原文件' },
          { value: 'link', label: '链接源文件' },
        ]"
      />
    </div>
    <p v-if="isTauri" class="mode-hint">
      {{ ws.importMode === 'copy' ? '把照片复制一份进项目，源文件移动或删除都不影响。' : '只记录源文件路径与识别码，不占用额外磁盘；两者可在项目内共存并按图标区分。' }}
    </p>
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
.mode {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.mode-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.mode-hint {
  max-width: 360px;
  font-size: 11.5px;
  color: var(--text-3);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
