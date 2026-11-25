import * as fs from './fs'
import { isTauri } from './platform'

/** 单张 / 单个文件的归类：照片、项目清单、其余（缩略图缓存等） */
const IMAGE_EXT = /^\.?(jpg|jpeg|png|webp|gif|heic|heif|avif|tif|tiff)$/i

export interface FileUsage {
  files: number
  imageFiles: number
  imageBytes: number
  manifestBytes: number
  otherBytes: number
}

export interface ProjectUsage extends FileUsage {
  name: string
  path: string
  bytes: number
}

export interface DirUsage extends FileUsage {
  name: string
  path: string
  bytes: number
  projects: ProjectUsage[]
  /** 目录里不属于任何项目的顶层文件（大小与数量都有限，只统计一层） */
  looseBytes: number
  unreadable: boolean
}

export interface StorageReport {
  root: string
  rootBytes: number
  workdirs: DirUsage[]
  totals: FileUsage & { bytes: number; projects: number }
  /** 有目录不可读 / 触发文件上限，数字为已扫描部分 */
  partial: boolean
  scannedFiles: number
}

const MAX_FILES = 40000

/** 并发受限的文件遍历：readDir + stat，避免一次性压满磁盘 I/O */
async function walkFiles(
  root: string,
  onFile: (path: string, name: string, size: number) => void,
  state: { files: number; partial: boolean },
): Promise<void> {
  const dirs: string[] = [root]
  while (dirs.length) {
    const batch = dirs.splice(0, 16)
    const next: string[] = []
    await Promise.all(
      batch.map(async (dir) => {
        let entries: fs.DirEntry[]
        try {
          entries = await fs.readDir(dir)
        } catch {
          state.partial = true
          return
        }
        const files = entries.filter((e) => !e.isDir && !!e.name)
        await Promise.all(
          files.map(async (e) => {
            if (state.files >= MAX_FILES) {
              state.partial = true
              return
            }
            state.files++
            try {
              const size = await fs.fileSize(await fs.joinPath(dir, e.name))
              onFile(dir, e.name, size)
            } catch {
              state.partial = true
            }
          }),
        )
        for (const e of entries) if (e.isDir && e.name) next.push(await fs.joinPath(dir, e.name))
      }),
    )
    dirs.push(...next)
  }
}

function newUsage(): FileUsage {
  return { files: 0, imageFiles: 0, imageBytes: 0, manifestBytes: 0, otherBytes: 0 }
}

/** 把一个文件计入归类（清单按文件名，照片按扩展名） */
function addFile(u: FileUsage, name: string, size: number): void {
  u.files++
  if (name.toLowerCase() === 'albumark.json') {
    u.manifestBytes += size
  } else if (IMAGE_EXT.test(name.split('.').pop() ?? '')) {
    u.imageFiles++
    u.imageBytes += size
  } else {
    u.otherBytes += size
  }
}

/**
 * 扫描一个工作目录：只深入「含 albumark.json 的项目文件夹」，其余子文件夹
 * 属于用户自己的内容（例如把下载目录设为工作目录），不纳入分析——
 * 既可避免把无关数据算成 Albumark 占用，也避免误扫整棵大目录。
 */
async function scanWorkDir(path: string, name: string): Promise<DirUsage> {
  const u: DirUsage = {
    name,
    path,
    bytes: 0,
    projects: [],
    looseBytes: 0,
    unreadable: false,
    ...newUsage(),
  }
  const state = { files: 0, partial: false }
  let entries: fs.DirEntry[]
  try {
    entries = await fs.readDir(path)
  } catch {
    u.unreadable = true
    return u
  }
  for (const e of entries) {
    if (!e.isDir || !e.name || e.name.startsWith('.')) continue
    const p = await fs.joinPath(path, e.name)
    const manifest = await fs.readJsonFile(await fs.joinPath(p, 'albumark.json'))
    if (!manifest || typeof manifest !== 'object' || !Array.isArray((manifest as { images?: unknown }).images)) {
      continue
    }
    const displayName = (manifest as { name?: unknown }).name
    const pu: ProjectUsage = {
      name: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : e.name,
      path: p,
      bytes: 0,
      ...newUsage(),
    }
    const sub = { files: 0, partial: false }
    await walkFiles(p, (_dir, file, size) => addFile(pu, file, size), sub)
    pu.bytes = pu.imageBytes + pu.manifestBytes + pu.otherBytes
    for (const k of ['files', 'imageFiles', 'imageBytes', 'manifestBytes', 'otherBytes'] as const) {
      u[k] += pu[k]
    }
    u.projects.push(pu)
    state.files += sub.files
    if (sub.partial) state.partial = true
  }
  // 目录顶层的零散文件（如用户自己的 index 文件）：只统计一层，不递归
  await Promise.all(
    entries
      .filter((e) => !e.isDir && !!e.name)
      .map(async (e) => {
        try {
          const size = await fs.fileSize(await fs.joinPath(path, e.name))
          u.looseBytes += size
          addFile(u, e.name, size)
        } catch {
          u.unreadable = true
        }
      }),
  )
  u.bytes = u.imageBytes + u.manifestBytes + u.otherBytes
  u.projects.sort((a, b) => b.bytes - a.bytes)
  u.unreadable = u.unreadable || state.partial
  return u
}

/** 软件数据根（AlbumarkData）自身的元数据占用：只统计顶层文件 */
async function scanRoot(root: string): Promise<{ bytes: number; usage: FileUsage; unreadable: boolean }> {
  const usage = newUsage()
  // 全新安装时数据根还没建出来：这是“空”而不是“读不到”，不该弹部分不可读
  if (!(await fs.exists(root))) return { bytes: 0, usage, unreadable: false }
  let entries: fs.DirEntry[]
  try {
    entries = await fs.readDir(root)
  } catch {
    return { bytes: 0, usage, unreadable: true }
  }
  await Promise.all(
    entries
      .filter((e) => !e.isDir && !!e.name)
      .map(async (e) => {
        try {
          const size = await fs.fileSize(await fs.joinPath(root, e.name))
          addFile(usage, e.name, size)
        } catch {
          /* 单个文件读不到不影响整体报告 */
        }
      }),
  )
  return { bytes: usage.imageBytes + usage.manifestBytes + usage.otherBytes, usage, unreadable: false }
}

/**
 * 生成当前数据目录的占用报告：软件数据根（workdir.json 等）+
 * 全部已记录工作目录里的 Albumark 项目。工作目录可能在磁盘任意位置，
 * 因此两处都扫；只认 albumark.json 项目，不碰用户的其他文件。
 */
export async function analyzeStorage(
  root: string,
  dirs: { path: string; name: string }[],
): Promise<StorageReport> {
  if (!isTauri) {
    return {
      root,
      rootBytes: 0,
      workdirs: [],
      totals: { ...newUsage(), bytes: 0, projects: 0 },
      partial: false,
      scannedFiles: 0,
    }
  }
  const rootScan = await scanRoot(root)
  const workdirs = await Promise.all(dirs.map((d) => scanWorkDir(d.path, d.name)))
  const totals = newUsage()
  let bytes = rootScan.bytes
  let projects = 0
  let partial = rootScan.unreadable
  for (const k of Object.keys(rootScan.usage) as (keyof FileUsage)[]) totals[k] += rootScan.usage[k]
  for (const d of workdirs) {
    for (const k of ['files', 'imageFiles', 'imageBytes', 'manifestBytes', 'otherBytes'] as const) {
      totals[k] += d[k]
    }
    bytes += d.bytes
    projects += d.projects.length
    if (d.unreadable) partial = true
  }
  return {
    root,
    rootBytes: rootScan.bytes,
    workdirs: workdirs.sort((a, b) => b.bytes - a.bytes),
    totals: { ...totals, bytes, projects },
    partial,
    scannedFiles: totals.files,
  }
}
