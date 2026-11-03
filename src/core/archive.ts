import { Unzip, UnzipInflate, Zip, ZipPassThrough, type UnzipFile } from 'fflate'
import { fileSize, joinPath, mkdir, readDir, readFile, writeFile, type DirEntry } from './fs'

/**
 * 工作项目 / 工作目录的归档导出核心（双端共用）：
 * 递归枚举 → 文件详情统计 → 流式 zip（fflate，STORE 不二次压缩，
 * 输出分块交给调用方的写回调，整包不驻留内存）。
 * 导出语义是「原样备份」：项目文件夹（含 albumark.json 清单）解压到
 * 任意工作目录下即可被重新识别打开。
 * 导入侧对称：流式解压（源 Blob 分块喂入，峰值内存 ≈ 单个文件）。
 */

export interface ArchiveStats {
  files: number
  bytes: number
}

/** 项目清单文件名（与 workspace store 的约定一致） */
const MANIFEST_NAME = 'albumark.json'

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

/* ---------- 导入：流式解压 ---------- */

export interface ZipManifestProbe {
  /** 项目根在 ZIP 内的路径前缀：'' = 根层即项目根；'folder/' = 顶层包裹文件夹 */
  prefix: string
  /** albumark.json 的原始字节（导入时解析并重生成为新项目 id） */
  bytes: Uint8Array
}

/** 把 Blob 按序分块喂给 fflate 解压器：文件流直通，不整包驻留内存 */
async function pumpBlob(uz: Unzip, source: Blob): Promise<void> {
  const reader = source.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      uz.push(new Uint8Array(0), true)
      return
    }
    if (value) uz.push(value)
  }
}

/**
 * 造一个已注册解压器的 Unzip：fflate 实例默认只认 STORE（0）条目，
 * DEFLATE（8）必须显式挂上 UnzipInflate——本应用导出的是 STORE 包，
 * 但外部工具/旧备份可能是 DEFLATE，缺注册会直接崩掉解压流。
 */
function makeUnzip(cb: (file: UnzipFile) => void): Unzip {
  const uz = new Unzip(cb)
  // o 是 fflate 未在类型上公开的实例解压器表，运行时存在
  ;(uz as unknown as { o: Record<number, unknown> }).o[8] = UnzipInflate
  return uz
}

/** 条目名清洗：反斜杠归一、拒绝盘符 / 绝对路径 / .. 穿越（zip 内不可信） */
function sanitizeEntry(name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (!seg || seg === '.') continue
    if (/^[a-zA-Z]:$/.test(seg) || seg === '..') return null
    out.push(seg)
  }
  return out.join('/')
}

/**
 * 探测 ZIP 内的项目清单：优先根层 albumark.json；否则取唯一顶层包裹
 * 文件夹内的（常见「解压软件加壳」结构）。多包裹 / 无清单返回 null。
 * 只收集清单字节，其余条目流过即弃，不做任何写盘。
 */
export async function probeZipManifest(source: Blob): Promise<ZipManifestProbe | null> {
  const candidates: { prefix: string; chunks: Uint8Array[] }[] = []
  const tops = new Set<string>()
  let chain = Promise.resolve()
  const uz = makeUnzip((file: UnzipFile) => {
    const clean = sanitizeEntry(file.name)
    if (!clean || clean.endsWith('/')) {
      file.ondata = () => {}
      file.start()
      return
    }
    const slash = clean.indexOf('/')
    if (slash >= 0) tops.add(clean.slice(0, slash))
    const isManifest =
      clean === MANIFEST_NAME || (slash >= 0 && clean.slice(slash + 1) === MANIFEST_NAME)
    if (!isManifest) {
      file.ondata = () => {}
      file.start()
      return
    }
    const entry = { prefix: slash >= 0 ? clean.slice(0, slash + 1) : '', chunks: [] as Uint8Array[] }
    candidates.push(entry)
    file.ondata = (err, data, final) => {
      chain = chain.then(() => {
        if (err) throw err
        entry.chunks.push(data)
        if (final) return
      })
    }
    file.start()
  })
  await pumpBlob(uz, source)
  await chain
  // 根层优先；否则要求顶层唯一（多个顶层各有清单 = 结构不识别）
  const root = candidates.find((c) => c.prefix === '')
  if (root) {
    return { prefix: '', bytes: concatChunks(root.chunks) }
  }
  if (candidates.length > 0 && tops.size === 1) {
    const best = candidates.reduce((a, b) => (a.prefix.length <= b.prefix.length ? a : b))
    return { prefix: best.prefix, bytes: concatChunks(best.chunks) }
  }
  return null
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/**
 * 流式解压 ZIP 到目标目录：条目逐个写盘（mkdir 父目录），峰值内存 ≈ 单个
 * 文件。prefix 之前的包裹层条目跳过；manifestBytes 提供时同名清单条目照常
 * 流过即弃、最后以提供的字节覆写（导入重生成项目 id 用）。返回写盘文件数。
 */
export async function unzipTo(
  source: Blob,
  dest: string,
  opts: {
    /** 跳过的顶层前缀（probeZipManifest 返回的 prefix） */
    prefix?: string
    /** 覆写 dest/albumark.json 的字节（可选） */
    manifestBytes?: Uint8Array
    onProgress?: (done: number, name: string) => void
  } = {},
): Promise<number> {
  const prefix = opts.prefix ?? ''
  let chain = Promise.resolve()
  let files = 0
  let sawManifest = false
  const uz = makeUnzip((file: UnzipFile) => {
    const clean = sanitizeEntry(file.name)
    if (!clean || clean.endsWith('/')) {
      file.ondata = () => {}
      file.start()
      return
    }
    const rel = prefix && clean.startsWith(prefix) ? clean.slice(prefix.length) : clean
    if (prefix && !clean.startsWith(prefix)) {
      file.ondata = () => {}
      file.start()
      return
    }
    if (rel === MANIFEST_NAME) sawManifest = true
    const drop = rel === MANIFEST_NAME && !!opts.manifestBytes
    let sink: Uint8Array[] = []
    file.ondata = (err, data, final) => {
      chain = chain.then(async () => {
        if (err) throw err
        if (drop) {
          if (final) sink = []
          return
        }
        const abs = await joinPath(dest, rel)
        await mkdir(await parentOf(abs))
        // 分块累积到最后一块再写：条目以 final 结束（本实现的调用方式逐条目完整）
        if (final) {
          sink.push(data)
          await writeFile(abs, concatChunks(sink))
          sink = []
          files++
          opts.onProgress?.(files, rel)
        } else {
          sink.push(data)
        }
      })
    }
    file.start()
  })
  await pumpBlob(uz, source)
  await chain
  if (opts.manifestBytes && sawManifest) {
    await writeFile(await joinPath(dest, MANIFEST_NAME), opts.manifestBytes)
  }
  return files
}

async function parentOf(abs: string): Promise<string> {
  const i = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'))
  return i > 0 ? abs.slice(0, i) : abs
}
