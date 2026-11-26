<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Download, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import type { DropdownItem } from '@/components/ui/AppDropdown.vue'
import { renderTemplateThumb } from '@/core/sample'
import { fmtSize } from '@/core/format'
import { isTauri, pickBinaryFile, saveBinaryFile } from '@/core/platform'
import {
  TEMPLATE_EXT,
  TEMPLATE_MIME,
  packWatermarkTemplate,
  unpackWatermarkTemplate,
  watermarkFileName,
  watermarkTemplateBytes,
} from '@/core/watermarkFile'
import { useI18n } from '@/i18n'
import { toast } from '@/stores/toast'
import { useTemplatesStore } from '@/stores/templates'
import type { WatermarkTemplate } from '@/types/watermark'

const emit = defineEmits<{ edit: [id: string]; create: [] }>()

const templates = useTemplatesStore()
const { t } = useI18n()

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
  for (const tpl of templates.all) {
    const canvas = thumbEls.get(tpl.id)
    if (!canvas) continue
    await renderTemplateThumb(canvas, tpl.layers, tpl.assets)
    if (seq !== renderSeq) return
  }
  computeSizes()
}

/** 模板 .zip 的真实打包体积：卡片上直接显示，用户导出前就知道文件多大 */
const sizes = ref<Record<string, number>>({})
function computeSizes(): void {
  const next: Record<string, number> = {}
  for (const tpl of templates.all) next[tpl.id] = watermarkTemplateBytes(tpl)
  sizes.value = next
}

onMounted(renderAll)
watch(
  () => templates.all.map((tpl) => `${tpl.id}:${tpl.name}:${tpl.layers.length}:${tpl.updatedAt ?? tpl.createdAt}`).join('|'),
  renderAll,
)

/* ---------- 模板 zip 导入 / 导出：单文件模板，内含图片素材 ---------- */

const fileInput = ref<HTMLInputElement | null>(null)

function importClick(): void {
  if (isTauri) {
    void importFromTauri()
    return
  }
  fileInput.value?.click()
}

async function importFromTauri(): Promise<void> {
  const picked = await pickBinaryFile(t('导入水印模板'), ['zip'], t('水印模板 (.zip)'))
  if (!picked) return
  await importBytes(picked.bytes)
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await importBytes(new Uint8Array(await file.arrayBuffer()))
}

async function importBytes(bytes: Uint8Array): Promise<void> {
  try {
    const tpl = unpackWatermarkTemplate(bytes)
    const id = templates.importTemplate(tpl)
    if (!id) {
      toast(t('模板过大，仅保存到本次会话'), 'error')
      return
    }
    toast(t('已导入模板「{0}」', tpl.name), 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : t('不是有效的 Albumark 水印模板文件'), 'error')
  }
}

async function exportTemplate(tpl: WatermarkTemplate): Promise<void> {
  try {
    const bytes = packWatermarkTemplate(tpl)
    const saved = await saveBinaryFile(watermarkFileName(tpl.name), bytes, {
      label: t('水印模板 (.zip)'),
      extensions: ['zip'],
      mime: TEMPLATE_MIME,
      sub: 'watermarks',
    })
    if (saved) toast(t('已导出模板「{0}」', tpl.name), 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : t('导出模板失败'), 'error')
  }
}

/* ---------- 卡片操作：编辑 / 复制 / 重命名 / 删除（内置模板保护） ---------- */

const renameTarget = ref<WatermarkTemplate | null>(null)
const renameName = ref('')
const removeTarget = ref<WatermarkTemplate | null>(null)

function cardItems(tpl: WatermarkTemplate): DropdownItem[] {
  return [
    { label: t('编辑'), action: () => emit('edit', tpl.id) },
    { label: t('导出模板'), action: () => void exportTemplate(tpl) },
    { label: t('复制为新模板'), action: () => void templates.duplicate(tpl.id) },
    ...(tpl.builtin
      ? []
      : [
          {
            label: t('重命名'),
            action: () => {
              renameTarget.value = tpl
              renameName.value = tpl.name
            },
          },
          { label: t('删除'), danger: true, action: () => (removeTarget.value = tpl) },
        ]),
  ]
}

function confirmRename(): void {
  const tpl = renameTarget.value
  if (tpl) templates.rename(tpl.id, renameName.value)
  renameTarget.value = null
}

function confirmRemove(): void {
  const tpl = removeTarget.value
  removeTarget.value = null
  if (tpl) templates.remove(tpl.id)
}

function fmtDate(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="tmanage">
    <div class="tbar">
      <AppButton size="sm" @click="importClick"><Upload :size="13" />{{ t('导入模板…') }}</AppButton>
    </div>
    <input
      ref="fileInput"
      type="file"
      :accept="TEMPLATE_EXT"
      hidden
      @change="onImportFile"
    />
    <div class="grid">
      <div v-for="tpl in templates.all" :key="tpl.id" class="tcard" @click="emit('edit', tpl.id)">
        <div class="thumb-box">
          <canvas :ref="setThumbRef(tpl.id)" class="thumb" />
        </div>
        <div class="tmeta">
          <span class="tname" :title="t(tpl.name)">{{ t(tpl.name) }}</span>
          <span class="tinfo">{{ t('{0} 个图层', tpl.layers.length) }}<template v-if="sizes[tpl.id]"> · {{ fmtSize(sizes[tpl.id]) }}</template><template v-if="tpl.updatedAt ?? tpl.createdAt"> · {{ fmtDate(tpl.updatedAt ?? tpl.createdAt) }}</template></span>
        </div>
        <span v-if="tpl.builtin" class="badge">{{ t('内置') }}</span>
        <button
          class="texport"
          :title="t('导出模板')"
          :aria-label="t('导出模板')"
          @click.stop="exportTemplate(tpl)"
        >
          <Download :size="14" />
        </button>
        <AppDropdown :items="cardItems(tpl)" align="right">
          <template #trigger>
            <!-- 点击由 .dd-trigger 处理并阻止冒泡，无需在此 stop（会拦断 toggle） -->
            <button class="tmore" :title="t('更多操作')"><MoreHorizontal :size="15" /></button>
          </template>
        </AppDropdown>
      </div>
    </div>

    <!-- 重命名 -->
    <AppDialog
      :open="!!renameTarget"
      :title="t('重命名模板')"
      :width="360"
      @close="renameTarget = null"
    >
      <input
        v-model="renameName"
        class="text-input"
        :placeholder="t('模板名称')"
        @keyup.enter="confirmRename"
      />
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="renameTarget = null">{{ t('取消') }}</AppButton>
        <AppButton variant="primary" @click="confirmRename"><Pencil :size="13" />{{ t('重命名') }}</AppButton>
      </div>
    </AppDialog>

    <!-- 删除确认 -->
    <AppDialog
      :open="!!removeTarget"
      :title="t('删除模板')"
      :width="380"
      @close="removeTarget = null"
    >
      <p class="confirm-text">{{ t('将删除模板「{0}」，此操作不可撤销。确定删除吗？', removeTarget?.name ?? '') }}</p>
      <div class="confirm-btns">
        <AppButton variant="ghost" @click="removeTarget = null">{{ t('取消') }}</AppButton>
        <AppButton variant="danger" @click="confirmRemove"><Trash2 :size="13" />{{ t('删除') }}</AppButton>
      </div>
    </AppDialog>
  </div>
</template>

<style scoped>
.tmanage {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 20px calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
}
/* 模板库工具栏：导入 zip 放左上，与卡片网格同一条对齐线 */
.tbar {
  max-width: 1060px;
  margin: 0 auto 12px;
  display: flex;
  justify-content: flex-start;
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
  /* 与编辑器的样张工作台同色：缩略图不再垫一层纯白底 */
  background: color-mix(in srgb, var(--canvas) 88%, var(--text) 12%);
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
  font-size: calc(13px * var(--ui-zoom, 1));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tinfo {
  font-size: calc(11px * var(--ui-zoom, 1));
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
  font-size: calc(10.5px * var(--ui-zoom, 1));
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
/* 常驻的导出钮：与 ⋯ 并列、默认可见，避免导出功能只藏在菜单里找不到 */
.texport {
  position: absolute;
  top: 8px;
  right: 38px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: #f0ede8;
  background: rgba(0, 0, 0, 0.42);
  opacity: 1;
  transition: opacity var(--dur-hover) var(--ease-soft), background var(--dur-hover) var(--ease-soft);
}
.tcard:hover .tmore,
.tmore:focus-visible,
.texport:focus-visible {
  opacity: 1;
}
.tmore:hover,
.texport:hover {
  background: rgba(0, 0, 0, 0.55);
}
.confirm-text {
  font-size: calc(12.5px * var(--ui-zoom, 1));
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
  font-size: calc(12.5px * var(--ui-zoom, 1));
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
