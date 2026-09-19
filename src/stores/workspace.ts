import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { readExif } from '@/core/exif'
import { isTauri } from '@/core/platform'
import type { ImageItem } from '@/types/image'
import { toast } from './toast'
import { useImagesStore } from './images'
import { useSettingsStore } from './settings'

export type WorkspaceMode = 'copy' | 'link'

export interface WorkspaceMeta {
  id: string
  name: string
  /** 工作区文件夹绝对路径；临时工作区为空 */
  path: string
  mode: WorkspaceMode
  lastOpened: number
}

interface WsImageRef {
  id: string
  name: string
  /** 复制模式：工作区 images/ 内的文件名 */
  storedAs?: string
  /** 链接模式：源文件绝对路径 */
  sourcePath?: string
  /** 内容识别码（SHA-256 前 32 位十六进制） */
  code: string
}

interface WorkspaceManifest {
  id: string
  name: string
  mode: WorkspaceMode
  createdAt: number
  images: WsImageRef[]
}

/** 软件数据根目录下的数据子文件夹名 */
const DATA_FOLDER = 'AlbumarkData'
const RECENT_KEY = 'albumark.recent.v1'

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', ab)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

async function readJson(path: string): Promise<unknown | null> {
  const fs = await import('@tauri-apps/plugin-fs')
  try {
    const bytes = await fs.readFile(path)
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

async function writeJson(path: string, data: unknown): Promise<boolean> {
  const fs = await import('@tauri-apps/plugin-fs')
  try {
    await fs.writeFile(path, new TextEncoder().encode(JSON.stringify(data, null, 2)))
    return true
  } catch {
    return false
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const images = useImagesStore()
  const settings = useSettingsStore()

  const current = ref<WorkspaceMeta | null>(null)
  const recent = ref<WorkspaceMeta[]>([])
  const manifest = ref<WorkspaceManifest | null>(null)
  /** 后台装载中 */
  const loading = ref(false)

  const inWorkspace = computed(() => current.value !== null)

  /* ---------- 软件数据目录（桌面端） ---------- */

  /** 数据根目录：OOBE 选择的目录，或便携版 exe 所在目录。 */
  async function dataRoot(): Promise<string> {
    const { join, executableDir } = await import('@tauri-apps/api/path')
    const base = settings.dataDir ? settings.dataDir : await executableDir()
    return await join(base, DATA_FOLDER)
  }

  /** OOBE 展示用的默认位置（exe 根目录）。 */
  const defaultDataDir = ref('')
  async function probeDefaultDataDir(): Promise<void> {
    if (!isTauri) return
    try {
      const { executableDir } = await import('@tauri-apps/api/path')
      defaultDataDir.value = await executableDir()
    } catch {
      defaultDataDir.value = ''
    }
  }

  async function ensureDataRoot(): Promise<string | null> {
    if (!isTauri) return null
    const root = await dataRoot()
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir(root, { recursive: true }).catch(() => undefined)
    return root
  }

  async function loadRecent(): Promise<void> {
    if (!isTauri) return
    const root = await ensureDataRoot()
    if (!root) return
    const { join } = await import('@tauri-apps/api/path')
    const data = await readJson(await join(root, 'workspaces.json'))
    if (Array.isArray(data)) recent.value = data as WorkspaceMeta[]
    else {
      // 旧版本没有 workspaces.json，回退到 localStorage 里的记录
      try {
        const raw = window.localStorage.getItem(RECENT_KEY)
        if (raw) recent.value = JSON.parse(raw) as WorkspaceMeta[]
      } catch {
        /* 忽略 */
      }
    }
  }

  async function persistRecent(): Promise<void> {
    if (!isTauri) return
    const root = await ensureDataRoot()
    if (!root) return
    const { join } = await import('@tauri-apps/api/path')
    await writeJson(await join(root, 'workspaces.json'), recent.value)
  }

  /* ---------- 工作区装载 ---------- */

  async function loadRefsToItems(refs: WsImageRef[], wsPath: string): Promise<ImageItem[]> {
    const out: ImageItem[] = []
    for (const r of refs) {
      const item: ImageItem = {
        id: r.id,
        name: r.name,
        baseName: r.name.replace(/\.[^.]+$/, ''),
        blob: null,
        thumbUrl: '',
        width: 0,
        height: 0,
        code: r.code,
        sourcePath: r.sourcePath,
        storedAs: r.storedAs,
      }
      let bytes: Uint8Array | null = null
      const fs = await import('@tauri-apps/plugin-fs')
      const { join } = await import('@tauri-apps/api/path')
      if (r.storedAs) {
        try {
          bytes = await fs.readFile(await join(wsPath, 'images', r.storedAs))
        } catch {
          bytes = null
        }
      } else if (r.sourcePath) {
        try {
          bytes = await fs.readFile(r.sourcePath)
        } catch {
          bytes = null
        }
      }
      if (bytes) {
        item.blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/jpeg' })
      } else {
        item.missing = true
      }
      out.push(item)
    }
    // 并发补齐尺寸、缩略图与 EXIF
    await Promise.all(out.map((i) => decodeItem(i)))
    return out
  }

  async function decodeItem(item: ImageItem): Promise<void> {
    if (!item.blob) return
    try {
      const bmp = await createImageBitmap(item.blob)
      item.width = bmp.width
      item.height = bmp.height
      bmp.close()
      item.exif = await readExif(item.blob)
      const long = Math.max(item.width, item.height) || 1
      const s = Math.min(1, 240 / long)
      const oc = new OffscreenCanvas(
        Math.max(1, Math.round(item.width * s)),
        Math.max(1, Math.round(item.height * s)),
      )
      const ctx = oc.getContext('2d')
      if (ctx && item.blob) {
        const tb = await createImageBitmap(item.blob)
        ctx.drawImage(tb, 0, 0, oc.width, oc.height)
        tb.close()
        const thumb = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
        item.thumbUrl = URL.createObjectURL(thumb)
      }
    } catch {
      /* 解码失败，保留占位 */
    }
  }

  async function open(path: string): Promise<void> {
    if (!isTauri || loading.value) return
    loading.value = true
    try {
      const { join } = await import('@tauri-apps/api/path')
      const data = (await readJson(await join(path, 'workspace.json'))) as WorkspaceManifest | null
      if (!data || !Array.isArray(data.images)) {
        toast('这个文件夹不是有效的辑印工作区', 'error')
        return
      }
      const items = await loadRefsToItems(data.images, path)
      images.setItems(items)
      manifest.value = data
      const meta: WorkspaceMeta = {
        id: data.id,
        name: data.name,
        path,
        mode: data.mode,
        lastOpened: Date.now(),
      }
      current.value = meta
      recent.value = [meta, ...recent.value.filter((r) => r.path !== path)]
      await persistRecent()
    } finally {
      loading.value = false
    }
  }

  /** 非桌面端：本次会话的临时工作区（图片仅在内存中）。 */
  function openEphemeral(): void {
    current.value = {
      id: uid(),
      name: '临时工作区',
      path: '',
      mode: 'copy',
      lastOpened: Date.now(),
    }
    manifest.value = { id: current.value.id, name: '临时工作区', mode: 'copy', createdAt: Date.now(), images: [] }
    images.setItems([])
  }

  /** 新建工作区：parentDir 为用户选定的父目录。 */
  async function create(name: string, parentDir: string, mode: WorkspaceMode): Promise<boolean> {
    if (!isTauri) return false
    const clean = name.trim() || '未命名工作区'
    const { join } = await import('@tauri-apps/api/path')
    const fs = await import('@tauri-apps/plugin-fs')
    const dir = await join(parentDir, clean)
    if (await fs.exists(dir)) {
      toast('目标文件夹已存在，换一个名字或位置', 'error')
      return false
    }
    await fs.mkdir(dir, { recursive: true })
    await fs.mkdir(await join(dir, 'images'), { recursive: true })
    const manifestData: WorkspaceManifest = {
      id: uid(),
      name: clean,
      mode,
      createdAt: Date.now(),
      images: [],
    }
    await writeJson(await join(dir, 'workspace.json'), manifestData)
    await open(dir)
    return true
  }

  function close(): void {
    current.value = null
    manifest.value = null
    images.clear()
  }

  /* ---------- 图片进出工作区 ---------- */

  let saveTimer: number | null = null
  function scheduleSave(): void {
    if (!isTauri || !manifest.value || !current.value?.path) return
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(async () => {
      if (!manifest.value) return
      const { join } = await import('@tauri-apps/api/path')
      await writeJson(await join(current.value!.path, 'workspace.json'), manifest.value)
    }, 400)
  }

  /** 工作区内新增图片。桌面端 file 可带路径（由对话框/拖入提供）。 */
  async function addFiles(
    files: { file: File; path?: string }[],
  ): Promise<void> {
    if (!current.value) return
    const wsPath = current.value.path
    const mode = current.value.mode
    for (const { file, path } of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const code = await sha256Hex(bytes)
      const ref: WsImageRef = { id: uid(), name: file.name, code }
      if (isTauri && wsPath) {
        if (mode === 'link' && path) {
          ref.sourcePath = path
        } else {
          ref.storedAs = `${ref.id}.jpg`
          const fs = await import('@tauri-apps/plugin-fs')
          const { join } = await import('@tauri-apps/api/path')
          await fs.writeFile(await join(wsPath, 'images', ref.storedAs), bytes)
        }
      } else if (mode === 'link' && path) {
        ref.sourcePath = path
      }
      const item: ImageItem = {
        id: ref.id,
        name: file.name,
        baseName: file.name.replace(/\.[^.]+$/, ''),
        blob: file,
        thumbUrl: '',
        width: 0,
        height: 0,
        code: ref.code,
        sourcePath: ref.sourcePath,
        storedAs: ref.storedAs,
      }
      manifest.value?.images.push(ref)
      images.adopt(item)
      void decodeItem(item).then(() => images.patchItem(item.id, { ...item }))
      scheduleSave()
    }
  }

  /** 桌面端拖入/对话框选择的照片（带绝对路径）。 */
  async function addFromPaths(paths: string[]): Promise<void> {
    if (!current.value || !isTauri) return
    const jpgs = paths.filter((p) => /\.jpe?g$/i.test(p))
    const skipped = paths.length - jpgs.length
    if (skipped > 0) toast(`已跳过 ${skipped} 个非 JPG 文件`)
    const fs = await import('@tauri-apps/plugin-fs')
    for (const path of jpgs) {
      try {
        const bytes = await fs.readFile(path)
        const name = path.split(/[\\/]/).pop() ?? 'photo.jpg'
        const code = await sha256Hex(bytes)
        const ref: WsImageRef = { id: uid(), name, code }
        if (current.value.mode === 'link') {
          ref.sourcePath = path
        } else if (current.value.path) {
          ref.storedAs = `${ref.id}.jpg`
          const { join } = await import('@tauri-apps/api/path')
          await fs.writeFile(await join(current.value.path, 'images', ref.storedAs), bytes)
        }
        const item: ImageItem = {
          id: ref.id,
          name,
          baseName: name.replace(/\.[^.]+$/, ''),
          blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }),
          thumbUrl: '',
          width: 0,
          height: 0,
          code: ref.code,
          sourcePath: ref.sourcePath,
          storedAs: ref.storedAs,
        }
        manifest.value?.images.push(ref)
        images.adopt(item)
        void decodeItem(item).then(() => images.patchItem(item.id, { ...item }))
        scheduleSave()
      } catch {
        toast(`无法读取：${path}`, 'error')
      }
    }
  }

  /** 从工作区移除图片：同时删除复制的文件与清单记录。 */
  async function removeImage(id: string): Promise<void> {
    images.remove([id])
    if (!manifest.value) return
    const i = manifest.value.images.findIndex((r) => r.id === id)
    if (i < 0) return
    const ref = manifest.value.images[i]
    manifest.value.images.splice(i, 1)
    if (ref.storedAs && current.value?.path && isTauri) {
      const fs = await import('@tauri-apps/plugin-fs')
      const { join } = await import('@tauri-apps/api/path')
      await fs.remove(await join(current.value.path, 'images', ref.storedAs)).catch(() => undefined)
    }
    scheduleSave()
  }

  /** 重新定位失联的源文件：用识别码校对后再建立链接。 */
  async function relink(id: string, newPath: string): Promise<void> {
    if (!manifest.value) return
    const ref = manifest.value.images.find((r) => r.id === id)
    if (!ref) return
    const fs = await import('@tauri-apps/plugin-fs')
    try {
      const bytes = await fs.readFile(newPath)
      const code = await sha256Hex(bytes)
      if (code !== ref.code) {
        toast('识别码不符：选择的不是原来的那张图', 'error')
        return
      }
      ref.sourcePath = newPath
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/jpeg' })
      const item: ImageItem = {
        id: ref.id,
        name: ref.name,
        baseName: ref.name.replace(/\.[^.]+$/, ''),
        blob,
        thumbUrl: '',
        width: 0,
        height: 0,
        code: ref.code,
        sourcePath: newPath,
        missing: false,
      }
      await decodeItem(item)
      images.patchItem(id, item)
      scheduleSave()
      toast('已重新链接到源文件', 'success')
    } catch {
      toast('无法读取选择的文件', 'error')
    }
  }

  return {
    current,
    recent,
    manifest,
    loading,
    inWorkspace,
    defaultDataDir,
    probeDefaultDataDir,
    loadRecent,
    open,
    openEphemeral,
    create,
    close,
    addFiles,
    addFromPaths,
    removeImage,
    relink,
  }
})
