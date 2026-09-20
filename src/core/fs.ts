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

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
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

export async function readFile(path: string): Promise<Uint8Array> {
  if (isTauri) {
    const fs = await import('@tauri-apps/plugin-fs')
    return await fs.readFile(path)
  }
  const m = await capacitor()
  const res = await m.Filesystem.readFile({ path, directory: m.Directory.Data })
  // 原生返回 base64 字符串；Web 平台返回 Blob
  if (typeof res.data === 'string') return base64ToBytes(res.data)
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
