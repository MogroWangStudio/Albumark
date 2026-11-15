import { registerPlugin } from '@capacitor/core'
import { isCapacitor, isTauri } from './platform'
import { APP_VERSION } from './version'

/**
 * GitHub Release 检查与自动更新：
 * - 检查：走 github.com 主站的 releases.atom 摘要源，不走 api.github.com——
 *   匿名 REST API 按 IP 限流，共享出口网络下极易 403，部分网络对 api 子域
 *   本身也不稳定；预发布按 tag 是否带「-」后缀判定，与 CI 发布规则同源；
 *   渠道分稳定（仅正式 Release）与测试（含 Pre-Release）
 * - 下载：流式拉取当前平台的 Release 产物（统一 zip，名不带版本号，带进度、
 *   可取消），解出安装包写入暂存目录，下载前清掉旧包
 * - 安装：桌面端只暂存不替换，由设置页读秒后调 installStagedUpdate 派发系统
 *   脚本，等本进程退出后替换并重启（见 src-tauri/src/relaunch.rs 与 update.rs）；
 *   安卓交给系统安装器
 */

export interface UpdateInfo {
  version: string
  url: string
  notes: string
  /** 本平台对应的 Release 产物名（null = 没有对应包体，只能去发布页手动下载） */
  asset: string | null
}

/** 摘要源：github.com 主站提供，无 api 子域的限流问题 */
const ATOM_URL = 'https://github.com/MogroWangStudio/Albumark/releases.atom'
/** Atom link href 里 tag 的路径前缀，其后即 tag 本身 */
const TAG_PATH = '/releases/tag/'
/** 产物下载前缀（tag 带 v，产物名不带） */
const DOWNLOAD_BASE = 'https://github.com/MogroWangStudio/Albumark/releases/download'
const RELEASES_PAGE = 'https://github.com/MogroWangStudio/Albumark/releases'

/** 更新渠道：stable 只看正式 Release，beta 连 Pre-Release 测试版一起看 */
export type UpdateChannel = 'stable' | 'beta'

/** 解析版本号：主版本段 + 预发布标签（2.1.0-beta.1 → [2,1,0] + 'beta.1'） */
function parseVersion(v: string): { core: number[]; pre: string } {
  const clean = v.replace(/^v/, '')
  const dash = clean.indexOf('-')
  if (dash === -1) return { core: clean.split('.').map(Number), pre: '' }
  return { core: clean.slice(0, dash).split('.').map(Number), pre: clean.slice(dash + 1) }
}

/** 比较 semver：a 是否比 b 新（支持 2.1.0-beta.1 这类预发布号，规则同 semver） */
function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.core.length, pb.core.length)
  for (let i = 0; i < len; i++) {
    const x = pa.core[i] ?? 0
    const y = pb.core[i] ?? 0
    if (x !== y) return x > y
  }
  // 主版本段相同：正式版比预发布新；都是预发布按点段比较（数字段比数值，缺段的更旧）
  if (!pa.pre || !pb.pre) return !pa.pre && !!pb.pre
  const sa = pa.pre.split('.')
  const sb = pb.pre.split('.')
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i]
    const y = sb[i]
    if (x === undefined) return false
    if (y === undefined) return true
    if (x === y) continue
    const nx = Number(x)
    const ny = Number(y)
    const numCmp = !Number.isNaN(nx) && !Number.isNaN(ny)
    // semver：数字标识符总比字母标识符新；同为字母按字典序
    if (numCmp) return nx > ny
    const xIsNum = !Number.isNaN(Number(x))
    const yIsNum = !Number.isNaN(Number(y))
    if (xIsNum !== yIsNum) return xIsNum
    return x > y
  }
  return false
}

async function fetchText(url: string): Promise<string> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const res = await tauriFetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

interface FeedEntry {
  tag: string
  url: string
  notes: string
}

/**
 * 解析 releases.atom：tag 从 link href 的 /releases/tag/ 后缀取（id 末段会丢
 * 特殊字符），发布说明取 content（GitHub 渲染后的 HTML）的纯文本。
 */
function parseAtom(xml: string): FeedEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const out: FeedEntry[] = []
  for (const entry of Array.from(doc.getElementsByTagName('entry'))) {
    const link = Array.from(entry.getElementsByTagName('link')).find((l) =>
      (l.getAttribute('href') ?? '').includes(TAG_PATH),
    )
    const href = link?.getAttribute('href')
    if (!href) continue
    const tag = decodeURIComponent(href.slice(href.indexOf(TAG_PATH) + TAG_PATH.length))
    if (!tag) continue
    const html = entry.getElementsByTagName('content')[0]?.textContent ?? ''
    out.push({ tag, url: href, notes: htmlToText(html) })
  }
  return out
}

/** HTML → 纯文本：parse 成独立文档取 textContent（外部内容绝不注入页面 DOM），截 3000 字符 */
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').trim().slice(0, 3000)
}

/**
 * 按渠道查询最新版本；有新版本时返回更新信息，已是最新返回 null，异常时抛错。
 * Atom 源按发布时间倒序列出最近若干条（正式与 Pre-Release 混排，draft 不在其中）；
 * 稳定通道过滤掉带「-」后缀的预发布 tag 后取语义化最新的一个。
 */
export async function checkForUpdate(channel: UpdateChannel = 'stable'): Promise<UpdateInfo | null> {
  const xml = await fetchText(ATOM_URL)
  const acceptPre = channel === 'beta'
  let best: { version: string; entry: FeedEntry } | null = null
  for (const entry of parseAtom(xml)) {
    const ver = entry.tag.replace(/^v/, '')
    // 预发布判定与 CI 发布规则同源：去 v 前缀后含「-」即 Pre-Release
    if (!acceptPre && ver.includes('-')) continue
    if (!isNewer(ver, APP_VERSION)) continue
    if (!best || isNewer(ver, best.version)) best = { version: ver, entry }
  }
  if (!best) return null
  return {
    version: best.version,
    url: best.entry.url || RELEASES_PAGE,
    notes: best.entry.notes,
    asset: assetName(),
  }
}

/**
 * 当前平台对应的 Release 产物名（与 .github/workflows/release.yml 的整理产物
 * 命名单点对齐；未列出的平台退回手动下载）。产物统一为 zip 压缩包，
 * 名字只带平台架构不带版本号——版本只体现在 tag 路径里。
 */
function assetName(): string | null {
  if (isCapacitor) return 'Albumark_android.zip'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Albumark_windows-x64.zip'
  if (/Mac/i.test(ua)) return 'Albumark_macos-arm64.zip'
  return null
}

export async function openReleasePage(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

/* ---------- 自动更新：下载与安装 ---------- */

/** 流式下载到内存：content-length 可知时回报百分比，否则 null（不定进度）；signal 可中途取消 */
async function fetchBytes(
  url: string,
  onProgress: (pct: number | null) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const headers = { Accept: 'application/octet-stream' }
  const res = isTauri
    ? await import('@tauri-apps/plugin-http').then(({ fetch: tauriFetch }) =>
        tauriFetch(url, { headers, signal }),
      )
    : await fetch(url, { headers, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onProgress(100)
    return buf
  }
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loaded += value.length
    onProgress(total ? Math.min(100, Math.round((loaded / total) * 100)) : null)
  }
  const out = new Uint8Array(loaded)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export interface DownloadResult {
  /** staged = 桌面端已暂存待装（读秒后调 installStagedUpdate）；auto = 已交给系统安装器（安卓） */
  kind: 'staged' | 'auto'
  stagedPath: string
  message: string
}

/** 清空暂存目录里的旧安装包，只留本次下载；目录尚不存在等异常忽略。 */
async function clearStale(dir: string): Promise<void> {
  const { join } = await import('@tauri-apps/api/path')
  const fs = await import('@tauri-apps/plugin-fs')
  try {
    for (const entry of await fs.readDir(dir)) {
      await fs.remove(await join(dir, entry.name)).catch(() => undefined)
    }
  } catch {
    /* 尚无目录：无需清理 */
  }
}

/**
 * 下载当前平台的更新包并暂存：
 * - Release 资产统一为 zip（Albumark_平台架构.zip），下载完解出里面的安装包，
 *   只取包内第一个文件（安装包与版本号无关，名字由 CI 打包保证）
 * - 桌面端：写入暂存目录（Windows 为程序目录 updates/，macOS 为应用数据目录
 *   updates/），返回 stagedPath，安装动作由设置页读秒后触发
 * - 安卓：APK 写入公共 Documents/Albumark/updates/，直接交给系统安装器
 * - signal 可中途取消下载：中断时抛 AbortError，由调用方静默处理
 */
export async function downloadUpdate(
  info: UpdateInfo,
  onProgress: (pct: number | null) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const asset = info.asset
  if (!asset) {
    throw new Error('没有适配当前平台的更新包，请前往下载页手动获取')
  }
  const url = `${DOWNLOAD_BASE}/v${info.version}/${asset}`
  const bytes = await fetchBytes(url, onProgress, signal)
  onProgress(100)
  if (signal?.aborted) {
    throw new DOMException('下载已取消', 'AbortError')
  }

  // 解包 zip：安装包（exe / dmg / apk）与版本号无关，zip 内只有一个文件
  const { unzipSync } = await import('fflate')
  const files = unzipSync(bytes)
  const entry = Object.entries(files).find(([, data]) => data.length > 0)
  if (!entry) {
    throw new Error('更新包内容为空，请重新下载或前往下载页手动获取')
  }
  const payload = entry[1]
  const pkgName = entry[0].split(/[\\/]/).pop() ?? 'Albumark.bin'

  if (isCapacitor) {
    const { Directory, Filesystem } = await import('@capacitor/filesystem')
    const rel = `Albumark/updates/${pkgName}`
    await Filesystem.writeFile({
      path: rel,
      directory: Directory.Documents,
      data: toBase64(payload),
      recursive: true,
    })
    const updater = registerPlugin<{ openApk(o: { path: string }): Promise<void> }>('Updater')
    await updater.openApk({ path: rel })
    return { kind: 'auto', stagedPath: rel, message: '已交给系统安装，按提示完成更新' }
  }

  const { join } = await import('@tauri-apps/api/path')
  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs')
  const { executableDir, appDataDir } = await import('./platform')

  // Windows 便携版暂存在程序目录旁；macOS 暂存在应用数据目录
  const onWindows = /Windows/i.test(navigator.userAgent)
  const base = onWindows ? await executableDir() : await appDataDir()
  if (!base) {
    throw new Error(onWindows ? '无法定位程序目录' : '无法定位数据目录')
  }
  const dir = await join(base, 'updates')
  await mkdir(dir, { recursive: true }).catch(() => undefined)
  await clearStale(dir)
  const stagedPath = await join(dir, pkgName)
  await writeFile(stagedPath, payload)
  return { kind: 'staged', stagedPath, message: '更新包已就绪' }
}

/**
 * 桌面端安装已暂存的更新：派发替换脚本（Windows 原地覆盖 exe、macOS 整体替换
 * .app）后本进程立即退出，由脚本完成替换并重启；失败抛错由调用方展示。
 */
export async function installStagedUpdate(stagedPath: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('prepare_and_install', { stagedPath })
}
