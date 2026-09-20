import { isTauri } from './platform'
import { APP_VERSION } from './version'

/** GitHub Release 检查更新：手动触发，不自动轮询（本地优先，不打扰）。 */

export interface UpdateInfo {
  version: string
  url: string
  notes: string
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
  }
  if (!data || data.draft || data.prerelease || !data.tag_name) {
    throw new Error('响应格式异常')
  }
  const latest = data.tag_name.replace(/^v/, '')
  if (!isNewer(latest, APP_VERSION)) return null
  return {
    version: latest,
    url: data.html_url ?? 'https://github.com/MogroWangStudio/Albumark/releases',
    notes: data.body ?? '',
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
