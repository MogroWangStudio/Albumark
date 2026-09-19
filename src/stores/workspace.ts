import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { readExif } from '@/core/exif'
import { appDataDir, executableDir, isTauri, pickDirectory } from '@/core/platform'
import type { ImageItem } from '@/types/image'
import { toast } from './toast'
import { useImagesStore } from './images'
import { useSettingsStore } from './settings'

/** 单张照片的入库方式：复制原文件进项目，或只记录源文件路径 */
export type ImportMode = 'copy' | 'link'

/** 工作目录：用户选定的空文件夹，所有工作项目（子文件夹）都放在这里 */
export interface WorkDirMeta {
  path: string
  name: string
}

/** 工作项目：工作目录下的一个子文件夹 */
export interface ProjectMeta {
  id: string
  name: string
  path: string
  createdAt: number
  count: number
}

interface PrjImageRef {
  id: string
  name: string
  /** copy：项目 images/ 内的文件名 */
  storedAs?: string
  /** link：源文件绝对路径 */
  sourcePath?: string
  kind: ImportMode
  /** 内容识别码（SHA-256 前 32 位十六进制） */
  code: string
}

interface ProjectManifest {
  id: string
  name: string
  createdAt: number
  images: PrjImageRef[]
}

/** 软件数据根目录下的数据子文件夹名 */
const DATA_FOLDER = 'AlbumarkData'
/** 工作目录记录文件（存软件数据） */
const DIR_FILE = 'workdir.json'
/** 项目清单文件名（存每个项目文件夹内） */
const MANIFEST = 'albumark.json'

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

  /** 当前工作目录（大工作区） */
  const dir = ref<WorkDirMeta | null>(null)
  /** 工作目录下的全部工作项目 */
  const projects = ref<ProjectMeta[]>([])
  /** 当前打开的工作项目（小工作区） */
  const current = ref<ProjectMeta | null>(null)
  const manifest = ref<ProjectManifest | null>(null)
  /** 导入模式：复制 / 链接，随导入方式记忆 */
  const importMode = ref<ImportMode>('copy')
  /** 后台装载中 */
  const loading = ref(false)

  const inProject = computed(() => current.value !== null)

  /* ---------- 软件数据目录（桌面端） ---------- */

  /** 数据根目录：OOBE 选择的目录，或便携版 exe 所在目录（再兜底系统数据目录）。 */
  async function dataRoot(): Promise<string> {
    const { join } = await import('@tauri-apps/api/path')
    let base = settings.dataDir
    if (!base) base = await executableDir()
    if (!base) base = await appDataDir()
    return await join(base, DATA_FOLDER)
  }

  /** OOBE 展示用的默认位置（exe 根目录）。 */
  const defaultDataDir = ref('')
  async function probeDefaultDataDir(): Promise<void> {
    if (!isTauri) return
    defaultDataDir.value = await executableDir()
  }

  async function ensureDataRoot(): Promise<string | null> {
    if (!isTauri) return null
    const root = await dataRoot()
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir(root, { recursive: true }).catch(() => undefined)
    return root
  }

  /* ---------- 工作目录 ---------- */

  async function persistDir(): Promise<void> {
    const root = await ensureDataRoot()
    if (!root) return
    const { join } = await import('@tauri-apps/api/path')
    await writeJson(await join(root, DIR_FILE), dir.value)
  }

  /** 启动时恢复上次的工作目录并扫描项目；目录失联则回到选择页。 */
  async function init(): Promise<void> {
    if (!isTauri) return
    const root = await ensureDataRoot()
    if (!root) return
    const { join } = await import('@tauri-apps/api/path')
    const saved = (await readJson(await join(root, DIR_FILE))) as WorkDirMeta | null
    if (saved && typeof saved.path === 'string' && saved.path) {
      dir.value = saved
      await scanProjects()
      if (!dir.value) await persistDir()
    }
  }

  /** 选择新的工作目录：必须是空文件夹。成功后写入软件数据并扫描项目。 */
  async function chooseDir(): Promise<boolean> {
    if (!isTauri) return false
    const picked = await pickDirectory('选择工作目录（需要是空文件夹）')
    if (!picked) return false
    const fs = await import('@tauri-apps/plugin-fs')
    try {
      const entries = await fs.readDir(picked)
      const visible = entries.filter((e) => e.name && !e.name.startsWith('.'))
      if (visible.length) {
        toast('所选文件夹不是空的，请选择一个空文件夹', 'error')
        return false
      }
    } catch {
      toast('无法读取所选文件夹', 'error')
      return false
    }
    dir.value = { path: picked, name: picked.split(/[\\/]/).pop() || '工作目录' }
    await persistDir()
    await scanProjects()
    return true
  }

  /** 扫描工作目录里的全部项目（含 albumark.json 的子文件夹）。 */
  async function scanProjects(): Promise<void> {
    if (!isTauri || !dir.value) {
      projects.value = []
      return
    }
    const fs = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const out: ProjectMeta[] = []
    try {
      for (const e of await fs.readDir(dir.value.path)) {
        if (!e.isDirectory || !e.name || e.name.startsWith('.')) continue
        const p = await join(dir.value.path, e.name)
        const m = (await readJson(await join(p, MANIFEST))) as ProjectManifest | null
        if (!m || !Array.isArray(m.images)) continue
        out.push({
          id: m.id,
          name: m.name || e.name,
          path: p,
          createdAt: m.createdAt || 0,
          count: m.images.length,
        })
      }
    } catch {
      // 工作目录已失联（被移动/删除）：清掉记录，回到选择页
      dir.value = null
      projects.value = []
      return
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    projects.value = out
  }

  /* ---------- 工作项目 ---------- */

  async function createProject(name: string): Promise<boolean> {
    if (!isTauri || !dir.value) return false
    const clean = name.trim() || '未命名项目'
    const { join } = await import('@tauri-apps/api/path')
    const fs = await import('@tauri-apps/plugin-fs')
    const p = await join(dir.value.path, clean)
    if (await fs.exists(p)) {
      toast('同名文件夹已存在，换一个名字', 'error')
      return false
    }
    await fs.mkdir(await join(p, 'images'), { recursive: true })
    const m: ProjectManifest = { id: uid(), name: clean, createdAt: Date.now(), images: [] }
    await writeJson(await join(p, MANIFEST), m)
    await scanProjects()
    return true
  }

  async function loadRefsToItems(refs: PrjImageRef[], prjPath: string): Promise<ImageItem[]> {
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
        kind: r.kind,
      }
      let bytes: Uint8Array | null = null
      const fs = await import('@tauri-apps/plugin-fs')
      const { join } = await import('@tauri-apps/api/path')
      if (r.storedAs) {
        try {
          bytes = await fs.readFile(await join(prjPath, 'images', r.storedAs))
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

  async function openProject(meta: ProjectMeta): Promise<void> {
    if (!isTauri || loading.value) return
    loading.value = true
    try {
      const { join } = await import('@tauri-apps/api/path')
      const data = (await readJson(await join(meta.path, MANIFEST))) as ProjectManifest | null
      if (!data || !Array.isArray(data.images)) {
        toast('这个文件夹不是有效的辑印项目', 'error')
        return
      }
      const items = await loadRefsToItems(data.images, meta.path)
      images.setItems(items)
      manifest.value = data
      current.value = meta
    } finally {
      loading.value = false
    }
  }

  /** 非桌面端：本次会话的临时项目（图片仅在内存中）。 */
  function openEphemeralProject(): void {
    const meta: ProjectMeta = {
      id: uid(),
      name: '临时项目',
      path: '',
      createdAt: Date.now(),
      count: 0,
    }
    current.value = meta
    manifest.value = { id: meta.id, name: meta.name, createdAt: meta.createdAt, images: [] }
    images.setItems([])
  }

  function closeProject(): void {
    current.value = null
    manifest.value = null
    images.clear()
    void scanProjects()
  }

  /** 删除项目文件夹（UI 层负责二次确认）。 */
  async function removeProject(meta: ProjectMeta): Promise<void> {
    if (!isTauri) return
    if (current.value?.path === meta.path) closeProject()
    const fs = await import('@tauri-apps/plugin-fs')
    try {
      await fs.remove(meta.path, { recursive: true })
    } catch {
      toast('无法删除项目文件夹', 'error')
    }
    await scanProjects()
  }

  /** 放弃当前工作目录记录，回到选择页（不删除任何文件）。 */
  async function switchDir(): Promise<void> {
    if (current.value) closeProject()
    dir.value = null
    projects.value = []
    await persistDir()
  }

  /* ---------- 图片进出项目 ---------- */

  let saveTimer: number | null = null
  function scheduleSave(): void {
    if (!isTauri || !manifest.value || !current.value?.path) return
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(async () => {
      if (!manifest.value || !current.value) return
      const { join } = await import('@tauri-apps/api/path')
      await writeJson(await join(current.value.path, MANIFEST), manifest.value)
    }, 400)
  }

  function makeItem(ref: PrjImageRef, blob: Blob | null): ImageItem {
    return {
      id: ref.id,
      name: ref.name,
      baseName: ref.name.replace(/\.[^.]+$/, ''),
      blob,
      thumbUrl: '',
      width: 0,
      height: 0,
      code: ref.code,
      sourcePath: ref.sourcePath,
      storedAs: ref.storedAs,
      kind: ref.kind,
    }
  }

  /** 项目内新增图片（浏览器 File；桌面端优先走带绝对路径的 addFromPaths）。 */
  async function addFiles(
    files: { file: File; path?: string }[],
    mode: ImportMode = importMode.value,
  ): Promise<void> {
    if (!current.value) return
    const prjPath = current.value.path
    let toldFallback = false
    for (const { file, path } of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const code = await sha256Hex(bytes)
      const ref: PrjImageRef = { id: uid(), name: file.name, code, kind: mode }
      if (isTauri && prjPath) {
        if (mode === 'link' && path) {
          ref.sourcePath = path
        } else {
          if (mode === 'link' && !path && !toldFallback) {
            toldFallback = true
            toast('浏览器选入的文件拿不到路径，已改为复制', 'info')
          }
          ref.kind = 'copy'
          ref.storedAs = `${ref.id}.jpg`
          const fs = await import('@tauri-apps/plugin-fs')
          const { join } = await import('@tauri-apps/api/path')
          await fs.writeFile(await join(prjPath, 'images', ref.storedAs), bytes)
        }
      } else if (mode === 'link' && path) {
        ref.sourcePath = path
      } else {
        ref.kind = 'copy'
      }
      const item = makeItem(ref, file)
      manifest.value?.images.push(ref)
      images.adopt(item)
      void decodeItem(item).then(() => images.patchItem(item.id, { ...item }))
      scheduleSave()
    }
  }

  /** 桌面端拖入/对话框选择的照片（带绝对路径），复制或链接按 mode 决定。 */
  async function addFromPaths(paths: string[], mode: ImportMode = importMode.value): Promise<void> {
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
        const ref: PrjImageRef = { id: uid(), name, code, kind: mode }
        if (mode === 'link') {
          ref.sourcePath = path
        } else if (current.value.path) {
          ref.storedAs = `${ref.id}.jpg`
          const { join } = await import('@tauri-apps/api/path')
          await fs.writeFile(await join(current.value.path, 'images', ref.storedAs), bytes)
        }
        const item = makeItem(
          ref,
          new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }),
        )
        manifest.value?.images.push(ref)
        images.adopt(item)
        void decodeItem(item).then(() => images.patchItem(item.id, { ...item }))
        scheduleSave()
      } catch {
        toast(`无法读取：${path}`, 'error')
      }
    }
  }

  /** 从项目移除图片：同时删除复制的文件与清单记录。 */
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
        kind: ref.kind,
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
    dir,
    projects,
    current,
    manifest,
    importMode,
    loading,
    inProject,
    defaultDataDir,
    probeDefaultDataDir,
    dataRoot,
    ensureDataRoot,
    init,
    chooseDir,
    scanProjects,
    createProject,
    openProject,
    openEphemeralProject,
    closeProject,
    removeProject,
    switchDir,
    addFiles,
    addFromPaths,
    removeImage,
    relink,
  }
})
