import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { readExif } from '@/core/exif'
import { fetchImageBlob } from '@/core/platform'
import type { ImageItem } from '@/types/image'
import { toast } from './toast'
import { useSettingsStore } from './settings'

function isJpegName(name: string): boolean {
  return /\.jpe?g$/i.test(name)
}

/** 图库缩略图长边（px）：60px 缩略图按 2x DPR 留足余量 */
const THUMB_LONG = 240
/** 导入处理并发数：解码与 EXIF 解析走浏览器线程池，过高反而争抢内存 */
const PARALLEL = 4

/**
 * 解码一次得到尺寸 + 缩略图；EXIF 只读元数据段，代价很小。
 * 返回 patch，由调用方经 patchItem 写回，保证走响应式代理触发更新。
 */
export async function processItem(item: ImageItem): Promise<Partial<ImageItem>> {
  const patch: Partial<ImageItem> = {}
  if (item.blob) {
    try {
      const bmp = await createImageBitmap(item.blob)
      patch.width = bmp.width
      patch.height = bmp.height
      try {
        const long = Math.max(bmp.width, bmp.height) || 1
        const s = Math.min(1, THUMB_LONG / long)
        const tw = Math.max(1, Math.round(bmp.width * s))
        const th = Math.max(1, Math.round(bmp.height * s))
        const oc = new OffscreenCanvas(tw, th)
        const ctx = oc.getContext('2d')
        if (ctx) {
          ctx.drawImage(bmp, 0, 0, tw, th)
          const thumb = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
          patch.thumbUrl = URL.createObjectURL(thumb)
        }
      } finally {
        bmp.close()
      }
    } catch {
      /* 解码失败：保留 0 尺寸与占位底色 */
    }
    patch.exif = await readExif(item.blob)
  }
  return patch
}

export const useImagesStore = defineStore('images', () => {
  const items = ref<ImageItem[]>([])
  const activeId = ref<string | null>(null)
  const selectedIds = ref<Set<string>>(new Set())

  const active = computed(() => items.value.find((i) => i.id === activeId.value) ?? null)
  const count = computed(() => items.value.length)

  function select(id: string, additive = false): void {
    if (additive) {
      const next = new Set(selectedIds.value)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectedIds.value = next
    } else {
      selectedIds.value = new Set([id])
    }
    activeId.value = id
  }

  /** 按方向键顺序切换当前照片（循环），返回是否切换成功。 */
  function step(delta: 1 | -1): boolean {
    const list = items.value
    if (list.length < 2) return false
    const i = list.findIndex((x) => x.id === activeId.value)
    const next = list[(((i < 0 ? 0 : i) + delta) % list.length + list.length) % list.length]
    if (!next) return false
    selectedIds.value = new Set([next.id])
    activeId.value = next.id
    return true
  }

  async function addBlobs(entries: { blob: Blob; name: string }[]): Promise<void> {
    if (!entries.length) return
    const added: ImageItem[] = entries.map(({ blob, name }) => ({
      id: uid(),
      name,
      baseName: name.replace(/\.[^.]+$/, ''),
      blob,
      thumbUrl: '',
      width: 0,
      height: 0,
    }))
    items.value.push(...added)
    if (!activeId.value) activeId.value = added[0].id

    // 并发池处理：先上屏占位，再逐张补齐尺寸、缩略图与 EXIF
    let cursor = 0
    let missingExif = 0
    async function worker(): Promise<void> {
      for (;;) {
        const i = cursor++
        if (i >= added.length) return
        const patch = await processItem(added[i])
        patchItem(added[i].id, patch)
        if (!patch.exif) missingExif++
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, added.length) }, worker))

    if (missingExif > 0 && useSettingsStore().exifNotice) {
      toast(
        missingExif === added.length
          ? '这批照片都没有 EXIF 拍摄信息，相关令牌会留空'
          : `有 ${missingExif} 张照片缺少 EXIF 拍摄信息，相关令牌会留空`,
      )
    }
  }

  async function addFiles(incoming: File[]): Promise<void> {
    const jpegs = incoming.filter((f) => f.type === 'image/jpeg' || isJpegName(f.name))
    const skipped = incoming.length - jpegs.length
    if (skipped > 0) toast(`已跳过 ${skipped} 个非 JPG 文件`)
    if (!jpegs.length) return
    await addBlobs(jpegs.map((f) => ({ blob: f, name: f.name || '照片.jpg' })))
  }

  async function addFromUrl(url: string): Promise<void> {
    const blob = await fetchImageBlob(url)
    const looksJpeg = blob.type === 'image/jpeg' || isJpegName(url)
    if (!looksJpeg) throw new Error('仅支持 JPG 图片链接')
    let name: string
    try {
      name = decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop() ?? '')
    } catch {
      name = ''
    }
    if (!name) name = 'photo'
    if (!isJpegName(name)) name += '.jpg'
    await addBlobs([{ blob, name }])
  }

  function remove(ids: string[]): void {
    const set = new Set(ids)
    const kept = items.value.filter((i) => !set.has(i.id))
    for (const gone of items.value) {
      if (set.has(gone.id) && gone.thumbUrl) URL.revokeObjectURL(gone.thumbUrl)
    }
    items.value = kept
    const nextSel = new Set([...selectedIds.value].filter((id) => !set.has(id)))
    selectedIds.value = nextSel
    if (activeId.value && set.has(activeId.value)) {
      activeId.value = kept.length ? kept[0].id : null
    }
  }

  function clear(): void {
    for (const item of items.value) {
      if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
    }
    items.value = []
    selectedIds.value = new Set()
    activeId.value = null
  }

  /** 工作区装载：整体替换图库内容（清掉旧缩略图 URL）。 */
  function setItems(next: ImageItem[]): void {
    clear()
    items.value = next
    activeId.value = next[0]?.id ?? null
  }

  /** 工作区增量追加已经处理好的图片条目。 */
  function adopt(item: ImageItem): void {
    items.value.push(item)
    if (!activeId.value) activeId.value = item.id
  }

  function patchItem(id: string, patch: Partial<ImageItem>): void {
    const item = items.value.find((i) => i.id === id)
    if (item) Object.assign(item, patch)
  }

  /** 替换缩略图（几何合成结果由调用方生成），并释放旧的对象 URL */
  function setThumb(id: string, blob: Blob): void {
    const item = items.value.find((i) => i.id === id)
    if (!item) return
    const url = URL.createObjectURL(blob)
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
    patchItem(id, { thumbUrl: url })
  }

  return {
    items,
    activeId,
    selectedIds,
    active,
    count,
    select,
    step,
    addFiles,
    addFromUrl,
    remove,
    clear,
    setItems,
    adopt,
    patchItem,
    setThumb,
  }
})
