<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useImagesStore } from '@/stores/images'

const images = useImagesStore()
</script>

<template>
  <div class="strip material">
    <div class="thumbs">
      <div
        v-for="(item, i) in images.items"
        :key="item.id"
        class="thumb"
        :class="{ active: item.id === images.activeId, selected: images.selectedIds.has(item.id) }"
        @click="images.select(item.id, $event.metaKey || $event.ctrlKey)"
      >
        <img
          v-if="item.thumbUrl"
          :src="item.thumbUrl"
          :alt="item.name"
          draggable="false"
          decoding="async"
        />
        <span class="idx">{{ i + 1 }}</span>
        <button class="rm" aria-label="移除这张" @click.stop="images.remove([item.id])">
          <X :size="11" />
        </button>
      </div>
    </div>
    <div class="foot">
      <span class="count">{{ images.count }} 张照片</span>
      <span v-if="images.selectedIds.size > 1" class="sep">·</span>
      <span v-if="images.selectedIds.size > 1">已选 {{ images.selectedIds.size }} 张</span>
      <span class="flex" />
      <button v-if="images.selectedIds.size > 1" class="link" @click="images.remove([...images.selectedIds])">移除所选</button>
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
.thumb:hover {
  border-color: var(--line-strong);
}
.thumb.selected {
  border-color: var(--text-3);
}
.thumb.active {
  border-color: var(--accent);
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
}
.flex {
  flex: 1;
}
.link {
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
</style>
