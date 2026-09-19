import { ref, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { registerPlugin } from '@capacitor/core'
import { isCapacitor } from '@/core/platform'

export type ThemeMode = 'auto' | 'dark' | 'light'

export interface AppSettings {
  /** 外观主题：auto 跟随系统 */
  theme: ThemeMode
  /** 导入时提醒缺少 EXIF 元数据 */
  exifNotice: boolean
}

const PERSIST_KEY = 'albumark.settings.v1'
const DEFAULTS: AppSettings = { theme: 'auto', exifNotice: true }

function load(): AppSettings {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    /* 忽略损坏数据 */
  }
  return { ...DEFAULTS }
}

/** Capacitor 8 内置 SystemBars 插件（仅安卓），用于让状态栏图标随主题切换。 */
interface SystemBarsPlugin {
  setStyle(opts: { style: string; bar?: string }): Promise<void>
}
const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(load().theme)
  const exifNotice = ref(load().exifNotice)

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

  function persist(): void {
    try {
      window.localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ theme: theme.value, exifNotice: exifNotice.value }),
      )
    } catch {
      /* 忽略写入失败 */
    }
  }

  function applyTheme(): void {
    const eff = theme.value === 'auto' ? (systemDark.matches ? 'dark' : 'light') : theme.value
    document.documentElement.dataset.theme = eff
  }

  async function syncSystemBars(): Promise<void> {
    if (!isCapacitor) return
    const style = theme.value === 'auto' ? 'DEFAULT' : theme.value === 'dark' ? 'DARK' : 'LIGHT'
    try {
      await SystemBars.setStyle({ style })
    } catch {
      /* 非安卓环境无此插件实现 */
    }
  }

  watchEffect(() => {
    applyTheme()
    persist()
    void syncSystemBars()
  })

  systemDark.addEventListener('change', () => {
    if (theme.value === 'auto') applyTheme()
  })

  return { theme, exifNotice }
})
