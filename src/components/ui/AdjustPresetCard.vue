<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import type { DropdownItem } from '@/components/ui/AppDropdown.vue'
import { cancelPresetThumb, requestPresetThumb } from '@/core/presetThumb'
import type { AdjustPreset } from '@/stores/adjustPresets'

const props = defineProps<{
  preset: AdjustPreset
  /** 预览底图（当前照片的缩略像素），为空时用内置样张 */
  base: ImageData | null
  /** 当前照片的参数与该预设完全一致 */
  active: boolean
  /** 「N 项调节 · 日期」这类一句话信息 */
  info: string
}>()

const emit = defineEmits<{
  apply: []
  applyAll: []
  remove: []
}>()

const canvas = ref<HTMLCanvasElement | null>(null)

function paint(): void {
  if (!canvas.value || !props.base) return
  // 底图本身就是 240px 的图库缩略图：降噪在这个尺寸既无噪可去，固定像素半径
  // 反而会把卡片糊成一块。预览跳过降噪，其余管线与导出完全一致。
  requestPresetThumb(canvas.value, props.base, { ...props.preset.values, denoise: 0 })
}

onMounted(paint)
watch(() => props.base, paint)
watch(() => props.preset.values, paint, { deep: true })
onBeforeUnmount(() => {
  if (canvas.value) cancelPresetThumb(canvas.value)
})

const menu = computed<DropdownItem[]>(() => [
  { label: '应用到全部照片', action: () => emit('applyAll') },
  { label: '删除预设', danger: true, action: () => emit('remove') },
])
</script>

<template>
  <div
    class="pcard"
    :class="{ active }"
    role="button"
    tabindex="0"
    :aria-pressed="active"
    :aria-label="`套用预设「${preset.name}」`"
    @click="emit('apply')"
    @keydown.enter.prevent="emit('apply')"
    @keydown.space.prevent="emit('apply')"
  >
    <div class="pthumb">
      <canvas ref="canvas" />
    </div>
    <span v-if="active" class="pbadge">已应用</span>
    <div class="pactions">
      <AppDropdown :items="menu" align="right">
        <template #trigger>
          <button class="pmore" title="更多操作" aria-label="更多操作">
            <MoreHorizontal :size="14" />
          </button>
        </template>
      </AppDropdown>
    </div>
    <div class="pmeta">
      <span class="pname" :title="preset.name">{{ preset.name }}</span>
      <span class="pinfo">{{ info }}</span>
    </div>
  </div>
</template>

<style scoped>
.pcard {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--surface);
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft),
    transform var(--dur-hover) var(--ease-soft),
    box-shadow var(--dur-hover) var(--ease-soft);
}
.pcard:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--surface-solid);
  transform: translateY(-2px);
}
.pcard:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* 选中：accent 描边 + 一圈同色内阴影，和悬停的轻微位移区分开 */
.pcard.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.pthumb {
  aspect-ratio: 16 / 10;
  background: color-mix(in srgb, var(--canvas) 88%, var(--text) 12%);
  border-bottom: 1px solid var(--line);
}
.pthumb canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.pbadge {
  position: absolute;
  top: 7px;
  left: 7px;
  height: 18px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: calc(10px * var(--ui-zoom, 1));
  font-weight: 500;
  letter-spacing: 0.01em;
  pointer-events: none;
}
.pactions {
  position: absolute;
  top: 6px;
  right: 6px;
}
.pmore {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: #f0ede8;
  background: rgba(0, 0, 0, 0.36);
  opacity: 0;
  transition:
    opacity var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft);
}
.pcard:hover .pmore,
.pcard:focus-within .pmore,
.pmore:focus-visible {
  opacity: 1;
}
.pmore:hover {
  background: rgba(0, 0, 0, 0.56);
}
.pmeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px 8px;
  min-width: 0;
}
.pname {
  font-size: calc(12.5px * var(--ui-zoom, 1));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pinfo {
  font-size: calc(10.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 没有悬停能力的触屏：更多按钮常驻，否则无从发现 */
@media (hover: none) {
  .pmore {
    opacity: 1;
  }
}
</style>
