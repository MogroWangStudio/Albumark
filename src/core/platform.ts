/** 平台能力检测与适配：Tauri 桌面端走插件 API，其余环境走浏览器能力。 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const isCapacitor =
  typeof window !== 'undefined' &&
  !!(window as unknown as { Capacitor?: unknown }).Capacitor &&
  !isTauri

export async function pickDirectory(title = '选择文件夹'): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const dir = await open({ directory: true, multiple: false, title })
  return typeof dir === 'string' ? dir : null
}

/** 桌面端选择若干 JPG 照片，返回绝对路径。 */
export async function pickImagePaths(title = '选择照片'): Promise<string[]> {
  if (!isTauri) return []
  const { open } = await import('@tauri-apps/plugin-dialog')
  const paths = await open({
    multiple: true,
    title,
    filters: [{ name: 'JPEG 照片', extensions: ['jpg', 'jpeg'] }],
  })
  return Array.isArray(paths) ? paths : paths ? [paths] : []
}

/** 桌面端读取文件字节。 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const fs = await import('@tauri-apps/plugin-fs')
  return await fs.readFile(path)
}

export async function writeFilesToDir(
  dir: string,
  files: { name: string; bytes: ArrayBuffer }[],
): Promise<void> {
  const { join } = await import('@tauri-apps/api/path')
  const fs = await import('@tauri-apps/plugin-fs')
  for (const f of files) {
    await fs.writeFile(await join(dir, f.name), new Uint8Array(f.bytes))
  }
}

export async function saveZip(
  suggestedName: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (!path) return null
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.writeFile(path, bytes)
    return path
  }
  downloadBlob(bytes, suggestedName)
  return null
}

export async function fetchImageBlob(url: string): Promise<Blob> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const res = await tauriFetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.blob()
  }
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('链接内容不是图片')
  return blob
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path)
}

function downloadBlob(bytes: BlobPart, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
