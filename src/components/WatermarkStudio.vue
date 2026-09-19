<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Check, Plus, Save, Trash2 } from 'lucide-vue-next'
import LayerEditor from '@/components/LayerEditor.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDropdown from '@/components/ui/AppDropdown.vue'
import type { DropdownItem } from '@/components/ui/AppDropdown.vue'
import { drawLayers, type AssetMap } from '@/core/draw'
import { resolveTokens } from '@/core/tokens'
import { toast } from '@/stores/toast'
import { usePresetsStore } from '@/stores/presets'
import { useWatermarkStore } from '@/stores/watermark'

const emit = defineEmits<{ back: [] }>()

const wm = useWatermarkStore()
const presets = usePresetsStore()

const SAMPLE_W = 1600
const SAMPLE_H = 1067

const canvasEl = ref<HTMLCanvasElement | null>(null)
const showSave = ref(false)
const saveName = ref('')

let sampleBmp: ImageBitmap | null = null
const assetBmps: AssetMap = new Map()
let rafPending = false

/** 生成一张干净的样张（渐变天空 + 地平线），工作室里预览水印效果 */
async function makeSample(): Promise<ImageBitmap> {
  const oc = new OffscreenCanvas(SAMPLE_W, SAMPLE_H)
  const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D
  const sky = ctx.createLinearGradient(0, 0, 0, SAMPLE_H * 0.72)
  sky.addColorStop(0, '#2b3a4a')
  sky.addColorStop(0.65, '#6e7f8c')
  sky.addColorStop(1, '#c9b8a3')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, SAMPLE_W, SAMPLE_H * 0.72)
  // 太阳
  ctx.fillStyle = 'rgba(255, 214, 156, 0.9)'
  ctx.beginPath()
  ctx.arc(SAMPLE_W * 0.68, SAMPLE_H * 0.4, SAMPLE_H * 0.11, 0, Math.PI * 2)
  ctx.fill()
  // 地面
  const ground = ctx.createLinearGradient(0, SAMPLE_H * 0.72, 0, SAMPLE_H)
  ground.addColorStop(0, '#4a4238')
  ground.addColorStop(1, '#2a2620')
  ctx.fillStyle = ground
  ctx.fillRect(0, SAMPLE_H * 0.72, SAMPLE_W, SAMPLE_H * 0.28)
  // 远山剪影
  ctx.fillStyle = 'rgba(38, 34, 30, 0.85)'
  ctx.beginPath()
  ctx.moveTo(0, SAMPLE_H * 0.72)
  ctx.lineTo(SAMPLE_W * 0.22, SAMPLE_H * 0.55)
  ctx.lineTo(SAMPLE_W * 0.4, SAMPLE_H * 0.72)
  ctx.lineTo(SAMPLE_W * 0.56, SAMPLE_H * 0.6)
  ctx.lineTo(SAMPLE_W * 0.78, SAMPLE_H * 0.72)
  ctx.closePath()
  ctx.fill()
  return await createImageBitmap(oc)
}

function redraw(): void {
  const canvas = canvasEl.value
  if (!canvas || !sampleBmp) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cw = Math.round(rect.width * dpr)
  const ch = Math.round(rect.height * dpr)
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const fit = Math.min(cw / SAMPLE_W, ch / SAMPLE_H)
  ctx.translate((cw - SAMPLE_W * fit) / 2, (ch - SAMPLE_H * fit) / 2)
  ctx.scale(fit, fit)
  ctx.drawImage(sampleBmp, 0, 0)
  const layers = wm.plainLayers().map((l) =>
    l.type === 'text' ? { ...l, content: resolveTokens(l.content, undefined, '样张') } : l,
  )
  drawLayers(ctx, SAMPLE_W, SAMPLE_H, layers, assetBmps)
}

function scheduleRedraw(): void {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    void syncAssets().then(redraw)
  })
}

async function syncAssets(): Promise<void> {
  const needed = new Set(
    wm.layers.filter((l) => l.type === 'image').map((l) => (l as { assetId: string }).assetId),
  )
  for (const key of [...assetBmps.keys()]) {
    if (!needed.has(key)) {
      assetBmps.get(key)?.close()
      assetBmps.delete(key)
    }
  }
  const missing = [...needed].filter((id) => !assetBmps.has(id))
  if (missing.length) {
    const payloads = await wm.assetPayloads(wm.layers)
    for (const p of payloads) {
      if (!assetBmps.has(p.id)) {
        try {
          assetBmps.set(p.id, await createImageBitmap(p.blob))
        } catch {
          /* 跳过无效素材 */
        }
      }
    }
  }
}

function presetItems(): DropdownItem[] {
  if (!presets.all.length) return [{ label: '还没有保存的水印', disabled: true, action: () => undefined }]
  return presets.all.map((p) => ({
    label: p.name,
    danger: false,
    action: () => {
      presets.apply(p.id)
    },
  }))
}

function deleteItems(): DropdownItem[] {
  return presets.all.map((p) => ({
    label: `删除「${p.name}」`,
    danger: true,
    action: () => presets.remove(p.id),
  }))
}

async function savePreset(): Promise<void> {
  const name = saveName.value.trim()
  if (!name) return
  if (!presets.save(name)) {
    toast('水印过大，保存失败', 'error')
    return
  }
  showSave.value = false
  saveName.value = ''
  toast(`已保存水印「${name}」`, 'success')
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  sampleBmp = await makeSample()
  ro = new ResizeObserver(() => redraw())
  if (canvasEl.value) ro.observe(canvasEl.value)
  redraw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  sampleBmp?.close()
  sampleBmp = null
  for (const b of assetBmps.values()) b.close()
  assetBmps.clear()
})

watch(() => wm.layers, scheduleRedraw, { deep: true })
</script>

<template>
  <div class="studio">
    <header class="head material">
      <AppButton variant="ghost" size="sm" @click="emit('back')"><ArrowLeft :size="14" />返回</AppButton>
      <h1>水印工作室</h1>
      <span class="flex" />
      <AppButton size="sm" @click="wm.addText()"><Plus :size="13" />新建空白</AppButton>
      <AppDropdown :items="presetItems()" align="right">
        <template #trigger>
          <AppButton size="sm"><Check :size="13" />应用水印</AppButton>
        </template>
      </AppDropdown>
      <AppDropdown v-if="presets.all.length" :items="deleteItems()" align="right">
        <template #trigger>
          <AppButton size="sm" variant="ghost"><Trash2 :size="13" /></AppButton>
        </template>
      </AppDropdown>
      <AppButton size="sm" variant="primary" @click="showSave = true"><Save :size="13" />保存为水印</AppButton>
    </header>

    <div v-if="showSave" class="save-bar">
      <input v-model="saveName" class="text-input" placeholder="水印名称" @keyup.enter="savePreset" />
      <AppButton size="sm" variant="primary" @click="savePreset">保存</AppButton>
      <AppButton size="sm" variant="ghost" @click="showSave = false">取消</AppButton>
    </div>

    <div class="body">
      <div class="preview">
        <canvas ref="canvasEl" class="sample" />
        <p class="tip">样张仅用于预览，保存的水印会应用到工作区里的每一张照片。</p>
      </div>
      <aside class="editor material">
        <LayerEditor :img-w="SAMPLE_W" :img-h="SAMPLE_H" :show-templates="false" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.studio {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(46px + var(--safe-top));
  padding: var(--safe-top) calc(14px + var(--safe-right)) 0 calc(14px + var(--safe-left));
  flex: none;
  border-bottom: 1px solid var(--line);
}
h1 {
  font-size: 14px;
  font-weight: 600;
}
.flex {
  flex: 1;
}
.save-bar {
  display: flex;
  gap: 6px;
  padding: 10px calc(14px + var(--safe-right)) 0 calc(14px + var(--safe-left));
}
.text-input {
  flex: 1;
  max-width: 280px;
  height: var(--control-h);
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: 12.5px;
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 340px;
  min-height: 0;
}
.preview {
  position: relative;
  display: grid;
  place-items: center;
  padding: 20px;
  min-width: 0;
  min-height: 0;
  background: var(--canvas);
}
.sample {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
}
.tip {
  position: absolute;
  bottom: 10px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-3);
}
.editor {
  border-left: 1px solid var(--line);
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
}
@media (max-width: 900px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr minmax(200px, 46%);
  }
  .editor {
    border-left: none;
    border-top: 1px solid var(--line);
  }
}
</style>
