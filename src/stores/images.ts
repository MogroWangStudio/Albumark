import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { readExif } from '@/core/exif'
import { fetchImageBlob } from '@/core/platform'
import type { ImageItem } from '@/types/image'
import { toast } from './toast'

function isJpegName(name: string): boolean {
  return /\.jpe?g$/i.test(name)
}

async function dimensions(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob)
    const d = { w: bmp.width, h: bmp.height }
    bmp.close()
    return d
  } catch {
    return { w: 0, h: 0 }
  }
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

  async function addBlobs(entries: { blob: Blob; name: string }[]): Promise<void> {
    if (!entries.length) return
    const added: ImageItem[] = entries.map(({ blob, name }) => ({
      id: uid(),
      name,
      baseName: name.replace(/\.[^.]+$/, ''),
      blob,
      url: URL.createObjectURL(blob),
      width: 0,
      height: 0,
    }))
    items.value.push(...added)
    if (!activeId.value) activeId.value = added[0].id
    for (const item of added) {
      const d = await dimensions(item.blob)
      item.width = d.w
      item.height = d.h
      item.exif = await readExif(item.blob)
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
      if (set.has(gone.id)) URL.revokeObjectURL(gone.url)
    }
    items.value = kept
    const nextSel = new Set([...selectedIds.value].filter((id) => !set.has(id)))
    selectedIds.value = nextSel
    if (activeId.value && set.has(activeId.value)) {
      activeId.value = kept.length ? kept[0].id : null
    }
  }

  function clear(): void {
    for (const item of items.value) URL.revokeObjectURL(item.url)
    items.value = []
    selectedIds.value = new Set()
    activeId.value = null
  }

  return { items, activeId, selectedIds, active, count, select, addFiles, addFromUrl, remove, clear }
})
