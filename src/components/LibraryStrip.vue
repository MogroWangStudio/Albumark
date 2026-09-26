<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import {
  CheckSquare,
  Copy,
  Crop,
  Droplets,
  Link2,
  Link2Off,
  MapPin,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-vue-next'
import { exifSummaryLine } from '@/core/exif'
import { composeThumb } from '@/core/compose'
import { isTauri, pickImagePaths } from '@/core/platform'
import { croppedSize, isPlainFullCrop } from '@/types/adjust'
import type { BorderLayer } from '@/types/watermark'
import { useAdjustStore } from '@/stores/adjust'
import { useImagesStore } from '@/stores/images'
import { useWatermarkStore } from '@/stores/watermark'
import { useWorkspaceStore } from '@/stores/workspace'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'

const images = useImagesStore()
const ws = useWorkspaceStore()
const adjust = useAdjustStore()
const wm = useWatermarkStore()

const emit = defineEmits<{ photoCtx: [e: MouseEvent, id: string] }>()

/* 几何签名：裁剪 / 翻转 / 拉直 / 边框变化后防抖重建缩略图，让图库与输出构图一致 */
const geoSig = computed(() =>
  JSON.stringify(
    images.items.map((i) => ({
      c: adjust.cropOf(i.id) ?? null,
      b: wm
        .effectiveLayers(i.id)
        .filter((l) => l.type === 'border' && l.visible)
        .map((l) => toRaw(l)),
    })),
  ),
)
let thumbTimer: number | null = null
watch(geoSig, () => {
  if (thumbTimer) window.clearTimeout(thumbTimer)
  thumbTimer = window.setTimeout(async () => {
    for (const item of images.items) {
      if (!item.blob) continue
      const crop = adjust.cropOf(item.id)
      const borders = wm
        .effectiveLayers(item.id)
        .filter((l): l is BorderLayer => l.type === 'border' && l.visible)
        .map((l) => toRaw(l))
      if (!crop && !borders.length) continue
      const blob = await composeThumb(item.blob, crop, borders)
      if (blob) images.setThumb(item.id, blob)
    }
  }, 500)
})

/** 照片启用的按张独立处理（单独调节 / 单独水印 / 裁剪），用于缩略图角标 */
function flags(id: string): ('adj' | 'wm' | 'crop')[] {
  const out: ('adj' | 'wm' | 'crop')[] = []
  if (adjust.isIndividual(id)) out.push('adj')
  if (wm.isIndividual(id)) out.push('wm')
  const c = adjust.cropOf(id)
  if (c && !isPlainFullCrop(c)) out.push('crop')
  return out
}

const active = computed(() => images.active)
const infoLine = computed(() => {
  const a = active.value
  if (!a) return ''
  const parts: string[] = []
  const size = croppedSize(a.width, a.height, adjust.cropOf(a.id))
  if (size.w && size.h) parts.push(`${size.w}×${size.h}`)
  parts.push(a.name)
  const ex = exifSummaryLine(a.exif)
  if (ex) parts.push(ex)
  return parts.join(' · ')
})

const missingCount = computed(() => images.items.filter((i) => i.missing).length)

/** 项目里复制与链接两种来源共存时，在缩略图上标出入库方式的小图标 */
const mixedKinds = computed(() => {
  let copy = false
  let link = false
  for (const i of images.items) {
    if (i.kind === 'link') link = true
    else copy = true
    if (copy && link) return true
  }
  return false
})

async function relinkActive(): Promise<void> {
  const a = active.value
  if (!a) return
  const [path] = await pickImagePaths('定位原文件')
  if (path) await ws.relink(a.id, path)
}

async function removeSelected(): Promise<void> {
  for (const id of [...images.selectedIds]) await ws.removeImage(id)
}

/* ---------- 移除确认：单张 / 所选 / 清空都先询问 ---------- */

const confirmState = ref<{ kind: 'one' | 'selected' | 'all'; id?: string; name: string; count: number } | null>(null)
const confirmText = computed(() => {
  const c = confirmState.value
  if (!c) return ''
  if (c.kind === 'one') return `移除「${c.name}」？照片将移入回收站，仍可从回收站找回。`
  if (c.kind === 'selected') return `移除所选的 ${c.count} 张照片？将移入回收站，仍可从回收站找回。`
  return `清空全部 ${c.count} 张照片？`
})

function askRemoveOne(id: string): void {
  const it = images.items.find((i) => i.id === id)
  confirmState.value = { kind: 'one', id, name: it?.name ?? '照片', count: 1 }
}
function askRemoveSelected(): void {
  confirmState.value = { kind: 'selected', name: '', count: images.selectedIds.size }
}
function askRemoveAll(): void {
  confirmState.value = { kind: 'all', name: '', count: images.count }
}
async function confirmRemove(): Promise<void> {
  const c = confirmState.value
  confirmState.value = null
  if (!c) return
  if (c.kind === 'one' && c.id) await ws.removeImage(c.id)
  else if (c.kind === 'selected') await removeSelected()
  else images.clear()
}

/* ---------- 多选模式：点击勾选、Shift 范围、拖动框选 ---------- */

const thumbsEl = ref<HTMLElement | null>(null)
const marquee = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let marqueeStart: { x: number; y: number } | null = null
let marqueeActive = false

function onThumbClick(e: MouseEvent, id: string): void {
  if (marqueeActive) {
    marqueeActive = false
    marquee.value = null
    return
  }
  if (images.multiSelect) {
    if (e.shiftKey && images.lastChecked) images.selectRange(images.lastChecked, id)
    else images.toggleSelect(id)
    return
  }
  images.select(id, e.metaKey || e.ctrlKey)
}

function onThumbDown(e: PointerEvent): void {
  if (!images.multiSelect) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  marqueeStart = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onThumbMove(e: PointerEvent): void {
  if (!marqueeStart) return
  if (!marqueeActive && Math.abs(e.clientX - marqueeStart.x) + Math.abs(e.clientY - marqueeStart.y) < 8) return
  marqueeActive = true
  const x = Math.min(marqueeStart.x, e.clientX)
  const y = Math.min(marqueeStart.y, e.clientY)
  const w = Math.abs(e.clientX - marqueeStart.x)
  const h = Math.abs(e.clientY - marqueeStart.y)
  marquee.value = { x, y, w, h }
  // 实时预览：与选框相交的缩略图进入选中集合
  const ids = new Set<string>()
  thumbsEl.value?.querySelectorAll<HTMLElement>('.thumb').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) {
      const id = el.dataset.id
      if (id) ids.add(id)
    }
  })
  images.selectedIds = ids
}

function onThumbUp(): void {
  marqueeStart = null
  // 结算留在 click 里：没有拖动时按勾选处理，拖动后忽略 click
}

const marqueeStyle = computed(() => {
  const m = marquee.value
  return m
    ? { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` }
    : {}
})
</script>

<template>
  <div class="strip material">
    <div
      ref="thumbsEl"
      class="thumbs"
      :class="{ choosing: images.multiSelect }"
    >
      <div
        v-for="(item, i) in images.items"
        :key="item.id"
        class="thumb"
        :class="{ active: item.id === images.activeId, selected: images.selectedIds.has(item.id), missing: item.missing }"
        :data-id="item.id"
        @click="onThumbClick($event, item.id)"
        @pointerdown="onThumbDown"
        @pointermove="onThumbMove"
        @pointerup="onThumbUp"
        @pointercancel="onThumbUp"
        @contextmenu.stop="emit('photoCtx', $event, item.id)"
      >
        <img
          v-if="item.thumbUrl"
          :src="item.thumbUrl"
          :alt="item.name"
          draggable="false"
          decoding="async"
        />
        <Link2Off v-else-if="item.missing" :size="18" class="missing-icon" />
        <span
          v-if="images.multiSelect && images.selectedIds.has(item.id)"
          class="pick"
        >
          <CheckSquare :size="13" />
        </span>
        <span v-if="mixedKinds && !item.missing" class="kind" :title="item.kind === 'link' ? '链接源文件' : '已复制原文件'">
          <Link2 v-if="item.kind === 'link'" :size="9" />
          <Copy v-else :size="9" />
        </span>
        <span
          v-for="(f, fi) in item.missing ? [] : flags(item.id)"
          :key="f"
          class="flag"
          :style="{ right: `${3 + fi * 17}px` }"
          :title="f === 'adj' ? '这张照片已开启单独调节' : f === 'wm' ? '这张照片已开启单独水印' : '这张照片已裁剪 / 变换'"
        >
          <SlidersHorizontal v-if="f === 'adj'" :size="9" />
          <Droplets v-else-if="f === 'wm'" :size="9" />
          <Crop v-else :size="9" />
        </span>
        <span class="idx">{{ i + 1 }}</span>
        <button
          v-if="!images.multiSelect"
          class="rm"
          aria-label="移除这张"
          @click.stop="askRemoveOne(item.id)"
        >
          <X :size="11" />
        </button>
      </div>
    </div>
    <div class="foot">
      <span class="count">{{ images.count }} 张照片</span>
      <template v-if="images.selectedIds.size > 1">
        <span class="sep">·</span>
        <span>已选 {{ images.selectedIds.size }} 张</span>
      </template>
      <template v-else-if="infoLine">
        <span class="sep">·</span>
        <span class="info" :title="infoLine">{{ infoLine }}</span>
      </template>
      <span class="flex" />
      <button
        v-if="isTauri && missingCount > 0"
        class="link warn"
        @click="relinkActive()"
      >
        <MapPin :size="12" />{{ missingCount }} 张源文件失联，重新定位
      </button>
      <template v-if="images.multiSelect">
        <button class="link" @click="images.selectAll()"><Square :size="12" />全选</button>
        <button v-if="images.selectedIds.size" class="link warn" @click="askRemoveSelected">
          <X :size="12" />移除所选
        </button>
      </template>
      <button v-else-if="images.selectedIds.size > 1" class="link" @click="askRemoveSelected">移除所选</button>
      <button v-if="images.count && !images.multiSelect" class="link" @click="askRemoveAll">清空</button>
      <button class="link toggle" :class="{ on: images.multiSelect }" @click="images.toggleMultiSelect()">
        <CheckSquare :size="12" />{{ images.multiSelect ? '完成' : '选择' }}
      </button>
    </div>
    <div v-if="marquee" class="marquee" :style="marqueeStyle" aria-hidden="true" />
    <AppDialog :open="!!confirmState" title="移除照片" :width="400" @close="confirmState = null">
      <p class="confirm-text">{{ confirmText }}</p>
      <div class="confirm-btns">
        <AppButton variant="ghost" size="sm" @click="confirmState = null">取消</AppButton>
        <AppButton variant="danger" size="sm" @click="confirmRemove">移除</AppButton>
      </div>
    </AppDialog>
  </div>
</template>

<style scoped>
.strip {
  flex: none;
  border-top: 1px solid var(--line);
  padding: 8px calc(12px + var(--safe-right)) calc(6px + var(--safe-bottom)) calc(12px + var(--safe-left));
}
.thumbs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.thumb {
  position: relative;
  width: 60px;
  height: 60px;
  flex: none;
  border-radius: 8px;
  overflow: hidden;
  background: var(--canvas);
  border: 2px solid transparent;
  transition: border-color var(--dur-hover) var(--ease-soft), transform var(--dur-fast) var(--ease);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb.missing {
  display: grid;
  place-items: center;
  border-style: dashed;
  border-color: var(--line-strong);
  color: var(--text-3);
}
.thumb:hover {
  border-color: var(--line-strong);
}
.thumb.selected {
  border-color: var(--text-3);
}
.thumb.active {
  border-color: var(--accent);
}
/* 多选模式下的勾选角标 */
.pick {
  position: absolute;
  top: 3px;
  left: 3px;
  display: grid;
  place-items: center;
  color: var(--accent);
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.6));
}
/* 框选矩形 */
.marquee {
  position: fixed;
  z-index: 70;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 4px;
  pointer-events: none;
}
.link.toggle.on {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.confirm-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  margin: 4px 0 14px;
}
.confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.missing-icon {
  opacity: 0.7;
}
.idx {
  position: absolute;
  left: 4px;
  bottom: 3px;
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.kind {
  position: absolute;
  right: 4px;
  bottom: 3px;
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--accent);
}
/* 单独调节 / 单独水印 / 裁剪角标：右上角横排 */
.flag {
  position: absolute;
  top: 3px;
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--accent);
}
.rm {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-soft);
}
.thumb:hover .rm {
  opacity: 1;
}
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  font-size: 12px;
  color: var(--text-3);
  min-width: 0;
}
.count {
  flex: none;
}
.info {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flex {
  flex: 1;
}
.link {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 5px;
  transition: color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.link:hover {
  color: var(--text);
  background: var(--hover);
}
.link.warn {
  color: var(--accent);
}
.link.warn:hover {
  color: var(--accent-strong);
}
</style>
