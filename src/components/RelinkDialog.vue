<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, FileQuestion, Link2Off, TriangleAlert } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import type { RelinkCandidate } from '@/stores/workspace'

const props = defineProps<{
  open: boolean
  candidates: RelinkCandidate[]
  /** 确认后的批量执行中：禁用按钮防重复提交 */
  busy?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [list: { id: string; path: string; force: boolean }[]]
}>()

/** 勾选状态：识别码相符的默认选中；不符的默认不选，手动勾选即强制链接 */
const checkedIds = ref(new Set<string>())
watch(
  () => props.open,
  (v) => {
    if (!v) return
    const next = new Set<string>()
    for (const c of props.candidates) if (c.path && c.codeOk) next.add(c.id)
    checkedIds.value = next
  },
  { immediate: true },
)

function toggle(id: string): void {
  const next = new Set(checkedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checkedIds.value = next
}

const found = computed(() => props.candidates.filter((c) => c.path))
const selectedCount = computed(() => found.value.filter((c) => checkedIds.value.has(c.id)).length)

/** 勾选即提交：force = 内容不符但用户明确勾选（接受同名但内容有差异的文件） */
const picked = computed(() =>
  found.value
    .filter((c) => checkedIds.value.has(c.id))
    .map((c) => ({ id: c.id, path: c.path!, force: !c.codeOk })),
)
</script>

<template>
  <AppDialog :open="open" title="重新定位源文件" :width="560" @close="emit('close')">
    <p class="lead">
      按文件名在所选文件夹中匹配到 {{ found.length }} / {{ candidates.length }} 张失联照片，
      识别码一致的已默认勾选
    </p>
    <ul class="match-list">
      <li
        v-for="c in candidates"
        :key="c.id"
        class="match-row"
        :class="{ off: !c.path, checked: checkedIds.has(c.id) }"
      >
        <template v-if="c.path">
          <button
            class="pick"
            role="checkbox"
            :aria-checked="checkedIds.has(c.id)"
            @click="toggle(c.id)"
          >
            <span class="dot" :class="{ on: checkedIds.has(c.id) }">
              <Check v-if="checkedIds.has(c.id)" :size="12" />
            </span>
          </button>
          <div class="match-main">
            <span class="name">{{ c.name }}</span>
            <span class="path" :title="c.path">{{ c.path }}</span>
          </div>
          <span class="badge" :class="c.codeOk ? 'ok' : 'warn'">
            <template v-if="c.codeOk">识别码一致</template>
            <template v-else><TriangleAlert :size="11" />内容不符</template>
          </span>
        </template>
        <template v-else>
          <span class="dot off"><FileQuestion :size="12" /></span>
          <div class="match-main">
            <span class="name">{{ c.name }}</span>
            <span class="path">文件夹里没有同名文件</span>
          </div>
          <span class="badge miss">未找到</span>
        </template>
      </li>
    </ul>
    <div class="actions">
      <span class="count">已选 {{ selectedCount }} / {{ found.length }}</span>
      <AppButton size="sm" variant="ghost" :disabled="busy" @click="emit('close')">取消</AppButton>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="!selectedCount || busy"
        @click="emit('confirm', picked)"
      >
        <Link2Off :size="13" />重新定位
      </AppButton>
    </div>
  </AppDialog>
</template>

<style scoped>
.lead {
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text-2);
  margin-bottom: 12px;
}
.match-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
}
.match-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  transition: background var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft);
}
.match-row.checked {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.match-row.off {
  opacity: 0.55;
}
.pick {
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}
.dot {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  /* deslop-ignore-next-line 19 —— 圆形勾选点，与基线内圆形选择圈（多选 sel-dot）同一有意设计 */
  border-radius: 50%;
  border: 1.5px solid var(--line);
  color: #fff;
  flex: none;
}
.dot.on {
  background: var(--accent);
  border-color: var(--accent);
}
.dot.off {
  color: var(--text-3);
}
.match-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
  text-align: left;
}
.name {
  font-size: calc(13px * var(--ui-zoom, 1));
  color: var(--text);
}
.path {
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: calc(11px * var(--ui-zoom, 1));
}
.badge.ok {
  color: var(--text-2);
  background: var(--hover);
}
/* 内容不符：中性底 + 三角图标表意，不引入新色 token——勾选与否由用户决定 */
.badge.warn {
  color: var(--text-2);
  background: var(--hover);
}
.badge.miss {
  color: var(--text-3);
  background: var(--hover);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.count {
  margin-right: auto;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
</style>
