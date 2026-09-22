<script setup lang="ts">
import { computed } from 'vue'
import { ImagePlus, Link2 } from 'lucide-vue-next'
import LogoMark from '@/components/brand/LogoMark.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = withDefaults(
  defineProps<{
    /** 悬浮面板让出的宽度：0 = 面板收起或移动端底部形态 */
    panelInset?: number
    panelSide?: 'left' | 'right'
    /** 移动端底部抽屉让出的高度：内容中心上移 */
    panelBottomInset?: number
  }>(),
  { panelInset: 0, panelSide: 'right', panelBottomInset: 0 },
)

defineEmits<{
  pick: []
  openUrl: []
}>()

/** 按系统时间向用户问好 */
const hour = new Date().getHours()
const greeting =
  hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

/** 与预览画布同规则：内容中心让位到面板之外的剩余空白 */
const shift = computed(() =>
  props.panelInset > 0 ? (props.panelInset / 2) * (props.panelSide === 'left' ? 1 : -1) : 0,
)
const lift = computed(() => (props.panelBottomInset > 0 ? props.panelBottomInset / 2 : 0))
</script>

<template>
  <div
    class="empty"
    :style="{
      transform: `translate(${shift}px, ${-lift}px)`,
    }"
  >
    <LogoMark class="mark" />
    <h1>{{ greeting }}</h1>
    <p>选择或拖入照片，开始今天的辑录。</p>
    <div class="actions">
      <AppButton variant="primary" @click="$emit('pick')"><ImagePlus :size="15" />选择照片</AppButton>
      <AppButton @click="$emit('openUrl')"><Link2 :size="15" />导入链接</AppButton>
    </div>
    <p class="hint">支持直接拖入整个文件夹 · 全部处理在本机完成，不会上传</p>
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
  /* 面板展开/收起/换边时整体让位，与预览画布同款曲线 */
  transition: transform var(--dur) var(--ease-soft);
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
