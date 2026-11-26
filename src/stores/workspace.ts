import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { uid } from '@/core/id'
import { fsAvailable, sandboxedFs } from '@/core/fs'
import * as fs from '@/core/fs'
import { probeZipBatch, probeZipManifest, unzipTo } from '@/core/archive'
import { appDataDir, executableDir, isTauri, pickDirectory } from '@/core/platform'
import { createDebouncedSaver } from '@/core/storage'
import {
  imageExt,
  imageMime,
  isImportableImage,
  resolveImageFormat,
} from '@/core/imageFormat'
import { t } from '@/i18n'
import type { ImageItem } from '@/types/image'
import { toast } from './toast'
import { processItem, useImagesStore } from './images'
import { useSettingsStore } from './settings'

/** 单张照片的入库方式：复制原文件进项目，或只记录源文件路径 */
export type ImportMode = 'copy' | 'link'

/** 工作目录：收纳工作项目的文件夹。桌面端可指向磁盘任意位置；安卓端在应用数据目录下 */
export interface WorkDirMeta {
  path: string
  name: string
  /** 上次扫描时的工作项目数（未扫描过的目录没有该字段） */
  projects?: number
  /** 目录的自定义 emoji 图标（空/未设置时用默认文件夹图形） */
  emoji?: string
}

/** 工作项目：工作目录下的一个子文件夹 */
export interface ProjectMeta {
  id: string
  name: string
  path: string
  createdAt: number
  count: number
  /** 项目的自定义 emoji 图标（存 albumark.json，随项目导出/导入） */
  emoji?: string
  /** 项目简介（存 albumark.json，编辑信息对话框编辑） */
  description?: string
  /** 扫描时带出的首张照片引用（缩略图卡片用，不写盘） */
  coverStoredAs?: string
  coverSourcePath?: string
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

/** 失联照片的文件夹匹配候选：确认窗口里逐条展示并让用户勾选 */
export interface RelinkCandidate {
  id: string
  /** 失联照片的原文件名（匹配依据） */
  name: string
  /** 文件夹里同名文件的路径；null = 没找到同名文件 */
  path: string | null
  /** 同名文件的内容识别码是否与原照片一致 */
  codeOk: boolean
}

interface ProjectManifest {
  id: string
  name: string
  createdAt: number
  images: PrjImageRef[]
  /** 自定义 emoji 图标（可选，旧清单没有该字段） */
  emoji?: string
  /** 项目简介（可选，编辑信息对话框编辑） */
  description?: string
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

  /* ---------- 工作区体积与缩略图 ----------
     体积扫描与首图缩略图都不阻塞项目扫描：工作区页面打开后按需异步补齐，
     开关关闭时直接清空且不再碰磁盘。 */
  const projectSizes = ref<Record<string, number | null>>({})
  const dirSizes = ref<Record<string, number | null>>({})
  const projectThumbs = ref<Record<string, string>>({})
  let statsSeq = 0
  const projectSizeStamp = new Map<string, string>()
  const dirSizeStamp = new Map<string, string>()
  const thumbStamp = new Map<string, string>()
  const thumbUrls = new Map<string, string>()

  function projectStamp(p: ProjectMeta): string {
    return `${p.path}|${p.count}|${p.coverStoredAs ?? p.coverSourcePath ?? ''}`
  }

  function setProjectSize(id: string, bytes: number): void {
    projectSizes.value = { ...projectSizes.value, [id]: bytes }
  }

  function setDirSize(path: string, bytes: number): void {
    dirSizes.value = { ...dirSizes.value, [path]: bytes }
  }

  function setProjectThumb(id: string, url: string): void {
    const old = thumbUrls.get(id)
    if (old && old !== url) URL.revokeObjectURL(old)
    thumbUrls.set(id, url)
    projectThumbs.value = { ...projectThumbs.value, [id]: url }
  }

  function dropProjectThumb(id: string): void {
    const old = thumbUrls.get(id)
    if (old) URL.revokeObjectURL(old)
    thumbUrls.delete(id)
    const next = { ...projectThumbs.value }
    delete next[id]
    projectThumbs.value = next
  }

  /** 首图缩略图：读首张照片，解码时直接缩到 480px 宽生成对象 URL（缩略图卡片背景用） */
  async function makeThumb(p: ProjectMeta): Promise<string | null> {
    const path = p.coverStoredAs
      ? await fs.joinPath(p.path, 'images', p.coverStoredAs)
      : p.coverSourcePath
    if (!path) return null
    const bytes = await fs.readFile(path)
    const format = resolveImageFormat(bytes, p.coverStoredAs ?? p.coverSourcePath ?? '')
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: imageMime(format ?? 'jpg') })
    // 解码即降采样：安卓上 50MP 首图整图解码要数秒、上百 MB，
    // 只给卡片背景用不值得
    const bmp = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: 480,
      resizeQuality: 'high',
    })
    try {
      const oc = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = oc.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bmp, 0, 0)
      const out = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
      return URL.createObjectURL(out)
    } finally {
      bmp.close()
    }
  }

  /**
   * 刷新工作区统计：当前目录各项目体积、全部工作目录体积、缩略图卡片首图。
   * 同一时间只认最后一次调用；已按「路径 + 数量 + 首图」缓存的结果不重复扫。
   */
  async function refreshStats(force = false): Promise<void> {
    if (!fsAvailable) return
    const seq = ++statsSeq
    const showSizes = settings.showFileSizes
    const wantThumb = settings.projectCardStyle === 'thumbnail'
    const ids = new Set(projects.value.map((p) => p.id))
    let cursor = 0
    // 清掉已不存在的项目记录
    for (const id of Object.keys(projectSizes.value)) {
      if (!ids.has(id)) {
        delete projectSizes.value[id]
        projectSizeStamp.delete(id)
        thumbStamp.delete(id)
      }
    }
    for (const [id] of thumbUrls) {
      if (!ids.has(id)) dropProjectThumb(id)
    }
    // 目录改名 / 移除后，旧路径的统计记录没有归属，一并清掉
    const dirPaths = new Set(dirs.value.map((d) => d.path))
    for (const path of Object.keys(dirSizes.value)) {
      if (!dirPaths.has(path)) {
        delete dirSizes.value[path]
        dirSizeStamp.delete(path)
      }
    }
    if (!showSizes) {
      projectSizes.value = {}
      dirSizes.value = {}
      projectSizeStamp.clear()
      dirSizeStamp.clear()
    } else {
      // 项目体积：并发 3，逐个补齐
      const pool = projects.value.filter(
        (p) => force || projectSizeStamp.get(p.id) !== projectStamp(p) || !(p.id in projectSizes.value),
      )
      for (const p of projects.value) {
        if (!(p.id in projectSizes.value)) projectSizes.value[p.id] = null
      }
      cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < pool.length) {
          const p = pool[cursor++]
          try {
            const r = await fs.dirSize(p.path)
            if (seq !== statsSeq) return
            setProjectSize(p.id, r.bytes)
            projectSizeStamp.set(p.id, projectStamp(p))
          } catch {
            if (seq !== statsSeq) return
            setProjectSize(p.id, 0)
          }
        }
      }
      await Promise.all([worker(), worker(), worker()])
      if (seq !== statsSeq) return
      // 工作目录体积：全部目录并发 2（当前目录的项目已在上一步热缓存，仍是整树统计）
      const dPool = dirs.value.filter((d) => {
        const stamp = `${d.path}|${d.projects ?? 0}`
        return force || dirSizeStamp.get(d.path) !== stamp || !(d.path in dirSizes.value)
      })
      for (const d of dirs.value) {
        if (!(d.path in dirSizes.value)) dirSizes.value[d.path] = null
      }
      cursor = 0
      const dWorker = async (): Promise<void> => {
        while (cursor < dPool.length) {
          const d = dPool[cursor++]
          try {
            const r = await fs.dirSize(d.path)
            if (seq !== statsSeq) return
            setDirSize(d.path, r.bytes)
            dirSizeStamp.set(d.path, `${d.path}|${d.projects ?? 0}`)
          } catch {
            if (seq !== statsSeq) return
            setDirSize(d.path, 0)
          }
        }
      }
      await Promise.all([dWorker(), dWorker()])
    }
    if (seq !== statsSeq || !wantThumb) return
    // 首图缩略图：并发 2，结果按「路径 + 数量 + 首图」缓存
    const tPool = projects.value.filter(
      (p) => force || thumbStamp.get(p.id) !== projectStamp(p) || !thumbUrls.has(p.id),
    )
    cursor = 0
    const tWorker = async (): Promise<void> => {
      while (cursor < tPool.length) {
        const p = tPool[cursor++]
        try {
          const url = await makeThumb(p)
          if (seq !== statsSeq) {
            if (url) URL.revokeObjectURL(url)
            return
          }
          if (url) {
            setProjectThumb(p.id, url)
            thumbStamp.set(p.id, projectStamp(p))
          }
        } catch {
          /* 首图不可读（失联链接）：卡片回落到纯色底 */
        }
      }
    }
    await Promise.all([tWorker(), tWorker()])
  }

  const inProject = computed(() => current.value !== null)

  /** 工作区的两级页面：工作目录列表页 / 工作项目列表页。安卓返回键按此逐级回退，
   *  项目页是最后一级——再返回即进入「两次返回退出」流程（见 App 的返回链） */
  const subPage = ref<'dirs' | 'projects'>('dirs')
  function gotoSubPage(p: 'dirs' | 'projects'): void {
    subPage.value = p
  }

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
      // 上次使用过目录：直接落在工作项目页（常用路径优先，返回可看目录页）
      subPage.value = 'projects'
      await scanProjects()
      return
    }
    dir.value = null
    projects.value = []
  }

  /** 把一个目录加入列表并激活（已记录则只激活）；扫描其中的 Albumark 项目。 */
  async function adoptDir(path: string): Promise<boolean> {
    try {
      await fs.readDir(path)
    } catch {
      toast(t('无法读取所选文件夹'), 'error')
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

  /** 桌面端：选择一个文件夹加入工作目录列表。允许非空——会自动扫描其中的 Albumark 项目。 */
  async function addDir(): Promise<boolean> {
    if (!isTauri) return false
    const picked = await pickDirectory(t('选择工作目录（可以是已有项目的文件夹）'))
    if (!picked) return false
    return await adoptDir(picked)
  }

  /** 安卓沙箱：在应用数据目录下新建（或发现）一个命名工作目录。 */
  async function createDir(rawName: string): Promise<boolean> {
    if (!sandboxedFs) return false
    const clean = sanitizeDirName(rawName)
    if (!clean) {
      toast(t('请输入有效的目录名称'), 'error')
      return false
    }
    const path = await fs.joinPath(DATA_FOLDER, clean)
    if (dirs.value.some((d) => d.path === path)) {
      toast(t('已有同名工作目录'), 'error')
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
    if (current.value) await closeProject()
    else await scanProjects()
    // 打开着项目时走的是 closeProject，不会经过 scanProjects 的落盘分支；
    // 这里补一次，保证「上次使用的目录」真的被记住——否则重启会退回上一个目录，
    // 连带着看上去像是水印串了目录
    await persistDir()
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
      const first = m.images.find((r) => r && (r.storedAs || r.sourcePath))
      out.push({
        id: m.id,
        name: m.name || e.name,
        path: p,
        createdAt: m.createdAt || 0,
        count: m.images.length,
        emoji: m.emoji,
        description: m.description,
        coverStoredAs: first?.storedAs,
        coverSourcePath: first?.sourcePath,
      })
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }

  /* ---------- 重命名（磁盘文件夹改名 + 记录重新引导） ---------- */

  /**
   * 重命名工作项目：文件夹改名，清单内的名称同步更新。项目 id 在
   * albumark.json 内、与文件夹名无关——水印等按 id 记录的数据不随
   * 改名丢失；显示名优先取 manifest.name，因此两者都要改。
   */
  async function renameProject(meta: ProjectMeta, raw: string): Promise<boolean> {
    const clean = sanitizeDirName(raw)
    if (!fsAvailable || !clean || clean === meta.name) return false
    const nextPath = await fs.joinPath(fs.parentPath(meta.path), clean)
    if (await fs.exists(nextPath)) {
      toast(t('同名文件夹已存在，换一个名字'), 'error')
      return false
    }
    try {
      await fs.renamePath(meta.path, nextPath)
    } catch {
      toast(t('重命名失败，文件夹可能正被占用'), 'error')
      return false
    }
    // 清单的 name 写在新路径上：失败不致命（显示回落为文件夹名）
    const m = (await fs.readJsonFile(await fs.joinPath(nextPath, MANIFEST))) as ProjectManifest | null
    if (m) {
      m.name = clean
      await fs.writeJsonFile(await fs.joinPath(nextPath, MANIFEST), m)
    }
    await scanProjects()
    return true
  }

  /**
   * 重命名工作目录：磁盘改名 + workdir.json 记录同步——启动按 path
   * 精确匹配恢复目录，不同步更新记录会让目录在重启后失联。
   */
  async function renameDir(meta: WorkDirMeta, raw: string): Promise<boolean> {
    const clean = sanitizeDirName(raw)
    if (!fsAvailable || !clean || clean === meta.name) return false
    const nextPath = await fs.joinPath(fs.parentPath(meta.path), clean)
    if (await fs.exists(nextPath)) {
      toast(t('同名文件夹已存在，换一个名字'), 'error')
      return false
    }
    try {
      await fs.renamePath(meta.path, nextPath)
    } catch {
      toast(t('重命名失败，文件夹可能正被占用'), 'error')
      return false
    }
    dirs.value = dirs.value.map((d) =>
      d.path === meta.path ? { ...d, path: nextPath, name: clean } : d,
    )
    if (dir.value?.path === meta.path) {
      dir.value = { ...dir.value, path: nextPath, name: clean }
      // 当前目录下的项目 path 全部随目录变化：重扫拿新路径
      await scanProjects()
    } else {
      await persistDir()
    }
    return true
  }

  /** 规范 emoji 字段：空串/非字符串视为未设置（写 undefined，不落脏数据） */
  function cleanEmoji(raw: string): string | undefined {
    const v = typeof raw === 'string' ? raw.trim() : ''
    return v ? v : undefined
  }

  /**
   * 编辑信息：名字 / 简介 / emoji 一次写入。名字变化才走磁盘改名（复用
   * renameProject 的唯一名与占用检查），简介与 emoji 写进同一份清单——
   * 只读写一次 manifest，避免多次落盘。
   */
  async function updateProjectInfo(
    meta: ProjectMeta,
    patch: { name?: string; description?: string; emoji?: string },
  ): Promise<boolean> {
    if (!fsAvailable) return false
    const clean = sanitizeDirName(patch.name ?? meta.name)
    if (!clean) return false
    const nameChanged = clean !== meta.name
    if (nameChanged) {
      const nextPath = await fs.joinPath(fs.parentPath(meta.path), clean)
      if (await fs.exists(nextPath)) {
        toast(t('同名文件夹已存在，换一个名字'), 'error')
        return false
      }
      try {
        await fs.renamePath(meta.path, nextPath)
      } catch {
        toast(t('重命名失败，文件夹可能正被占用'), 'error')
        return false
      }
      meta.path = nextPath
      meta.name = clean
    }
    const m = (await fs.readJsonFile(await fs.joinPath(meta.path, MANIFEST))) as ProjectManifest | null
    if (m) {
      m.name = clean
      const desc = patch.description?.trim()
      if (desc) m.description = desc
      else delete m.description
      const emo = patch.emoji?.trim()
      if (emo) m.emoji = emo
      else delete m.emoji
      await fs.writeJsonFile(await fs.joinPath(meta.path, MANIFEST), m)
    }
    await scanProjects()
    return true
  }

  /** 设置项目的 emoji 图标：写入项目清单（随项目导出/导入），随扫描刷新列表 */
  async function setProjectEmoji(meta: ProjectMeta, emoji: string): Promise<boolean> {
    if (!fsAvailable) return false
    const m = (await fs.readJsonFile(await fs.joinPath(meta.path, MANIFEST))) as ProjectManifest | null
    if (!m) {
      toast(t('读取项目清单失败，无法设置图标'), 'error')
      return false
    }
    const v = cleanEmoji(emoji)
    if (v) m.emoji = v
    else delete m.emoji
    await fs.writeJsonFile(await fs.joinPath(meta.path, MANIFEST), m)
    await scanProjects()
    return true
  }

  /** 设置目录的 emoji 图标：写进 workdir.json 的目录记录 */
  async function setDirEmoji(meta: WorkDirMeta, emoji: string): Promise<boolean> {
    if (!fsAvailable) return false
    const v = cleanEmoji(emoji)
    dirs.value = dirs.value.map((d) => {
      if (d.path !== meta.path) return d
      const next = { ...d }
      if (v) next.emoji = v
      else delete next.emoji
      return next
    })
    if (dir.value?.path === meta.path) {
      const next = { ...dir.value }
      if (v) next.emoji = v
      else delete next.emoji
      dir.value = next
    }
    await persistDir()
    return true
  }

  async function createProject(name: string): Promise<boolean> {
    if (!fsAvailable || !dir.value) return false
    const clean = sanitizeDirName(name) || '未命名项目'
    const p = await fs.joinPath(dir.value.path, clean)
    if (await fs.exists(p)) {
      toast(t('同名文件夹已存在，换一个名字'), 'error')
      return false
    }
    await fs.mkdir(await fs.joinPath(p, 'images'))
    const m: ProjectManifest = { id: uid(), name: clean, createdAt: Date.now(), images: [] }
    await fs.writeJsonFile(await fs.joinPath(p, MANIFEST), m)
    await scanProjects()
    return true
  }

  /* ---------- 导入工作项目（与导出对称：ZIP / 文件夹 → 当前工作目录） ---------- */

  /** 当前目录内唯一的项目文件夹名：重名自动追加 (2) / (3)… */
  async function uniqueProjectDir(display: string): Promise<string> {
    const base = sanitizeDirName(display) || '导入的项目'
    let name = base
    for (let i = 2; dir.value && (await fs.exists(await fs.joinPath(dir.value.path, name))); i++) {
      name = `${base} (${i})`
    }
    return name
  }

  /** 扫描结果里找刚导入的项目（按磁盘路径），找不到就按清单拼一个元信息 */
  async function findImported(dest: string, m: ProjectManifest, dirName: string): Promise<ProjectMeta> {
    const hit = projects.value.find((p) => p.path === dest)
    if (hit) return hit
    const first = m.images.find((r) => r && (r.storedAs || r.sourcePath))
    return {
      id: m.id,
      name: m.name || dirName,
      path: dest,
      createdAt: m.createdAt || 0,
      count: m.images.length,
      emoji: m.emoji,
      description: m.description,
      coverStoredAs: first?.storedAs,
      coverSourcePath: first?.sourcePath,
    }
  }

  /**
   * 导入 ZIP 工作项目：探测清单（兼容「解压软件加壳」的单层包裹）→
   * 流式解压到当前工作目录（峰值内存 ≈ 单个文件，安卓同样可用）→
   * 项目 id 重新生成（同一项目多次导入互不干扰），名称与创建时间保留。
   */
  async function importProjectZip(
    file: Blob,
    fallbackName: string,
    onProgress?: (done: number, name: string) => void,
  ): Promise<ProjectMeta> {
    if (!fsAvailable || !dir.value) throw new Error(t('尚未打开工作目录'))
    const probe = await probeZipManifest(file)
    if (!probe) throw new Error(t('ZIP 里没有找到工作项目（缺少 albumark.json 清单）'))
    let manifest: ProjectManifest
    try {
      manifest = JSON.parse(new TextDecoder().decode(probe.bytes)) as ProjectManifest
    } catch {
      throw new Error(t('项目清单格式不正确'))
    }
    if (!manifest || !Array.isArray(manifest.images)) throw new Error(t('项目清单格式不正确'))
    manifest.id = uid()
    const dirName = await uniqueProjectDir(manifest.name || fallbackName)
    const dest = await fs.joinPath(dir.value.path, dirName)
    const written = await unzipTo(file, dest, {
      prefix: probe.prefix,
      manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
      onProgress,
    })
    if (written === 0) throw new Error(t('ZIP 里没有可导入的文件'))
    await scanProjects()
    return await findImported(dest, manifest, dirName)
  }

  /**
   * 导入 ZIP(单项目 / 批量归档自动识别):先按单项目结构探测,失败则按
   * 批量结构(顶层多个项目文件夹,来自批量导出)逐个导入——每项目重生成
   * id,重名自动加序号,返回全部导入结果。
   */
  async function importProjectsZip(
    file: Blob,
    fallbackName: string,
    onProgress?: (done: number, name: string) => void,
  ): Promise<ProjectMeta[]> {
    if (!fsAvailable || !dir.value) throw new Error(t('尚未打开工作目录'))
    try {
      return [await importProjectZip(file, fallbackName, onProgress)]
    } catch (singleErr) {
      // 单项目结构不成立:按批量归档再试一次
      const batch = await probeZipBatch(file)
      if (!batch.length) throw singleErr
      const out: ProjectMeta[] = []
      for (let i = 0; i < batch.length; i++) {
        const probe = batch[i]
        let manifest: ProjectManifest
        try {
          manifest = JSON.parse(new TextDecoder().decode(probe.bytes)) as ProjectManifest
        } catch {
          continue
        }
        if (!manifest || !Array.isArray(manifest.images)) continue
        manifest.id = uid()
        const dirName = await uniqueProjectDir(manifest.name || `${fallbackName}-${i + 1}`)
        const dest = await fs.joinPath(dir.value.path, dirName)
        await unzipTo(file, dest, {
          prefix: probe.prefix,
          manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
          onProgress,
        })
        out.push(await findImported(dest, manifest, dirName))
      }
      if (!out.length) throw new Error(t('ZIP 里的项目清单都格式不正确'))
      await scanProjects()
      return out
    }
  }

  /** 导入文件夹工作项目（桌面）：校验清单 → 原样复制 → id 重新生成。 */
  async function importProjectFolder(srcDir: string): Promise<ProjectMeta> {
    if (!fsAvailable || !dir.value) throw new Error(t('尚未打开工作目录'))
    const raw = (await fs.readJsonFile(await fs.joinPath(srcDir, MANIFEST))) as ProjectManifest | null
    if (!raw || !Array.isArray(raw.images)) {
      throw new Error(t('所选文件夹不是工作项目（缺少 albumark.json 清单）'))
    }
    const manifest: ProjectManifest = { ...raw, id: uid() }
    const dirName = await uniqueProjectDir(manifest.name || fs.baseName(srcDir))
    const dest = await fs.joinPath(dir.value.path, dirName)
    await fs.copyDir(srcDir, dest)
    await fs.writeJsonFile(await fs.joinPath(dest, MANIFEST), manifest)
    await scanProjects()
    return await findImported(dest, manifest, dirName)
  }

  /** 读取单个图片文件，解码出尺寸、缩略图与 EXIF，返回可直接 patchItem 的增量 */
  async function hydrateOne(
    r: Pick<PrjImageRef, 'storedAs' | 'sourcePath'>,
    prjPath: string,
  ): Promise<Partial<ImageItem>> {
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
    if (!bytes) return { missing: true }
    // MIME 按字节识别：PNG 若被标成 image/jpeg，缩略图编码会把透明区拍平
    const format = resolveImageFormat(bytes, r.storedAs ?? r.sourcePath ?? '')
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: imageMime(format ?? 'jpg'),
    })
    // processItem 只读 blob：不需要完整条目
    const patch = await processItem({
      id: '',
      name: '',
      baseName: '',
      blob,
      thumbUrl: '',
      width: 0,
      height: 0,
    })
    return { ...patch, blob, missing: false }
  }

  /**
   * 后台渐进补齐图片数据：首张（进入后的当前照片）优先，让编辑页立刻可看；
   * 其余按受限并发处理（安卓慢存储上并发过高反而更慢）。
   * 切换项目后旧任务作废，不再写 store。
   */
  async function hydrateItems(refs: PrjImageRef[], prjPath: string): Promise<void> {
    const seq = ++hydrateSeq
    const rest = refs.slice(1)
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < rest.length) {
        const r = rest[cursor++]
        // 单张失败不中断队列：保留占位（与旧 decodeItem 的静默兜底一致）
        const patch = await hydrateOne(r, prjPath).catch(() => ({ missing: true }))
        if (seq !== hydrateSeq) return
        images.patchItem(r.id, patch)
      }
    }
    if (refs.length) {
      const first = await hydrateOne(refs[0], prjPath).catch(() => ({ missing: true }))
      if (seq !== hydrateSeq) return
      images.patchItem(refs[0].id, first)
    }
    await Promise.all(Array.from({ length: Math.min(3, rest.length) }, worker))
  }

  /* 切到尚未装载的照片时按需读取原文件：后台渐进补齐还没轮到它时，
     预览不必等整批队列，读这一张就能先渲染 */
  const loadingIds = new Set<string>()
  async function ensureImageLoaded(id: string | null | undefined): Promise<void> {
    if (!id || !current.value?.path) return
    const item = images.items.find((i) => i.id === id)
    if (!item || item.blob || item.missing || loadingIds.has(id)) return
    loadingIds.add(id)
    try {
      const patch = await hydrateOne(item, current.value.path).catch(() => ({ missing: true }))
      if (!images.items.some((i) => i.id === id)) return
      images.patchItem(id, patch)
    } finally {
      loadingIds.delete(id)
    }
  }

  async function openProject(meta: ProjectMeta): Promise<void> {
    if (!fsAvailable || loading.value) return
    loading.value = true
    try {
      const data = (await fs.readJsonFile(await fs.joinPath(meta.path, MANIFEST))) as ProjectManifest | null
      if (!data || !Array.isArray(data.images)) {
        toast(t('这个文件夹不是有效的 Albumark 项目'), 'error')
        return
      }
      // 占位条目先进入项目，文件读取与解码转后台渐进补齐——安卓慢存储上不再整包等待
      images.setItems(data.images.map((r) => makeItem(r, null)))
      manifest.value = data
      current.value = meta
      void hydrateItems(data.images, meta.path)
    } catch (err) {
      // 安卓 / 慢存储上读文件可能偶发失败：给出提示而不是静默失败，让用户能重试
      toast(
        t(
          '打开项目失败：{0}',
          err instanceof Error ? err.message : t('文件读取异常，请重试'),
        ),
        'error',
      )
    } finally {
      loading.value = false
    }
  }

  /** 无文件能力时（浏览器）：本次会话的临时项目（图片仅在内存中）。 */
  function openEphemeralProject(): void {
    const meta: ProjectMeta = {
      id: uid(),
      name: t('临时项目'),
      path: '',
      createdAt: Date.now(),
      count: 0,
    }
    current.value = meta
    manifest.value = { id: meta.id, name: meta.name, createdAt: meta.createdAt, images: [] }
    images.setItems([])
  }

  /**
   * 关闭当前项目。清单必须在这里落盘：scheduleSave 有 400ms 防抖，
   * 刚导入照片就点「工作区」退出时，定时器会被取消而记录从此丢失——
   * 照片文件还在 images/ 里，但重新打开项目就看不到它们了。
   */
  async function closeProject(): Promise<void> {
    hydrateSeq++
    manifestSaver.cancel()
    if (fsAvailable && manifest.value && current.value?.path) {
      const path = current.value.path
      try {
        await fs.writeJsonFile(await fs.joinPath(path, MANIFEST), manifest.value)
      } catch {
        /* 写盘失败不阻塞关闭，否则用户会被困在当前项目里 */
      }
    }
    current.value = null
    manifest.value = null
    images.clear()
    void scanProjects()
  }

  /**
   * 删除项目：桌面移入系统回收站（可找回）；安卓无系统回收站，直接删除
   * （UI 确认框已警示不可撤销）。UI 层负责确认。
   * 返回是否真的删掉了：失败时项目原样保留，调用方不应清理它的附属数据。 */
  async function removeProject(meta: ProjectMeta): Promise<boolean> {
    if (!fsAvailable) return false
    if (current.value?.path === meta.path) await closeProject()
    try {
      await fs.deletePath(meta.path)
    } catch {
      toast(t('无法移入回收站，项目保持原样'), 'error')
      await scanProjects()
      return false
    }
    await scanProjects()
    return true
  }

  /* ---------- 多选批量:复制 / 移动 / 删除 ---------- */

  /**
   * 整目录搬移:同盘走 renamePath(原子);跨盘 / rename 失败降级
   * copyDir 整树复制后删除源。返回目标路径,失败返回 null。
   */
  async function moveDir(from: string, to: string): Promise<string | null> {
    if (from === to) return to
    if (await fs.exists(to)) return null
    try {
      await fs.renamePath(from, to)
      return to
    } catch {
      /* rename 失败(跨卷 / 被占用):降级复制 + 删除 */
    }
    try {
      await fs.copyDir(from, to)
      await fs.deletePath(from)
      return to
    } catch {
      toast(t('移动失败,目标位置可能不可写'), 'error')
      return null
    }
  }

  /** 批量复制项目为当前目录内的副本:整树复制 + 清单重生成 id 与名称 */
  async function copyProjects(metas: ProjectMeta[]): Promise<number> {
    if (!fsAvailable || !dir.value) return 0
    let done = 0
    for (const meta of metas) {
      const dest = await fs.joinPath(dir.value.path, await uniqueProjectDir(`${meta.name} 副本`))
      try {
        await fs.copyDir(meta.path, dest)
        const m = (await fs.readJsonFile(await fs.joinPath(dest, MANIFEST))) as ProjectManifest | null
        if (m) {
          m.id = uid()
          await fs.writeJsonFile(await fs.joinPath(dest, MANIFEST), m)
        }
        done++
      } catch {
        toast(t('复制「{0}」失败,已跳过', meta.name), 'error')
      }
    }
    if (done) await scanProjects()
    return done
  }

  /** 批量移动项目到另一个工作目录:搬移后两端目录重新扫描 */
  async function moveProjects(metas: ProjectMeta[], target: WorkDirMeta): Promise<number> {
    if (!fsAvailable || !dir.value || target.path === dir.value.path) return 0
    let done = 0
    for (const meta of metas) {
      const dest = await fs.joinPath(target.path, meta.name)
      const moved = await moveDir(meta.path, dest)
      if (moved) done++
    }
    if (done) {
      if (current.value && metas.some((m) => m.path === current.value?.path)) await closeProject()
      await scanProjects()
      // 目标目录的项目数刷新(非当前目录,轻量统计一次)
      const st = await scanDirProjects(target.path).catch(() => [])
      const idx = dirs.value.findIndex((d) => d.path === target.path)
      if (idx >= 0) dirs.value[idx] = { ...dirs.value[idx], projects: st.length }
      await persistDir()
    }
    return done
  }

  /** 批量删除项目:桌面移入回收站 / 安卓直接删除(调用方负责二次确认) */
  async function removeProjects(metas: ProjectMeta[]): Promise<number> {
    if (!fsAvailable) return 0
    let done = 0
    for (const meta of metas) {
      if (current.value?.path === meta.path) await closeProject()
      try {
        await fs.deletePath(meta.path)
        done++
      } catch {
        toast(t('删除「{0}」失败,已跳过', meta.name), 'error')
      }
    }
    if (done) await scanProjects()
    return done
  }

  /** 批量复制目录整树到目标父目录(目标位置由 UI 层选定) */
  async function copyDirs(metas: WorkDirMeta[], parentPath: string, toDocuments = false): Promise<number> {
    if (!fsAvailable) return 0
    let done = 0
    for (const meta of metas) {
      const dest = await fs.joinPath(parentPath, meta.name)
      if (await fs.exists(dest)) {
        toast(t('「{0}」在目标位置已存在,已跳过', meta.name), 'error')
        continue
      }
      try {
        await fs.copyDir(meta.path, dest, toDocuments)
        done++
      } catch {
        toast(t('复制「{0}」失败,已跳过', meta.name), 'error')
      }
    }
    return done
  }

  /** 批量搬移目录:磁盘移动 + workdir.json 记录同步(正在使用中的目录跟随) */
  async function moveDirs(metas: WorkDirMeta[], parentPath: string): Promise<number> {
    if (!fsAvailable) return 0
    let done = 0
    const moved: { from: string; to: string }[] = []
    for (const meta of metas) {
      const dest = await fs.joinPath(parentPath, meta.name)
      if (await fs.exists(dest)) {
        toast(t('「{0}」在目标位置已存在,已跳过', meta.name), 'error')
        continue
      }
      const movedTo = await moveDir(meta.path, dest)
      if (movedTo) {
        moved.push({ from: meta.path, to: movedTo })
        done++
      }
    }
    if (moved.length) {
      dirs.value = dirs.value.map((d) => {
        const hit = moved.find((m) => m.from === d.path)
        return hit ? { ...d, path: hit.to } : d
      })
      if (dir.value) {
        const hit = moved.find((m) => m.from === dir.value!.path)
        if (hit) dir.value = { ...dir.value, path: hit.to }
      }
      await persistDir()
    }
    return done
  }

  /** 批量移除目录记录(不删磁盘文件,语义与单个「移除记录」一致) */
  function removeDirs(metas: WorkDirMeta[]): void {
    const paths = new Set(metas.map((m) => m.path))
    dirs.value = dirs.value.filter((d) => !paths.has(d.path))
    if (dir.value && paths.has(dir.value.path)) {
      dir.value = null
      projects.value = []
      gotoSubPage('dirs')
    }
    void persistDir()
  }

  /* ---------- 图片进出项目 ---------- */

  /** 渐进填充的会话序号：切换/关闭项目后旧后台任务作废 */
  let hydrateSeq = 0
  const manifestSaver = createDebouncedSaver(async () => {
    if (!manifest.value || !current.value?.path) return
    await fs.writeJsonFile(await fs.joinPath(current.value.path, MANIFEST), manifest.value)
  }, 400)
  function scheduleSave(): void {
    if (!fsAvailable || !manifest.value || !current.value?.path) return
    manifestSaver.schedule()
  }

  /** 立即写出防抖中的清单：安卓返回退出、切后台前调用，防止窗口期内被杀丢数据 */
  function flushSave(): Promise<void> {
    return Promise.resolve(manifestSaver.flush())
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
    let skipped = 0
    for (const { file, path } of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // 只收 JPG / PNG：其它格式写进 images/ 也解不出来，不如在入口挡掉
      const format = resolveImageFormat(bytes, file.name)
      if (!format) {
        skipped++
        continue
      }
      const code = await sha256Hex(bytes)
      const ref: PrjImageRef = { id: uid(), name: file.name, code, kind: mode }
      if (fsAvailable && prjPath) {
        if (mode === 'link' && path) {
          ref.sourcePath = path
        } else {
          if (mode === 'link' && !path && !toldFallback) {
            toldFallback = true
            toast(t('拿不到文件的源路径，已改为复制'), 'info')
          }
          ref.kind = 'copy'
          ref.storedAs = `${ref.id}.${imageExt(format)}`
          await fs.writeFile(await fs.joinPath(prjPath, 'images', ref.storedAs), bytes)
        }
      } else {
        ref.kind = 'copy'
      }
      const item = makeItem(ref, file)
      manifest.value?.images.push(ref)
      images.adopt(item)
      void processItem(item).then((patch) => images.patchItem(item.id, patch))
      scheduleSave()
    }
    if (skipped > 0) toast(t('已跳过 {0} 个非 JPG/PNG 文件', skipped))
  }

  /** 桌面端拖入/对话框选择的照片（带绝对路径），复制或链接按 mode 决定。 */
  async function addFromPaths(paths: string[], mode: ImportMode = importMode.value): Promise<void> {
    if (!current.value || !isTauri) return
    const supported = paths.filter((p) => isImportableImage(p))
    const skipped = paths.length - supported.length
    if (skipped > 0) toast(t('已跳过 {0} 个非 JPG/PNG 文件', skipped))
    for (const path of supported) {
      try {
        const bytes = await fs.readFile(path)
        const name = fs.baseName(path)
        // 内容优先：扩展名写错（例如被改名的 PNG）也按真实格式落盘
        const format = resolveImageFormat(bytes, name)
        if (!format) {
          toast(t('无法识别：{0}', name), 'error')
          continue
        }
        const code = await sha256Hex(bytes)
        const ref: PrjImageRef = { id: uid(), name, code, kind: mode }
        if (mode === 'link') {
          ref.sourcePath = path
        } else if (current.value.path) {
          ref.storedAs = `${ref.id}.${imageExt(format)}`
          await fs.writeFile(await fs.joinPath(current.value.path, 'images', ref.storedAs), bytes)
        }
        const item = makeItem(
          ref,
          new Blob([bytes.slice().buffer as ArrayBuffer], { type: imageMime(format) }),
        )
        manifest.value?.images.push(ref)
        images.adopt(item)
        void processItem(item).then((patch) => images.patchItem(item.id, patch))
        scheduleSave()
      } catch {
        toast(t('无法读取：{0}', path), 'error')
      }
    }
  }

  /** 从项目移除图片：复制的源文件随平台删除（桌面进回收站 / 安卓直接删除），清单记录删除。 */
  async function removeImage(id: string): Promise<void> {
    images.remove([id])
    if (!manifest.value) return
    const i = manifest.value.images.findIndex((r) => r.id === id)
    if (i < 0) return
    const ref = manifest.value.images[i]
    manifest.value.images.splice(i, 1)
    if (ref.storedAs && current.value?.path && fsAvailable) {
      await fs
        .deletePath(await fs.joinPath(current.value.path, 'images', ref.storedAs))
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
        toast(t('识别码不符：选择的不是原来的那张图'), 'error')
        return
      }
      await applyRelink(ref, bytes, newPath, code)
      toast(t('已重新链接到源文件'), 'success')
    } catch {
      toast(t('无法读取选择的文件'), 'error')
    }
  }

  /** 把一条引用重连到新文件：写入新路径与识别码、重建内存条目与缩略图。
   *  单张 relink 与批量 relinkBatch 共用；识别码一致性由调用方负责 */
  async function applyRelink(ref: PrjImageRef, bytes: Uint8Array, newPath: string, newCode: string): Promise<void> {
    ref.sourcePath = newPath
    ref.code = newCode
    const format = resolveImageFormat(bytes, newPath)
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: imageMime(format ?? 'jpg'),
    })
    const item: ImageItem = {
      id: ref.id,
      name: ref.name,
      baseName: ref.name.replace(/\.[^.]+$/, ''),
      blob,
      thumbUrl: '',
      width: 0,
      height: 0,
      code: newCode,
      sourcePath: newPath,
      kind: ref.kind,
      missing: false,
    }
    const patch = await processItem(item)
    images.patchItem(ref.id, { ...item, ...patch })
    scheduleSave()
  }

  /** 按文件名在所选文件夹里匹配失联照片并预校验识别码（仅扫第一层）。
   *  同名即候选；识别码当场比对，确认窗口据此区分「相符 / 内容不符」 */
  async function matchMissing(dirPath: string): Promise<RelinkCandidate[]> {
    const missing = images.items.filter((i) => i.missing)
    if (!missing.length || !isTauri) return []
    const entries = await fs.readDir(dirPath).catch(() => [])
    const files = entries.filter((e) => !e.isDir)
    const out: RelinkCandidate[] = []
    for (const m of missing) {
      const hit = files.find((e) => e.name === m.name)
      if (!hit) {
        out.push({ id: m.id, name: m.name, path: null, codeOk: false })
        continue
      }
      const path = await fs.joinPath(dirPath, hit.name)
      let codeOk = false
      try {
        const bytes = await fs.readFile(path)
        codeOk = !!m.code && (await sha256Hex(bytes)) === m.code
      } catch {
        /* 读不到按内容不符处理 */
      }
      out.push({ id: m.id, name: m.name, path, codeOk })
    }
    return out
  }

  /** 批量重定位确认后的执行：force 项接受同名但内容有差异的文件，
   *  识别码随新内容更新（此后失联重定位按新码校对）。逐张读盘校验，
   *  结果按「成功（含强制数）/ 失败」合并汇报 */
  async function relinkBatch(list: { id: string; path: string; force: boolean }[]): Promise<void> {
    if (!manifest.value || !isTauri) return
    let ok = 0
    let forced = 0
    let failed = 0
    for (const it of list) {
      const ref = manifest.value.images.find((r) => r.id === it.id)
      if (!ref) {
        failed++
        continue
      }
      try {
        const bytes = await fs.readFile(it.path)
        const code = await sha256Hex(bytes)
        const changed = code !== ref.code
        if (changed && !it.force) {
          failed++
          continue
        }
        await applyRelink(ref, bytes, it.path, code)
        ok++
        if (changed) forced++
      } catch {
        failed++
      }
    }
    if (ok) {
      toast(
        forced
          ? t('已重新链接 {0} 张（其中 {1} 张为同名但内容有差异的文件）', ok, forced)
          : t('已重新链接 {0} 张源文件', ok),
        'success',
      )
    }
    if (failed) toast(t('{0} 张未能重新链接', failed), 'error')
  }

  return {
    dirs,
    dir,
    projects,
    current,
    manifest,
    importMode,
    loading,
    projectSizes,
    dirSizes,
    projectThumbs,
    refreshStats,
    inProject,
    subPage,
    gotoSubPage,
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
    importProjectZip,
    importProjectFolder,
    renameProject,
    renameDir,
    setProjectEmoji,
    setDirEmoji,
    updateProjectInfo,
    importProjectsZip,
    openProject,
    openEphemeralProject,
    closeProject,
    removeProject,
    copyProjects,
    moveProjects,
    removeProjects,
    copyDirs,
    moveDirs,
    removeDirs,
    ensureImageLoaded,
    addFiles,
    addFromPaths,
    removeImage,
    relink,
    matchMissing,
    relinkBatch,
    flushSave,
  }
})
