<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy, Images, Link2 } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import { useWorkspaceStore, type ImportMode } from '@/stores/workspace'

/**
 * 导入预览窗：选照片 / 拖入照片后先在这里确认数量与入库方式（复制 or 链接），
 * 确认后才真正写入项目。
 */
const props = defineProps<{
  open: boolean
  items: { name: string; path?: string; file?: File }[]
  canLink: boolean
}>()

const emit = defineEmits<{ close: []; confirm: [mode: ImportMode] }>()

const ws = useWorkspaceStore()
const mode = ref<ImportMode>('copy')

watch(
  () => props.open,
  (v) => {
    if (v) {
      mode.value = ws.importMode
      // 沙箱 / 浏览器拿不到源路径，只能复制
      if (!props.canLink) mode.value = 'copy'
    }
  },
)

const names = computed(() => props.items.map((i) => i.name))

function confirm(): void {
  emit('confirm', mode.value)
}
</script>

<template>
  <AppDialog :open="open" title="导入照片" :width="420" @close="emit('close')">
    <div class="count">
      <Images :size="15" />
      <span>已选择 <strong>{{ items.length }}</strong> 张照片</span>
    </div>
    <ul ref="listEl" class="files">
      <li v-for="n in names" :key="n">{{ n }}</li>
    </ul>

    <div class="mode-pick">
      <span class="fl">照片入库方式</span>
      <AppSegment
        v-if="canLink"
        v-model="mode"
        :options="[
          { value: 'copy', label: '复制原文件' },
          { value: 'link', label: '链接源文件' },
        ]"
      />
      <span v-else class="copy-only"><Copy :size="13" />复制原文件</span>
    </div>

    <div class="btns">
      <AppButton variant="ghost" @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" :disabled="!items.length" @click="confirm">
        <Copy v-if="mode === 'copy'" :size="14" /><Link2 v-else :size="14" />导入
      </AppButton>
    </div>
  </AppDialog>
</template>

<style scoped>
.count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 10px;
}
.count strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.files {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-2);
  font-family: var(--font-mono);
}
.files li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mode-pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
}
.fl {
  font-size: 12px;
  color: var(--text-2);
}
.copy-only {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text);
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
