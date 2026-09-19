import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { buildZip, runExport } from '@/core/exporter'
import { isTauri, pickDirectory, revealInFolder, saveZip, writeFilesToDir } from '@/core/platform'
import { useAdjustStore } from './adjust'
import { useImagesStore } from './images'
import { useWatermarkStore } from './watermark'
import { toast } from './toast'

export const useExportStore = defineStore('export', () => {
  const images = useImagesStore()
  const wm = useWatermarkStore()
  const adjust = useAdjustStore()

  const quality = ref(90)
  const longEdge = ref(0) // 0 = 原始尺寸
  const pattern = ref('{name}')
  const mode = ref<'zip' | 'folder'>('zip')

  const phase = ref<'idle' | 'running' | 'done'>('idle')
  const done = ref(0)
  const total = ref(0)
  const current = ref('')
  const errors = ref<string[]>([])
  const resultPath = ref<string | null>(null)

  const progress = computed(() => (total.value ? done.value / total.value : 0))

  async function run(): Promise<void> {
    if (phase.value === 'running' || !images.items.length) return
    errors.value = []
    resultPath.value = null

    if (mode.value === 'folder' && !isTauri) {
      toast('浏览器版本仅支持导出 ZIP，已自动切换', 'error')
      mode.value = 'zip'
    }

    let dir: string | null = null
    if (mode.value === 'folder') {
      dir = await pickDirectory()
      if (!dir) return
    }

    phase.value = 'running'
    total.value = images.items.length
    done.value = 0
    current.value = ''

    try {
      const assets = await wm.assetPayloads(wm.layers)
      const outputs = await runExport(
        images.items,
        {
          layers: wm.plainLayers(),
          adjustments: adjust.snapshotFor(null),
          perImage: adjust.perImageSnapshot(),
          assets,
          quality: quality.value,
          longEdge: longEdge.value,
          pattern: pattern.value,
        },
        Math.max(1, (navigator.hardwareConcurrency || 4) - 1),
        (d, t, name) => {
          done.value = d
          total.value = t
          current.value = name
        },
        (name, err) => {
          errors.value.push(`${name}：${err instanceof Error ? err.message : String(err)}`)
        },
      )

      if (outputs.size === 0) {
        phase.value = 'idle'
        toast('没有照片导出成功', 'error')
        return
      }

      if (mode.value === 'folder' && dir) {
        const list = [...outputs.entries()].map(([name, bytes]) => ({ name, bytes }))
        await writeFilesToDir(dir, list)
        resultPath.value = dir
      } else {
        const now = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        const zipName = `Albumark_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.zip`
        const zipBytes = buildZip(outputs)
        resultPath.value = await saveZip(zipName, zipBytes)
      }
      phase.value = 'done'
      toast(`已导出 ${outputs.size} 张照片`, 'success')
    } catch (e) {
      phase.value = 'idle'
      const message = e instanceof Error ? e.message : String(e)
      toast(`导出失败：${message}`, 'error')
    }
  }

  function reset(): void {
    phase.value = 'idle'
  }

  async function openResult(): Promise<void> {
    if (resultPath.value) await revealInFolder(resultPath.value)
  }

  return {
    quality,
    longEdge,
    pattern,
    mode,
    phase,
    done,
    total,
    current,
    errors,
    resultPath,
    progress,
    run,
    reset,
    openResult,
  }
})
