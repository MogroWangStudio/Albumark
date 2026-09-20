<script setup lang="ts">
import { computed } from 'vue'
import { Copy, Link2, Link2Off, MapPin, X } from 'lucide-vue-next'
import { exifSummaryLine } from '@/core/exif'
import { isTauri, pickImagePaths } from '@/core/platform'
import { useImagesStore } from '@/stores/images'
import { useWorkspaceStore } from '@/stores/workspace'

const images = useImagesStore()
const ws = useWorkspaceStore()

const emit = defineEmits<{ photoCtx: [e: MouseEvent, id: string] }>()

const active = computed(() => images.active)
const infoLine = computed(() => {
  const a = active.value
  if (!a) return ''
  const parts: string[] = []
  if (a.width && a.height) parts.push(`${a.width}×${a.height}`)
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
</script>

<template>
  <div class="strip material">
    <div class="thumbs">
      <div
        v-for="(item, i) in images.items"
        :key="item.id"
        class="thumb"
        :class="{ active: item.id === images.activeId, selected: images.selectedIds.has(item.id), missing: item.missing }"
        @click="images.select(item.id, $event.metaKey || $event.ctrlKey)"
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
        <span v-if="mixedKinds && !item.missing" class="kind" :title="item.kind === 'link' ? '链接源文件' : '已复制原文件'">
          <Link2 v-if="item.kind === 'link'" :size="9" />
          <Copy v-else :size="9" />
        </span>
        <span class="idx">{{ i + 1 }}</span>
        <button class="rm" aria-label="移除这张" @click.stop="ws.removeImage(item.id)">
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
      <button v-if="images.selectedIds.size > 1" class="link" @click="removeSelected">移除所选</button>
      <button v-if="images.count" class="link" @click="images.clear()">清空</button>
    </div>
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
