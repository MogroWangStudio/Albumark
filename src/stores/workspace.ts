import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { readExif } from '@/core/exif'
import { fsAvailable, sandboxedFs } from '@/core/fs'
import * as fs from '@/core/fs'
import { appDataDir, executableDir, isTauri, pickDirectory } from '@/core/platform'
import type { ImageItem } from '@/types/image'
import { toast } from './toast'
import { useImagesStore } from './images'
import { useSettingsStore } from './settings'

/** 单张照片的入库方式：复制原文件进项目，或只记录源文件路径 */
export type ImportMode = 'copy' | 'link'

/** 工作目录：收纳工作项目的文件夹。桌面端可指向磁盘任意位置；安卓端在应用数据目录下 */
export interface WorkDirMeta {
  path: string
  name: string
  /** 上次扫描时的工作项目数（未扫描过的目录没有该字段） */
  projects?: number
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

/** workdir.json 的 v2 结构：多工作目录列表 */
interface DirStoreFile {
  version: number
  dirs: WorkDirMeta[]
  current: string | null
}

/** 软件数据根目录下的数据子文件夹名（桌面为绝对位置；安卓相对应用数据目录） */
const DATA_FOLDER = 'AlbumarkData'
/** 工作目录记录文件（存软件数据） */
const DIR_FILE = 'workdir.json'
/** 项目清单文件名（存每个项目文件夹内） */
const MANIFEST = 'albumark.json'

export { fsAvailable, sandboxedFs }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', ab)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

/** 目录名合法化：去掉路径分隔符等文件系统不允许的字符 */
function sanitizeDirName(raw: string): string {
  return raw.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 60)
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const images = useImagesStore()
  const settings = useSettingsStore()

  /** 已记录的全部工作目录 */
  const dirs = ref<WorkDirMeta[]>([])
  /** 当前工作目录（大工作区） */
  const dir = ref<WorkDirMeta | null>(null)
  /** 当前工作目录下的全部工作项目 */
  const projects = ref<ProjectMeta[]>([])
  /** 当前打开的工作项目（小工作区） */
  const current = ref<ProjectMeta | null>(null)
  const manifest = ref<ProjectManifest | null>(null)
  /** 导入模式：复制 / 链接，随导入方式记忆 */
  const importMode = ref<ImportMode>('copy')
  /** 后台装载中 */
  const loading = ref(false)

  const inProject = computed(() => current.value !== null)

  /* ---------- 软件数据目录 ---------- */

  /** 桌面端数据根目录：OOBE 选择的目录，或便携版 exe 所在目录（再兜底系统数据目录）。 */
  async function dataRoot(): Promise<string> {
    let base = settings.dataDir
    if (!base) base = await executableDir()
    if (!base) base = await appDataDir()
    return await fs.joinPath(base, DATA_FOLDER)
  }

  /** OOBE 展示用的默认位置（exe 根目录，仅桌面）。 */
  const defaultDataDir = ref('')
  async function probeDefaultDataDir(): Promise<void> {
    if (!isTauri) return
    defaultDataDir.value = await executableDir()
  }

  /** 记录文件所在根：桌面在数据位置/AlbumarkData 下；安卓在应用数据目录/AlbumarkData 下 */
  async function ensureMetaRoot(): Promise<string> {
    const root = isTauri ? await dataRoot() : DATA_FOLDER
    await fs.mkdir(root)
    return root
  }

  /* ---------- 工作目录记录（workdir.json） ---------- */

  async function persistDir(): Promise<void> {
    if (!fsAvailable) return
    const root = await ensureMetaRoot()
    const payload: DirStoreFile = {
      version: 2,
      dirs: dirs.value,
      current: dir.value?.path ?? null,
    }
    await fs.writeJsonFile(await fs.joinPath(root, DIR_FILE), payload)
  }

  /** 读取目录记录，兼容 v1 的单目录对象格式 */
  async function loadDirStore(): Promise<DirStoreFile> {
    const root = await ensureMetaRoot()
    const raw = (await fs.readJsonFile(await fs.joinPath(root, DIR_FILE))) as Record<
      string,
      unknown
    > | null
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.dirs)) {
        const list = (raw.dirs as WorkDirMeta[]).filter(
          (d) => d && typeof d.path === 'string' && d.path,
        )
        return {
          version: 2,
          dirs: list,
          current: typeof raw.current === 'string' ? raw.current : null,
        }
      }
      if (typeof raw.path === 'string' && raw.path) {
        return {
          version: 2,
          dirs: [{ path: raw.path, name: typeof raw.name === 'string' ? raw.name : fs.baseName(raw.path) }],
          current: raw.path,
        }
      }
    }
    return { version: 2, dirs: [], current: null }
  }

  /** 启动时恢复目录列表与上次使用的目录，并扫描其中的项目。 */
  async function init(): Promise<void> {
    if (!fsAvailable) return
    const store = await loadDirStore()
    dirs.value = store.dirs
    const cur = store.current ? dirs.value.find((d) => d.path === store.current) : undefined
    if (cur) {
      dir.value = cur
      await scanProjects()
      return
    }
    dir.value = null
    projects.value = []
  }

  /** 把一个目录加入列表并激活（已记录则只激活）；扫描其中的辑印项目。 */
  async function adoptDir(path: string): Promise<boolean> {
    try {
      await fs.readDir(path)
    } catch {
      toast('无法读取所选文件夹', 'error')
      return false
    }
    let meta = dirs.value.find((d) => d.path === path)
    if (!meta) {
      meta = { path, name: fs.baseName(path) }
      dirs.value.push(meta)
    }
    dir.value = meta
    await scanProjects()
    return true
  }

  /** 桌面端：选择一个文件夹加入工作目录列表。允许非空——会自动扫描其中的辑印项目。 */
  async function addDir(): Promise<boolean> {
    if (!isTauri) return false
    const picked = await pickDirectory('选择工作目录（可以是已有项目的文件夹）')
    if (!picked) return false
    return await adoptDir(picked)
  }

  /** 安卓沙箱：在应用数据目录下新建（或发现）一个命名工作目录。 */
  async function createDir(rawName: string): Promise<boolean> {
    if (!sandboxedFs) return false
    const clean = sanitizeDirName(rawName)
    if (!clean) {
      toast('请输入有效的目录名称', 'error')
      return false
    }
    const path = await fs.joinPath(DATA_FOLDER, clean)
    if (dirs.value.some((d) => d.path === path)) {
      toast('已有同名工作目录', 'error')
      return false
    }
    await fs.mkdir(await fs.joinPath(path, 'images'))
    const meta: WorkDirMeta = { path, name: clean }
    dirs.value.push(meta)
    dir.value = meta
    await scanProjects()
    return true
  }

  /** 切换到某个已记录的工作目录并扫描其中的项目。 */
  async function useDir(meta: WorkDirMeta): Promise<void> {
    dir.value = meta
    if (current.value) closeProject()
    else await scanProjects()
  }

  /** 移除工作目录记录（不删除磁盘上的文件）。 */
  async function removeDir(meta: WorkDirMeta): Promise<void> {
    dirs.value = dirs.value.filter((d) => d.path !== meta.path)
    if (dir.value?.path === meta.path) {
      dir.value = null
      projects.value = []
      const next = dirs.value[0]
      if (next) await useDir(next)
    }
    await persistDir()
  }

  /** 扫描当前工作目录里的全部项目（含 albumark.json 的子文件夹）。 */
  async function scanProjects(): Promise<void> {
    if (!fsAvailable || !dir.value) {
      projects.value = []
      return
    }
    try {
      projects.value = await scanDirProjects(dir.value.path)
    } catch {
      // 当前目录失联（被移动/删除）：清掉记录，回空态
      projects.value = []
      dir.value = null
      await persistDir()
      return
    }
    dir.value.projects = projects.value.length
    await persistDir()
  }

  /** 扫描一个目录下的有效项目（目录失联时抛错）。 */
  async function scanDirProjects(dirPath: string): Promise<ProjectMeta[]> {
    const out: ProjectMeta[] = []
    for (const e of await fs.readDir(dirPath)) {
      if (!e.isDir || !e.name || e.name.startsWith('.')) continue
      const p = await fs.joinPath(dirPath, e.name)
      const m = (await fs.readJsonFile(await fs.joinPath(p, MANIFEST))) as ProjectManifest | null
      if (!m || !Array.isArray(m.images)) continue
      out.push({
        id: m.id,
        name: m.name || e.name,
        path: p,
        createdAt: m.createdAt || 0,
        count: m.images.length,
      })
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }

  /* ---------- 工作项目 ---------- */

  async function createProject(name: string): Promise<boolean> {
    if (!fsAvailable || !dir.value) return false
    const clean = sanitizeDirName(name) || '未命名项目'
    const p = await fs.joinPath(dir.value.path, clean)
    if (await fs.exists(p)) {
      toast('同名文件夹已存在，换一个名字', 'error')
      return false
    }
    await fs.mkdir(await fs.joinPath(p, 'images'))
    const m: ProjectManifest = { id: uid(), name: clean, createdAt: Date.now(), images: [] }
    await fs.writeJsonFile(await fs.joinPath(p, MANIFEST), m)
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
      if (r.storedAs) {
        try {
          bytes = await fs.readFile(await fs.joinPath(prjPath, 'images', r.storedAs))
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
    if (!fsAvailable || loading.value) return
    loading.value = true
    try {
      const data = (await fs.readJsonFile(await fs.joinPath(meta.path, MANIFEST))) as ProjectManifest | null
      if (!data || !Array.isArray(data.images)) {
        toast('这个文件夹不是有效的辑印项目', 'error')
        return
      }
      const items = await loadRefsToItems(data.images, meta.path)
      images.setItems(items)
      manifest.value = data
      current.value = meta
    } catch (err) {
      // 安卓 / 慢存储上读文件可能偶发失败：给出提示而不是静默失败，让用户能重试
      toast(`打开项目失败：${err instanceof Error ? err.message : '文件读取异常，请重试'}`, 'error')
    } finally {
      loading.value = false
    }
  }

  /** 无文件能力时（浏览器）：本次会话的临时项目（图片仅在内存中）。 */
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

  /** 删除项目：移入回收站（桌面系统回收站 / 安卓应用内 trash 文件夹）。UI 层负责确认。 */
  async function removeProject(meta: ProjectMeta): Promise<void> {
    if (!fsAvailable) return
    if (current.value?.path === meta.path) closeProject()
    try {
      await fs.trashPath(meta.path)
    } catch {
      toast('无法移入回收站，项目保持原样', 'error')
      await scanProjects()
      return
    }
    await scanProjects()
  }

  /* ---------- 图片进出项目 ---------- */

  let saveTimer: number | null = null
  function scheduleSave(): void {
    if (!fsAvailable || !manifest.value || !current.value?.path) return
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(async () => {
      saveTimer = null
      if (!manifest.value || !current.value) return
      await fs.writeJsonFile(await fs.joinPath(current.value.path, MANIFEST), manifest.value)
    }, 400)
  }

  /** 立即写出防抖中的清单：安卓返回退出、切后台前调用，防止窗口期内被杀丢数据 */
  async function flushSave(): Promise<void> {
    if (!saveTimer) return
    window.clearTimeout(saveTimer)
    saveTimer = null
    if (!manifest.value || !current.value?.path) return
    await fs.writeJsonFile(await fs.joinPath(current.value.path, MANIFEST), manifest.value)
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

  /** 项目内新增图片（File 对象；桌面端优先走带绝对路径的 addFromPaths）。 */
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
      if (fsAvailable && prjPath) {
        if (mode === 'link' && path) {
          ref.sourcePath = path
        } else {
          if (mode === 'link' && !path && !toldFallback) {
            toldFallback = true
            toast('拿不到文件的源路径，已改为复制', 'info')
          }
          ref.kind = 'copy'
          ref.storedAs = `${ref.id}.jpg`
          await fs.writeFile(await fs.joinPath(prjPath, 'images', ref.storedAs), bytes)
        }
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
    for (const path of jpgs) {
      try {
        const bytes = await fs.readFile(path)
        const name = fs.baseName(path)
        const code = await sha256Hex(bytes)
        const ref: PrjImageRef = { id: uid(), name, code, kind: mode }
        if (mode === 'link') {
          ref.sourcePath = path
        } else if (current.value.path) {
          ref.storedAs = `${ref.id}.jpg`
          await fs.writeFile(await fs.joinPath(current.value.path, 'images', ref.storedAs), bytes)
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

  /** 从项目移除图片：复制的源文件移入回收站，清单记录删除。 */
  async function removeImage(id: string): Promise<void> {
    images.remove([id])
    if (!manifest.value) return
    const i = manifest.value.images.findIndex((r) => r.id === id)
    if (i < 0) return
    const ref = manifest.value.images[i]
    manifest.value.images.splice(i, 1)
    if (ref.storedAs && current.value?.path && fsAvailable) {
      await fs
        .trashPath(await fs.joinPath(current.value.path, 'images', ref.storedAs))
        .catch(() => undefined)
    }
    scheduleSave()
  }

  /** 重新定位失联的源文件：用识别码校对后再建立链接（仅桌面端）。 */
  async function relink(id: string, newPath: string): Promise<void> {
    if (!manifest.value || !isTauri) return
    const ref = manifest.value.images.find((r) => r.id === id)
    if (!ref) return
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
    dirs,
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
    init,
    addDir,
    createDir,
    useDir,
    removeDir,
    adoptDir,
    scanProjects,
    createProject,
    openProject,
    openEphemeralProject,
    closeProject,
    removeProject,
    addFiles,
    addFromPaths,
    removeImage,
    relink,
    flushSave,
  }
})
