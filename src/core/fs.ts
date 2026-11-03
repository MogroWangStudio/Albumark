/**
 * 统一文件系统抽象，workspace 层不再感知平台差异。
 * - 桌面（Tauri）：plugin-fs，路径为绝对路径；回收站走自定义 move_to_trash 命令。
 * - 安卓（Capacitor）：@capacitor/filesystem，全部文件都放在应用数据目录（Directory.Data）
 *   下，路径为相对该根的 POSIX 相对路径；系统没有回收站，删除改移入 Data 下的 trash/。
 * - 浏览器：无持久文件能力（fsAvailable=false），只支持内存临时项目。
 */
import { isCapacitor, isTauri } from './platform'

export interface DirEntry {
  name: string
  isDir: boolean
}

/** 是否具备持久文件系统能力（桌面 + 安卓） */
export const fsAvailable = isTauri || isCapacitor
/** 沙箱文件系统：没有系统目录选择器，「选择工作目录」实为在应用数据目录内命名/发现 */
export const sandboxedFs = isCapacitor && !isTauri

/** 安卓端应用数据目录内的回收站文件夹 */
const TRASH_DIR = 'AlbumarkData/trash'

type FsModule = typeof import('@capacitor/filesystem')

let capMod: FsModule | null = null
async function capacitor(): Promise<FsModule> {
  if (!capMod) capMod = await import('@capacitor/filesystem')
  return capMod
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** 安卓原生侧返回 base64：走引擎内置的 data URL 解码，
 *  比 atob + 逐字节循环快数倍，且不产生中间二进制大字符串。 */
async function base64ToBytes(b64: string): Promise<Uint8Array> {
  const res = await fetch(`data:application/octet-stream;base64,${b64}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** 路径拼接：桌面走 Tauri path API（平台分隔符），安卓为 POSIX 相对路径 */
export async function joinPath(...parts: string[]): Promise<string> {
  const list = parts.filter((p) => !!p)
  if (!list.length) return ''
  if (isTauri) {
    const { join } = await import('@tauri-apps/api/path')
    return await join(...list)
  }
  return list
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/')
}

/** 路径最后一段名称 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** 去掉最后一段的父目录路径（重命名定位父目录用；根路径返回空串） */
export function parentPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  parts.pop()
  return parts.join('/')
}

/** 单个文件的字节大小（导出统计用；路径为 Data 内相对路径或桌面绝对路径） */
export async function fileSize(path: string, toDocuments = false): Promise<number> {
  if (isTauri) {
    const f = await import('@tauri-apps/plugin-fs')
    const info = await f.stat(path)
    return info.isFile ? info.size : 0
  }
  const m = await capacitor()
  const st = await m.Filesystem.stat({
    path,
    directory: toDocuments ? m.Directory.Documents : m.Directory.Data,
  })
  return st.type === 'file' ? Number(st.size ?? 0) : 0
}

export interface SequentialWriter {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

/**
 * 打开一个顺序写文件的句柄（流式导出用，避免整包驻留内存）。
 * 桌面走 plugin-fs 的 create() 文件句柄分块写；安卓首块 writeFile、
 * 后续 appendFile（base64 分块传输）。toDocuments 选择公共 Documents
 * （安卓导出目的地），默认应用数据目录。
 */
export async function openWriter(path: string, toDocuments = false): Promise<SequentialWriter> {
  if (isTauri) {
    const f = await import('@tauri-apps/plugin-fs')
    const handle = await f.create(path)
    return {
      write: async (chunk) => {
        await handle.write(chunk)
      },
      close: () => handle.close(),
    }
  }
  const m = await capacitor()
  const directory = toDocuments ? m.Directory.Documents : m.Directory.Data
  let started = false
  return {
    write: async (chunk) => {
      const b64 = bytesToBase64(chunk)
      if (!started) {
        started = true
        await m.Filesystem.writeFile({ path, directory, data: b64, recursive: true })
      } else {
        await m.Filesystem.appendFile({ path, directory, data: b64 })
      }
    },
    close: async () => {
      /* 从未写入过也要落一个空文件，保持目标可见 */
      if (!started) {
        started = true
        await m.Filesystem.writeFile({ path, directory, data: '', recursive: true })
      }
    },
  }
}

/**
 * 递归复制整个文件夹（工作项目 / 工作目录导出为文件夹）。
 * 安卓用 Filesystem.copy 一次整树复制（原生支持跨目录）；
 * 桌面手写递归 readDir + mkdir + copyFile。
 */
export async function copyDir(from: string, to: string, toDocuments = false): Promise<void> {
  if (isTauri) {
    const f = await import('@tauri-apps/plugin-fs')
    const copyTree = async (src: string, dest: string): Promise<void> => {
      await f.mkdir(dest, { recursive: true })
      for (const e of await f.readDir(src)) {
        if (!e.name) continue
        const s = await joinPath(src, e.name)
        const d = await joinPath(dest, e.name)
        if (e.isDirectory) await copyTree(s, d)
        else await f.copyFile(s, d)
      }
    }
    await copyTree(from, to)
    return
  }
  const m = await capacitor()
  await m.Filesystem.copy({
    from,
    to,
    directory: m.Directory.Data,
    toDirectory: toDocuments ? m.Directory.Documents : m.Directory.Data,
  })
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    return await fs.readFile(path)
  }
  const m = await capacitor()
  const res = await m.Filesystem.readFile({ path, directory: m.Directory.Data })
  // 原生返回 base64 字符串；Web 平台返回 Blob
  if (typeof res.data === 'string') return await base64ToBytes(res.data)
  return new Uint8Array(await res.data.arrayBuffer())
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.writeFile(path, data)
    return
  }
  const m = await capacitor()
  await m.Filesystem.writeFile({
    path,
    directory: m.Directory.Data,
    data: bytesToBase64(data),
    recursive: true,
  })
}

export async function mkdir(path: string, recursive = true): Promise<void> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir(path, { recursive }).catch(() => undefined)
    return
  }
  const m = await capacitor()
  await m.Filesystem.mkdir({ path, directory: m.Directory.Data, recursive }).catch(() => undefined)
}

export async function readDir(path: string): Promise<DirEntry[]> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    const entries = await fs.readDir(path)
    return entries.map((e) => ({ name: e.name ?? '', isDir: e.isDirectory }))
  }
  const m = await capacitor()
  const res = await m.Filesystem.readdir({ path, directory: m.Directory.Data })
  return res.files.map((f) => ({ name: f.name, isDir: f.type === 'directory' }))
}

export async function exists(path: string): Promise<boolean> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    return await fs.exists(path)
  }
  const m = await capacitor()
  try {
    await m.Filesystem.stat({ path, directory: m.Directory.Data })
    return true
  } catch {
    return false
  }
}

export async function remove(path: string, recursive = false): Promise<void> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.remove(path, { recursive })
    return
  }
  const m = await capacitor()
  try {
    const st = await m.Filesystem.stat({ path, directory: m.Directory.Data })
    if (st.type === 'directory') {
      await m.Filesystem.rmdir({ path, directory: m.Directory.Data, recursive })
    } else {
      await m.Filesystem.deleteFile({ path, directory: m.Directory.Data })
    }
  } catch {
    /* 目标不存在视为已删除 */
  }
}

export async function renamePath(from: string, to: string): Promise<void> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.rename(from, to)
    return
  }
  const m = await capacitor()
  await m.Filesystem.rename({ from, to, directory: m.Directory.Data, toDirectory: m.Directory.Data })
}

/**
 * 移入回收站：桌面端走系统回收站（trash crate）；安卓端没有系统回收站，
 * 移入应用数据目录的 trash/ 文件夹（带时间戳避免重名），可手动找回。
 */
export async function trashPath(path: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('move_to_trash', { path })
    return
  }
  const m = await capacitor()
  await m.Filesystem.mkdir({ path: TRASH_DIR, directory: m.Directory.Data, recursive: true })
  const stamp = Date.now().toString(36)
  const name = baseName(path)
  await m.Filesystem.rename({
    from: path,
    to: `${TRASH_DIR}/${stamp}-${name}`,
    directory: m.Directory.Data,
    toDirectory: m.Directory.Data,
  })
}

/**
 * 安卓逐张导出：把成批文件写入公共 Documents 下的 Albumark/<sub>/，
 * 返回展示路径（Documents/Albumark/<sub>）。公开 Documents 目录里，
 * Android 11+ 允许应用写入「自己创建」的文件；Android 10 依赖 manifest 的
 * legacy 存储标记；Android 9 及以下由已声明的存储权限覆盖。
 */
export async function writeFilesToPublicFolder(
  sub: string,
  files: { name: string; bytes: ArrayBuffer }[],
): Promise<string> {
  const m = await capacitor()
  for (const f of files) {
    await m.Filesystem.writeFile({
      path: `Albumark/${sub}/${f.name}`,
      directory: m.Directory.Documents,
      data: bytesToBase64(new Uint8Array(f.bytes)),
      recursive: true,
    })
  }
  return `Documents/Albumark/${sub}`
}

/**
 * 安卓分享：把成批文件写入应用缓存 share/ 子目录，返回可直接交给系统分享
 * 面板的 file:// URI（getUri 对应用内部目录返回本地文件 URI，Share 插件
 * 再经 FileProvider 转为可授权的 content URI）。写入前清掉上次遗留，
 * 缓存目录由系统按需回收，不在用户的公共目录留副本。
 */
export async function writeFilesToShareCache(
  files: { name: string; bytes: ArrayBuffer }[],
): Promise<string[]> {
  const m = await capacitor()
  await m.Filesystem.readdir({ path: 'share', directory: m.Directory.Cache })
    .then((res) =>
      Promise.all(
        res.files.map((f) =>
          m.Filesystem.deleteFile({ path: `share/${f.name}`, directory: m.Directory.Cache }).catch(
            () => undefined,
          ),
        ),
      ),
    )
    .catch(() => undefined) /* 首次分享时目录还不存在，视为已清空 */
  const uris: string[] = []
  for (const f of files) {
    await m.Filesystem.writeFile({
      path: `share/${f.name}`,
      directory: m.Directory.Cache,
      data: bytesToBase64(new Uint8Array(f.bytes)),
      recursive: true,
    })
    const { uri } = await m.Filesystem.getUri({ path: `share/${f.name}`, directory: m.Directory.Cache })
    uris.push(uri)
  }
  return uris
}

/* ---------- JSON 清单读写 ---------- */

export async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await readFile(path)))
  } catch {
    return null
  }
}

export async function writeJsonFile(path: string, data: unknown): Promise<boolean> {
  try {
    await writeFile(path, new TextEncoder().encode(JSON.stringify(data, null, 2)))
    return true
  } catch {
    return false
  }
}
