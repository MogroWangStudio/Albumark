import { Zip, ZipPassThrough } from 'fflate'
import { fileSize, joinPath, readDir, readFile, type DirEntry } from './fs'

/**
 * 工作项目 / 工作目录的归档导出核心（双端共用）：
 * 递归枚举 → 文件详情统计 → 流式 zip（fflate，STORE 不二次压缩，
 * 输出分块交给调用方的写回调，整包不驻留内存）。
 * 导出语义是「原样备份」：项目文件夹（含 albumark.json 清单）解压到
 * 任意工作目录下即可被重新识别打开。
 */

export interface ArchiveStats {
  files: number
  bytes: number
}

/** 递归列出文件夹内全部文件的相对路径（POSIX 斜杠，zip 条目名直接可用）。 */
export async function listFolder(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (abs: string, rel: string): Promise<void> => {
    let entries: DirEntry[]
    try {
      entries = await readDir(abs)
    } catch {
      return /* 子目录读不到（权限 / 消失）：跳过，不阻塞整体导出 */
    }
    for (const e of entries) {
      const childAbs = await joinPath(abs, e.name)
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDir) await walk(childAbs, childRel)
      else out.push(childRel)
    }
  }
  await walk(root, '')
  return out.sort()
}

/** 递归统计文件数与总字节（导出确认对话框的文件详情）。 */
export async function statFolder(root: string): Promise<ArchiveStats> {
  const files = await listFolder(root)
  let bytes = 0
  for (const rel of files) {
    try {
      bytes += await fileSize(await joinPath(root, rel))
    } catch {
      /* 单个文件读不到大小：按 0 计入，不阻塞 */
    }
  }
  return { files: files.length, bytes }
}

/**
 * 把整个文件夹流式打成 ZIP：输出分块按顺序交给 write 回调
 * （openWriter 的句柄），峰值内存 ≈ 单个文件。照片本就是压缩格式，
 * 用 STORE 直存（ZipPassThrough）不再二次压缩；onProgress 按文件计数
 * 驱动进度条。调用方需 await 返回值保证最后一块落盘。
 */
export async function zipFolderTo(
  root: string,
  write: (chunk: Uint8Array) => Promise<void>,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<void> {
  const entries = await listFolder(root)
  // Zip 的输出回调是同步签名：把每个分块串到 promise 链上按序落盘，
  // end() 之后 await 链尾即全部写完；任何一块失败都会让链尾 rejected
  let chain: Promise<void> = Promise.resolve()
  const zip = new Zip((err, chunk) => {
    if (err) {
      chain = chain.then(() => Promise.reject(err))
      return
    }
    chain = chain.then(() => write(chunk))
  })
  for (let i = 0; i < entries.length; i++) {
    const rel = entries[i]
    const bytes = await readFile(await joinPath(root, rel))
    const entry = new ZipPassThrough(rel)
    zip.add(entry)
    entry.push(bytes, true)
    onProgress?.(i + 1, entries.length, rel)
  }
  zip.end()
  await chain
}
