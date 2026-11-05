import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { buildZip, estimateExportBytes, runExport } from '@/core/exporter'
import { writeFilesToPublicFolder, writeFilesToShareCache } from '@/core/fs'
import { isCapacitor, isTauri, pickDirectory, revealInFolder, saveZip, shareFiles, writeFilesToDir } from '@/core/platform'
import type { Crop } from '@/types/adjust'
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
  const format = ref<'jpg' | 'png'>('jpg')
  const mode = ref<'zip' | 'folder' | 'share'>('zip')
  /** JPG 导出保留源照片 EXIF（方向、尺寸已按导出结果校正；缩略图不带出） */
  const keepExif = ref(true)
  /** 导出范围：all = 项目全部照片；picked = 手动勾选的子集 */
  const scope = ref<'all' | 'picked'>('all')
  /** 自选勾选的照片 id（scope = picked 时生效；会话级状态，不持久化） */
  const picked = ref<Set<string>>(new Set())

  /** 勾选/取消一张照片 */
  function togglePick(id: string): void {
    const next = new Set(picked.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    picked.value = next
  }

  /** 切到自选时的默认：先全选，用户再取消不要的，比从零勾选省力 */
  function pickAll(): void {
    picked.value = new Set(images.items.map((i) => i.id))
  }

  const pickedCount = computed(() => picked.value.size)

  const phase = ref<'idle' | 'running' | 'done'>('idle')
  const done = ref(0)
  const total = ref(0)
  const current = ref('')
  const errors = ref<string[]>([])
  const resultPath = ref<string | null>(null)
  /** 分享模式导出结果的 file:// URI，完成后可再次调起分享面板 */
  const shareUris = ref<string[]>([])

  const progress = computed(() => (total.value ? done.value / total.value : 0))

  /** 按当前设置组装导出载荷（真实导出与大小估算共用同一份配置） */
  async function buildPayload() {
    // 素材按「全局 + 各照片独立水印」引用的并集收集
    const perImageLayers = wm.perImageSnapshot()
    const layers = wm.plainLayers()
    const allLayers = [...layers, ...Object.values(perImageLayers).flat()]
    const assets = await wm.assetPayloads(allLayers)
    // 裁剪对象来自响应式存储，传 Worker 前拍平为纯数据
    const crops: Record<string, Crop> = {}
    for (const [id, c] of Object.entries(adjust.crops)) crops[id] = { ...c }
    return {
      layers,
      adjustments: adjust.snapshotFor(null),
      perImage: adjust.perImageSnapshot(),
      crops,
      perImageLayers,
      assets,
      quality: quality.value,
      longEdge: longEdge.value,
      pattern: pattern.value,
      format: format.value,
      keepExif: keepExif.value,
    }
  }

  /** 范围内的照片列表（自选时按勾选过滤） */
  function scopedItems() {
    return scope.value === 'picked' ? images.items.filter((i) => picked.value.has(i.id)) : images.items
  }

  /* ---------- 大小预估：抽样实算 + 压缩率外推 ---------- */

  const estimate = ref<number | null>(null)
  const estimating = ref(false)
  let estimateSeq = 0

  async function refreshEstimate(): Promise<void> {
    const seq = ++estimateSeq
    const list = scopedItems()
    if (!list.length || !list.some((i) => i.blob)) {
      estimate.value = null
      estimating.value = false
      return
    }
    estimating.value = true
    try {
      const est = await estimateExportBytes(list, await buildPayload())
      if (seq === estimateSeq) estimate.value = est
    } catch {
      if (seq === estimateSeq) estimate.value = null
    } finally {
      if (seq === estimateSeq) estimating.value = false
    }
  }

  async function run(): Promise<void> {
    if (phase.value === 'running' || !images.items.length) return
    errors.value = []
    resultPath.value = null
    shareUris.value = []

    // 自选范围：只导出勾选的照片（空选在面板上已禁用，这里防御兜底）
    const list = scopedItems()
    if (!list.length) {
      toast('没有选择要导出的照片', 'error')
      return
    }

    // 分享与文件夹逐张写入都是原生能力，浏览器不支持
    if (mode.value !== 'zip' && !isTauri && !isCapacitor) {
      toast('浏览器版本仅支持导出 ZIP，已自动切换', 'error')
      mode.value = 'zip'
    }

    // 桌面自选目录；安卓无目录选择器，逐张写入公共 Documents 的 Albumark/<时间戳>/
    let dir: string | null = null
    let sub = ''
    if (mode.value === 'folder') {
      if (isTauri) {
        dir = await pickDirectory()
        if (!dir) return
      } else {
        const now = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        sub = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
      }
    }

    phase.value = 'running'
    total.value = list.length
    done.value = 0
    current.value = ''

    try {
      const outputs = await runExport(
        list,
        await buildPayload(),
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

      if (mode.value === 'share') {
        // 安卓分享：写入应用缓存（不留公共目录副本），导出完成即调起系统分享面板
        const list = [...outputs.entries()].map(([name, bytes]) => ({ name, bytes }))
        shareUris.value = await writeFilesToShareCache(list)
        try {
          await shareFiles(shareUris.value)
        } catch {
          /* 面板被取消或调起失败：照片已导出，可从完成界面再次分享 */
        }
      } else if (mode.value === 'folder') {
        const list = [...outputs.entries()].map(([name, bytes]) => ({ name, bytes }))
        if (isTauri && dir) {
          await writeFilesToDir(dir, list)
          resultPath.value = dir
        } else {
          // 安卓：逐张写入公共 Documents/Albumark/<时间戳>/
          resultPath.value = await writeFilesToPublicFolder(sub, list)
        }
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
    shareUris.value = []
  }

  /** 完成界面再次调起分享面板（照片仍在应用缓存，无需重新导出） */
  async function reshare(): Promise<void> {
    if (!shareUris.value.length) return
    try {
      await shareFiles(shareUris.value)
    } catch {
      toast('分享失败，请重试', 'error')
    }
  }

  async function openResult(): Promise<void> {
    if (resultPath.value) await revealInFolder(resultPath.value)
  }

  return {
    quality,
    longEdge,
    pattern,
    format,
    mode,
    keepExif,
    scope,
    picked,
    pickedCount,
    togglePick,
    pickAll,
    estimate,
    estimating,
    refreshEstimate,
    phase,
    done,
    total,
    current,
    errors,
    resultPath,
    shareUris,
    progress,
    run,
    reset,
    reshare,
    openResult,
  }
})
