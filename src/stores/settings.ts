import { ref, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { registerPlugin } from '@capacitor/core'
import { isCapacitor, isTauri } from '@/core/platform'

export type ThemeMode = 'auto' | 'dark' | 'light'
export type PreviewQuality = 'high' | 'balanced' | 'eco'

export interface AppSettings {
  /** 外观主题：auto 跟随系统 */
  theme: ThemeMode
  /** 界面显示字体：字体族名；空 = 系统默认栈 */
  fontFamily: string
  /** 导入时提醒缺少 EXIF 元数据 */
  exifNotice: boolean
  /** 预览安全区：图片最小缩放值（1 = 适应窗口，可小于 1 缩得更小） */
  minZoom: number
  /** 预览渲染质量：影响精修分辨率与 DPR 上限（低端设备可调低省电） */
  previewQuality: PreviewQuality
  /** 水印拖动吸附与参考线 */
  wmSnap: boolean
  /** 软件数据目录（桌面端 OOBE 设置；空 = 便携版 exe 根目录） */
  dataDir: string
  /** 首次启动引导已完成 */
  oobeDone: boolean
}

const PERSIST_KEY = 'albumark.settings.v1'
const DEFAULTS: AppSettings = {
  theme: 'auto',
  fontFamily: '',
  exifNotice: true,
  minZoom: 1,
  previewQuality: 'high',
  wmSnap: true,
  dataDir: '',
  // 非桌面端没有本地数据目录概念，直接跳过引导
  oobeDone: !isTauri,
}

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
  const initial = load()
  const theme = ref<ThemeMode>(initial.theme)
  const fontFamily = ref(initial.fontFamily)
  const exifNotice = ref(initial.exifNotice)
  const minZoom = ref(initial.minZoom)
  const previewQuality = ref<PreviewQuality>(initial.previewQuality)
  const wmSnap = ref(initial.wmSnap)
  const dataDir = ref(initial.dataDir)
  const oobeDone = ref(initial.oobeDone)

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

  function persist(): void {
    try {
      window.localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({
          theme: theme.value,
          fontFamily: fontFamily.value,
          exifNotice: exifNotice.value,
          minZoom: minZoom.value,
          previewQuality: previewQuality.value,
          wmSnap: wmSnap.value,
          dataDir: dataDir.value,
          oobeDone: oobeDone.value,
        }),
      )
    } catch {
      /* 忽略写入失败 */
    }
  }

  function applyTheme(): void {
    const eff = theme.value === 'auto' ? (systemDark.matches ? 'dark' : 'light') : theme.value
    document.documentElement.dataset.theme = eff
  }

  /** 自定义显示字体：写覆盖 --font，引用默认栈作后备；空值恢复默认 */
  function applyFont(): void {
    const family = fontFamily.value.trim()
    const rootStyle = document.documentElement.style
    if (family) rootStyle.setProperty('--font', `"${family}", var(--font-fallback)`)
    else rootStyle.removeProperty('--font')
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
    applyFont()
    persist()
    void syncSystemBars()
  })

  systemDark.addEventListener('change', () => {
    if (theme.value === 'auto') applyTheme()
  })

  return {
    theme,
    fontFamily,
    exifNotice,
    minZoom,
    previewQuality,
    wmSnap,
    dataDir,
    oobeDone,
  }
})
