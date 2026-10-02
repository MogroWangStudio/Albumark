import { registerPlugin } from '@capacitor/core'
import { isCapacitor, isTauri } from './platform'
import { APP_VERSION } from './version'

/**
 * GitHub Release 检查与自动更新：
 * - 检查：手动触发，不自动轮询（本地优先，不打扰）
 * - 更新：流式下载 Release 资产（带进度），平台各自的安装动作——
 *   Windows 便携版写替换脚本自动换新，macOS 打开 DMG，安卓交给系统安装器
 */

export interface UpdateAsset {
  name: string
  url: string
}

export interface UpdateInfo {
  version: string
  url: string
  notes: string
  /** Release 附带的安装包资产（按平台命名约定匹配下载） */
  assets: UpdateAsset[]
}

const LATEST_API = 'https://api.github.com/repos/MogroWangStudio/Albumark/releases/latest'

/** 逐段比较 semver：a 是否比 b 新 */
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

async function fetchJson(url: string): Promise<unknown> {
  const headers = { Accept: 'application/vnd.github+json' }
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const res = await tauriFetch(url, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  }
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

/** 查询最新 Release；有新版本时返回更新信息，已是最新返回 null，异常时抛错。 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const data = (await fetchJson(LATEST_API)) as {
    tag_name?: string
    html_url?: string
    body?: string
    draft?: boolean
    prerelease?: boolean
    assets?: { name?: string; browser_download_url?: string }[]
  }
  if (!data || data.draft || data.prerelease || !data.tag_name) {
    throw new Error('响应格式异常')
  }
  const latest = data.tag_name.replace(/^v/, '')
  if (!isNewer(latest, APP_VERSION)) return null
  const assets = (data.assets ?? [])
    .filter((a) => a.name && a.browser_download_url)
    .map((a) => ({ name: a.name as string, url: a.browser_download_url as string }))
  return {
    version: latest,
    url: data.html_url ?? 'https://github.com/MogroWangStudio/Albumark/releases',
    notes: data.body ?? '',
    assets,
  }
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

/** 按平台匹配 Release 资产（命名约定由 CI 发布时保证） */
export function pickAsset(assets: UpdateAsset[]): UpdateAsset | null {
  const ua = navigator.userAgent
  const patterns = isCapacitor
    ? [/\.apk$/i]
    : /Windows/i.test(ua)
      ? [/windows.*\.exe$/i]
      : /Mac/i.test(ua)
        ? [/macos.*\.dmg$/i]
        : []
  for (const re of patterns) {
    const hit = assets.find((a) => re.test(a.name))
    if (hit) return hit
  }
  return null
}

/** 流式下载到内存：content-length 可知时回报百分比，否则 null（不定进度） */
async function fetchBytes(
  url: string,
  onProgress: (pct: number | null) => void,
): Promise<Uint8Array> {
  const headers = { Accept: 'application/octet-stream' }
  const res = isTauri
    ? await import('@tauri-apps/plugin-http').then(({ fetch: tauriFetch }) =>
        tauriFetch(url, { headers }),
      )
    : await fetch(url, { headers })
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

export interface InstallOutcome {
  /** auto：应用即将退出（Windows）或跳转安装器（安卓）；manual：用户手动继续安装 */
  kind: 'auto' | 'manual'
  message: string
}

/**
 * 下载并启动更新安装：
 * - Windows 便携版：新 exe + 替换脚本写入程序目录，打开脚本后应用自动退出，
 *   脚本等旧进程退出后覆盖原文件并重启
 * - macOS：DMG 下载到应用数据目录并在访达中显示
 * - 安卓：APK 写入公共 Documents/Albumark/updates/，交给系统安装器
 */
export async function downloadAndInstall(
  info: UpdateInfo,
  onProgress: (pct: number | null) => void,
): Promise<InstallOutcome> {
  const asset = pickAsset(info.assets)
  if (!asset) {
    throw new Error('没有适配当前平台的更新包，请前往下载页手动获取')
  }
  const bytes = await fetchBytes(asset.url, onProgress)
  onProgress(100)

  if (isCapacitor) {
    const { Directory, Filesystem } = await import('@capacitor/filesystem')
    const rel = `Albumark/updates/${asset.name}`
    await Filesystem.writeFile({
      path: rel,
      directory: Directory.Documents,
      data: toBase64(bytes),
      recursive: true,
    })
    const updater = registerPlugin<{ openApk(o: { path: string }): Promise<void> }>('Updater')
    await updater.openApk({ path: rel })
    return { kind: 'auto', message: '已交给系统安装，按提示完成更新' }
  }

  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) {
    const { join } = await import('@tauri-apps/api/path')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const { openPath } = await import('@tauri-apps/plugin-opener')
    const { exePath, executableDir } = await import('./platform')
    const oldPath = await exePath()
    if (!oldPath) throw new Error('无法定位当前程序文件')
    const dir = await executableDir()
    const newPath = await join(dir, asset.name)
    await writeFile(newPath, bytes)
    const batPath = await join(dir, '更新辑印.bat')
    await writeFile(batPath, new TextEncoder().encode(buildReplaceBat(oldPath, newPath)))
    await openPath(batPath)
    // 脚本会等旧进程退出后替换并重启，这里稍候自行关闭
    window.setTimeout(() => {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().close())
        .catch(() => undefined)
    }, 1800)
    return { kind: 'auto', message: '更新包已就绪，应用即将自动替换并重启' }
  }

  // macOS：DMG 下载到应用数据目录，在访达中显示
  const { join } = await import('@tauri-apps/api/path')
  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs')
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  const { appDataDir } = await import('./platform')
  const base = await appDataDir()
  if (!base) throw new Error('无法定位数据目录')
  const dir = await join(base, 'updates')
  await mkdir(dir, { recursive: true }).catch(() => undefined)
  const dmgPath = await join(dir, asset.name)
  await writeFile(dmgPath, bytes)
  await revealItemInDir(dmgPath)
  return { kind: 'manual', message: '安装包已下载，双击 DMG 完成安装' }
}

/** 便携版自替换脚本：等旧进程退出 → 覆盖原文件 → 重启 → 自清理 */
function buildReplaceBat(oldPath: string, newPath: string): string {
  const oldName = oldPath.split(/[\\/]/).pop() ?? 'Albumark.exe'
  return [
    '@echo off',
    'chcp 65001 >nul',
    'title 辑印更新',
    'echo 正在更新辑印，请稍候…',
    ':wait',
    `tasklist | find /I "${oldName}" >nul`,
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    `copy /y "${newPath}" "${oldPath}" >nul`,
    'if errorlevel 1 (',
    '  echo 更新失败：无法替换程序文件（可能被占用或没有权限）。',
    `  echo 新版本已保存在：${newPath}`,
    '  pause',
    '  exit /b 1',
    ')',
    `del "${newPath}"`,
    `start "" "${oldPath}"`,
    'exit',
  ].join('\r\n')
}
