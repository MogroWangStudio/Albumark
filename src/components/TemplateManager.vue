<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import type { DropdownItem } from '@/components/ui/AppDropdown.vue'
import { renderTemplateThumb } from '@/core/sample'
import { useTemplatesStore } from '@/stores/templates'
import type { WatermarkTemplate } from '@/types/watermark'

const emit = defineEmits<{ edit: [id: string]; create: [] }>()

const templates = useTemplatesStore()

/* ---------- 缩略图：canvas 按模板 id 登记，列表变化后逐个重绘 ---------- */

const thumbEls = new Map<string, HTMLCanvasElement>()
let renderSeq = 0

function setThumbRef(id: string): (el: unknown) => void {
  return (el) => {
    if (el) thumbEls.set(id, el as HTMLCanvasElement)
    else thumbEls.delete(id)
  }
}

async function renderAll(): Promise<void> {
  const seq = ++renderSeq
  // 等 DOM 更新完成即可：getBoundingClientRect 会强制同步布局，不依赖 rAF
  // （后台窗口/无焦点标签页的 rAF 会被浏览器暂停，await 它可能永远挂起）
  await nextTick()
  for (const t of templates.all) {
    const canvas = thumbEls.get(t.id)
    if (!canvas) continue
    await renderTemplateThumb(canvas, t.layers, t.assets)
    if (seq !== renderSeq) return
  }
}

onMounted(renderAll)
watch(
  () => templates.all.map((t) => `${t.id}:${t.name}:${t.layers.length}:${t.updatedAt ?? t.createdAt}`).join('|'),
  renderAll,
)

/* ---------- 卡片操作：编辑 / 复制 / 重命名 / 删除（内置模板保护） ---------- */

const renameTarget = ref<WatermarkTemplate | null>(null)
const renameName = ref('')
const removeTarget = ref<WatermarkTemplate | null>(null)

function cardItems(t: WatermarkTemplate): DropdownItem[] {
  return [
    { label: '编辑', action: () => emit('edit', t.id) },
    { label: '复制为新模板', action: () => void templates.duplicate(t.id) },
    ...(t.builtin
      ? []
      : [
          {
            label: '重命名',
            action: () => {
              renameTarget.value = t
              renameName.value = t.name
            },
          },
          { label: '删除', danger: true, action: () => (removeTarget.value = t) },
        ]),
  ]
}

function confirmRename(): void {
  const t = renameTarget.value
  if (t) templates.rename(t.id, renameName.value)
  renameTarget.value = null
}

function confirmRemove(): void {
  const t = removeTarget.value
  removeTarget.value = null
  if (t) templates.remove(t.id)
}

function fmtDate(t?: number): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="tmanage">
    <div class="grid">
      <div v-for="t in templates.all" :key="t.id" class="tcard" @click="emit('edit', t.id)">
        <div class="thumb-box">
          <canvas :ref="setThumbRef(t.id)" class="thumb" />
        </div>
        <div class="tmeta">
          <span class="tname" :title="t.name">{{ t.name }}</span>
          <span class="tinfo">{{ t.layers.length }} 个图层<template v-if="t.updatedAt ?? t.createdAt"> · {{ fmtDate(t.updatedAt ?? t.createdAt) }}</template></span>
        </div>
        <span v-if="t.builtin" class="badge">内置</span>
        <AppDropdown :items="cardItems(t)" align="right">
          <template #trigger>
            <!-- 点击由 .dd-trigger 处理并阻止冒泡，无需在此 stop（会拦断 toggle） -->
            <button class="tmore" title="更多操作"><MoreHorizontal :size="15" /></button>
          </template>
        </AppDropdown>
      </div>
    </div>

    <!-- 重命名 -->
    <AppDialog
      :open="!!renameTarget"
      title="重命名模板"
      :width="360"
      @close="renameTarget = null"
    >
      <input
        v-model="renameName"
        class="text-input"
        placeholder="模板名称"
        @keyup.enter="confirmRename"
      />
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="renameTarget = null">取消</AppButton>
        <AppButton variant="primary" @click="confirmRename"><Pencil :size="13" />重命名</AppButton>
      </div>
    </AppDialog>

    <!-- 删除确认 -->
    <AppDialog
      :open="!!removeTarget"
      title="删除模板"
      :width="380"
      @close="removeTarget = null"
    >
      <p class="confirm-text">将删除模板「{{ removeTarget?.name }}」，此操作不可撤销。确定删除吗？</p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeTarget = null">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove"><Trash2 :size="13" />删除</AppButton>
      </div>
    </AppDialog>
  </div>
</template>

<style scoped>
.tmanage {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
  max-width: 1060px;
  margin: 0 auto;
}
.tcard {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--surface);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft),
    transform var(--dur-hover) var(--ease-soft);
}
.tcard:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--surface-solid);
  transform: translateY(-2px);
}
.thumb-box {
  aspect-ratio: 16 / 10;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
}
.thumb {
  display: block;
  width: 100%;
  height: 100%;
}
.tmeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px 11px;
  min-width: 0;
}
.tname {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tinfo {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.badge {
  position: absolute;
  top: 8px;
  left: 8px;
  height: 18px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  color: #f0ede8;
  font-size: 10.5px;
}
.tmore {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: #f0ede8;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.tcard:hover .tmore,
.tmore:focus-visible {
  opacity: 1;
}
.tmore:hover {
  background: rgba(0, 0, 0, 0.55);
}
.confirm-text {
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
  margin-bottom: 14px;
}
.text-input {
  width: 100%;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: 12.5px;
  margin-bottom: 14px;
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
