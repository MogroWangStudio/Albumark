<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, Search } from 'lucide-vue-next'
import AppDialog from '@/components/ui/AppDialog.vue'
import { FONT_CATEGORY_LABELS, useFontsStore, type FontCategory } from '@/stores/fonts'
import { toast } from '@/stores/toast'

/** 独立的字体选择窗口：列出系统全部字体（按语言分类），行内以该字体本身渲染预览。 */
const props = defineProps<{
  open: boolean
  /** 当前生效的字体族（纯名称，不带引号；空 = 系统默认） */
  current?: string
}>()

const emit = defineEmits<{
  close: []
  select: [family: string]
}>()

const fonts = useFontsStore()
const query = ref('')
const activeCat = ref<FontCategory | 'all'>('all')
const searchEl = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  async (v) => {
    if (!v) return
    query.value = ''
    activeCat.value = 'all'
    void fonts.ensureFonts() // 打开窗口即用户手势，正是 Local Font Access 授权询问的时机
    await nextTick()
    searchEl.value?.focus()
  },
)

const categories = computed(() => fonts.grouped().map((g) => g.category))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return fonts.fonts.filter(
    (f) =>
      (activeCat.value === 'all' || f.category === activeCat.value) &&
      (!q || f.family.toLowerCase().includes(q)),
  )
})

/** CSS font-family 值需要引号包住字体族名 */
function quote(family: string): string {
  return `"${family}"`
}

function pick(family: string): void {
  const known = fonts.fonts.some((f) => f.family === family)
  if (!known) toast(`已使用字体「${family}」`, 'success') // 清单外键入的名称提示生效
  emit('select', family)
  emit('close')
}

/** 回车直接应用输入：命中清单则选中，否则按键入名称原样应用（字体缺失时由系统回退） */
function onSearchEnter(): void {
  const name = query.value.trim()
  if (name) pick(name)
}
</script>

<template>
  <AppDialog :open="open" title="选择字体" :width="560" @close="emit('close')">
    <div class="picker">
      <div class="search-row">
        <Search :size="14" class="search-icon" />
        <input
          ref="searchEl"
          v-model="query"
          class="search"
          type="text"
          aria-label="搜索字体"
          placeholder="搜索字体，回车应用输入的名称"
          spellcheck="false"
          @keyup.enter="onSearchEnter"
        />
      </div>
      <div class="cats" role="tablist" aria-label="按语言分类">
        <button
          class="cat"
          :class="{ on: activeCat === 'all' }"
          @click="activeCat = 'all'"
        >
          全部
        </button>
        <button
          v-for="c in categories"
          :key="c"
          class="cat"
          :class="{ on: activeCat === c }"
          @click="activeCat = activeCat === c ? 'all' : c"
        >
          {{ FONT_CATEGORY_LABELS[c] }}
        </button>
      </div>
      <div class="list" role="listbox" aria-label="系统字体">
        <p v-if="fonts.loading && !fonts.fonts.length" class="status">正在读取系统字体…</p>
        <template v-else>
          <p v-if="!filtered.length" class="status">没有匹配的字体，回车可应用输入的名称。</p>
          <button
            v-for="f in filtered"
            :key="f.family"
            class="frow"
            role="option"
            :aria-selected="f.family === current"
            @click="pick(f.family)"
          >
            <span class="fname" :style="{ fontFamily: quote(f.family) }">{{ f.family }}</span>
            <span class="fcat">{{ FONT_CATEGORY_LABELS[f.category] }}</span>
            <Check v-if="f.family === current" :size="14" class="fmark" />
          </button>
        </template>
      </div>
      <p v-if="fonts.denied" class="status denied">
        浏览器未授权读取系统字体，列表为常用字体清单；可直接键入字体名称后回车。
      </p>
    </div>
  </AppDialog>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.search-row {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-3);
  pointer-events: none;
}
.search {
  width: 100%;
  height: var(--control-h);
  padding: 0 10px 0 30px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: calc(12.5px * var(--ui-zoom, 1));
}
.search:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.cat {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  transition: color var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft);
}
.cat:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.cat.on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.list {
  height: min(400px, 52vh);
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.frow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  text-align: left;
  transition: background var(--dur-hover) var(--ease-soft);
}
.frow:hover {
  background: var(--hover);
}
.fname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(13px * var(--ui-zoom, 1));
}
.fcat {
  flex: none;
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.fmark {
  flex: none;
  color: var(--accent);
}
.status {
  margin: 0;
  padding: 10px;
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-3);
}
.denied {
  padding: 0;
}
</style>
