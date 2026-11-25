import { ref, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { registerPlugin } from '@capacitor/core'
import { isCapacitor, isTauri, syncWindowBackground } from '@/core/platform'
import { createDebouncedSaver, loadJson, saveJson } from '@/core/storage'
import type { UpdateChannel, UpdateSource } from '@/core/updater'
import { detectLocale, type Locale } from '@/i18n/types'
import { currentLocale } from '@/i18n/locale'

export type ThemeMode =
  | 'auto'
  | 'dark'
  | 'light'
  | 'darkroom'
  | 'cyanotype'
  | 'infrared'
  | 'silver'
  | 'paper'
  | 'gallery'
  | 'daguerre'
  | 'chlorophyll'
/**
 * 预览渲染质量：自适应 / 五档预设 / custom（自定义档位）。
 * 自适应按当前缩放实时决定渲染分辨率：放大补精度，缩小降分辨率；
 * 自定义时 previewQualityValue 为精修长边像素，即时档与叠加层密度随之派生。
 */
export type PreviewQuality = 'adaptive' | 'ultra' | 'high' | 'balanced' | 'eco' | 'minimal' | 'custom'

/** 渲染质量选项：设置页与存档校验共用同一份清单 */
export const PREVIEW_QUALITIES: { value: PreviewQuality; label: string }[] = [
  { value: 'adaptive', label: '自适应' },
  { value: 'ultra', label: '极致' },
  { value: 'high', label: '高质量' },
  { value: 'balanced', label: '均衡' },
  { value: 'eco', label: '省电' },
  { value: 'minimal', label: '极省' },
  { value: 'custom', label: '自定义' },
]

/** 自定义预览精度的取值范围（精修长边像素） */
export const PREVIEW_CUSTOM_MIN = 600
export const PREVIEW_CUSTOM_MAX = 2400

/** 更新渠道选项：设置页分段控件与存档校验共用同一份清单 */
export const UPDATE_CHANNELS: { value: UpdateChannel; label: string }[] = [
  { value: 'stable', label: '稳定通道' },
  { value: 'beta', label: '测试通道' },
]

/** 更新下载线路：直连 GitHub，或经 gh-proxy 加速代理（设置页下拉菜单与存档校验共用） */
export const UPDATE_SOURCES: { value: UpdateSource; label: string; hint: string }[] = [
  { value: 'github', label: 'GitHub 直连', hint: '直接连接 github.com' },
  { value: 'proxy', label: 'GitHub 代理', hint: '经 gh-proxy.org 加速' },
]

export interface ThemeDef {
  id: ThemeMode
  label: string
  /** 一句话来历，悬停展示 */
  hint: string
  /** 解析后的明暗：画布投影、安卓状态栏等 JS 判断用 */
  mode: 'light' | 'dark'
  /** 设置页色卡：界面底 / 照片区 / 强调色 / 文字色（微缩界面示意用） */
  swatch: { bg: string; canvas: string; accent: string; text: string; text2: string }
}

/** 全部主题：auto/dark/light 之外，八款取自摄影与印相工艺 */
export const THEMES: ThemeDef[] = [
  {
    id: 'auto',
    label: '跟随系统',
    hint: '浅色 / 深色随系统切换',
    mode: 'dark',
    swatch: {
      bg: '#ffffff',
      canvas: '#141210',
      accent: '#ffa72f',
      text: 'linear-gradient(115deg, #26221e 0 50%, #f0ede8 50% 100%)',
      text2: 'linear-gradient(115deg, #9c948a 0 50%, #7a746c 50% 100%)',
    },
  },
  {
    id: 'light',
    label: '浅色',
    hint: '纯白底，照片是唯一焦点',
    mode: 'light',
    swatch: { bg: '#ffffff', canvas: '#efedea', accent: '#ffa72f', text: '#26221e', text2: '#9c948a' },
  },
  {
    id: 'dark',
    label: '深色',
    hint: '纯黑底，照片更突出',
    mode: 'dark',
    swatch: { bg: '#000000', canvas: '#161310', accent: '#ffa72f', text: '#f0ede8', text2: '#7a746c' },
  },
  {
    id: 'darkroom',
    label: '暗房',
    hint: '放大机旁的相纸台：暖黑墙面、安全灯余烬',
    mode: 'dark',
    swatch: { bg: '#17120e', canvas: '#0d0a07', accent: '#e06b3a', text: '#f1e7da', text2: '#837463' },
  },
  {
    id: 'cyanotype',
    label: '蓝晒',
    hint: '普鲁士蓝上晒出的白影',
    mode: 'dark',
    swatch: { bg: '#0d1b28', canvas: '#081420', accent: '#5fa8cc', text: '#dde9f3', text2: '#5e7c93' },
  },
  {
    id: 'infrared',
    label: '红外',
    hint: '红外胶片的品红幻影',
    mode: 'dark',
    swatch: { bg: '#180d12', canvas: '#120a0e', accent: '#d0608a', text: '#f2e6ec', text2: '#826876' },
  },
  {
    id: 'silver',
    label: '银盐',
    hint: '硒调银盐相纸的冷黑与灰紫',
    mode: 'dark',
    swatch: { bg: '#0f1012', canvas: '#0a0b0d', accent: '#a583a0', text: '#eceaf0', text2: '#767482' },
  },
  {
    id: 'paper',
    label: '纸墨',
    hint: '宣纸、墨字、一枚朱砂印',
    mode: 'light',
    swatch: { bg: '#f5f0e6', canvas: '#ebe5d7', accent: '#c2412a', text: '#2e281f', text2: '#a3977f' },
  },
  {
    id: 'gallery',
    label: '画廊',
    hint: '展墙、卡纸与黄铜牌',
    mode: 'light',
    swatch: { bg: '#efebe3', canvas: '#e5e0d5', accent: '#86641f', text: '#221d15', text2: '#9a9080' },
  },
  {
    id: 'daguerre',
    label: '银版',
    hint: '达盖尔银版：冷银灰上一点钴蓝',
    mode: 'light',
    swatch: { bg: '#f1f2f4', canvas: '#e7e9ec', accent: '#4a6fa5', text: '#1f2530', text2: '#8f9aab' },
  },
  {
    id: 'chlorophyll',
    label: '叶绿素',
    hint: '叶片上晒出的绿影',
    mode: 'light',
    swatch: { bg: '#f0f1e6', canvas: '#e5e8d6', accent: '#5d7a3a', text: '#27301c', text2: '#96a07e' },
  },
]

/** 启动动画款式：勾勒（默认三段式）/ 快门 / 显影 / 闪光 / 遮幅 / 对焦 / 推移 / 叠影 */
export type BootStyle =
  | 'default'
  | 'shutter'
  | 'develop'
  | 'flash'
  | 'bars'
  | 'focus'
  | 'slide'
  | 'double'

/** 启动动画选择：具体款式，或每次启动随机抽一款 */
export type BootStyleChoice = BootStyle | 'random'

const BOOT_STYLES: { value: BootStyle; label: string; hint: string }[] = [
  { value: 'default', label: '勾勒', hint: '线条勾勒，颜色填入' },
  { value: 'shutter', label: '快门', hint: '黑幕收开，露出界面' },
  { value: 'develop', label: '显影', hint: '影像在药水中浮现' },
  { value: 'flash', label: '闪光', hint: '快门灯一闪而过' },
  { value: 'bars', label: '遮幅', hint: '上下黑边退开' },
  { value: 'focus', label: '对焦', hint: '取景框收拢合焦' },
  { value: 'slide', label: '推移', hint: '整幅画面上移' },
  { value: 'double', label: '叠影', hint: '两重影像叠合' },
]

/** 款式选项（含随机）：设置页的卡片列表与随机抽样共用同一份清单 */
export const BOOT_STYLE_CHOICES: { value: BootStyleChoice; label: string; hint: string }[] = [
  ...BOOT_STYLES,
  { value: 'random', label: '随机', hint: '每次启动随机一款' },
]

/** 启动动画时长（毫秒）：所有款式的时间轴按这个总长等比缩放 */
export const BOOT_DURATION_MIN = 800
export const BOOT_DURATION_MAX = 3000
export const BOOT_DURATION_DEFAULT = 1500

/** 把设置里的选择解析成实际款式：随机时在这里抽一次 */
export function pickBootStyle(choice: BootStyleChoice): BootStyle {
  if (choice !== 'random') return choice
  const pool = BOOT_STYLES
  return pool[Math.floor(Math.random() * pool.length)].value
}

interface AppSettings {
  /** 界面语言：首次按系统语言选择，可在设置里随时切换 */
  locale: Locale
  /** 外观主题：auto 跟随系统 */
  theme: ThemeMode
  /** 界面显示字体：字体族名；空 = 系统默认栈 */
  fontFamily: string
  /** 界面字号缩放：0.9 小 / 1 标准 / 1.1 大 / 1.25 特大 */
  uiZoom: number
  /** 启动动画：关闭后直接进入主界面 */
  bootEnabled: boolean
  /** 启动动画款式（random = 每次启动随机） */
  bootStyle: BootStyleChoice
  /** 启动动画总时长（毫秒） */
  bootDuration: number
  /** 导入时提醒缺少 EXIF 元数据 */
  exifNotice: boolean
  /** 预览安全区：图片最小缩放值（1 = 适应窗口，可小于 1 缩得更小） */
  minZoom: number
  /**
   * 默认缩放：首次查看图片时的缩放大小，100 = 适应窗口（与缩放档位同一语义），
   * 30–300。只在打开项目后的第一张 / 重新进入照片时生效，浏览切图保持当前缩放。
   */
  defaultZoom: number
  /**
   * 放大平移安全区（像素）：放大后照片边缘保留的呼吸边距。
   * 0 = 可以一直平移到贴边；数值越大，可平移查看的最大边距越小。
   */
  panMargin: number
  /** 预览渲染质量：预设档位或 custom（配合 previewQualityValue 无极调整） */
  previewQuality: PreviewQuality
  /** 自定义预览精度：精修长边像素（仅 previewQuality = 'custom' 时生效） */
  previewQualityValue: number
  /** 水印拖动吸附与参考线 */
  wmSnap: boolean
  /** 更新渠道：stable 只看正式 Release，beta 连 Pre-Release 一起看 */
  updateChannel: UpdateChannel
  /** 更新下载线路：github 直连 / proxy 经 gh-proxy 加速 */
  updateSource: UpdateSource
  /** 软件数据目录（桌面端 OOBE 设置；空 = 便携版 exe 根目录） */
  dataDir: string
  /** 首次启动引导已完成 */
  oobeDone: boolean
}

const PERSIST_KEY = 'albumark.settings.v1'
const DEFAULTS: AppSettings = {
  locale: detectLocale(),
  theme: 'auto',
  fontFamily: '',
  uiZoom: 1,
  bootEnabled: true,
  bootStyle: 'default',
  bootDuration: BOOT_DURATION_DEFAULT,
  exifNotice: true,
  minZoom: 1,
  defaultZoom: 100,
  panMargin: 12,
  previewQuality: 'high',
  previewQualityValue: 1200,
  wmSnap: true,
  updateChannel: 'stable',
  updateSource: 'github',
  dataDir: '',
  // 非桌面端没有本地数据目录概念，直接跳过引导
  oobeDone: !isTauri,
}

function load(): AppSettings {
  const parsed = loadJson<Partial<AppSettings>>(PERSIST_KEY, {})
  const data = { ...DEFAULTS, ...parsed }
  // 语言：未知值（旧存档 / 手改）回落到系统语言
  if (!['zh-CN', 'en', 'ja', 'ko'].includes(data.locale)) data.locale = DEFAULTS.locale
  // 默认缩放夹回档位
  const dz = Number(data.defaultZoom)
  data.defaultZoom = Number.isFinite(dz) ? Math.min(300, Math.max(30, Math.round(dz / 5) * 5)) : 100
  const pm = Number(data.panMargin)
  data.panMargin = Number.isFinite(pm) ? Math.min(200, Math.max(0, Math.round(pm))) : 12
  // 旧版本 / 手改存档的容错：款式必须存在，时长夹回档位并取整到 100ms
  if (!BOOT_STYLE_CHOICES.some((s) => s.value === data.bootStyle)) data.bootStyle = DEFAULTS.bootStyle
  const dur = Number(data.bootDuration)
  data.bootDuration = Number.isFinite(dur)
    ? Math.min(BOOT_DURATION_MAX, Math.max(BOOT_DURATION_MIN, Math.round(dur / 100) * 100))
    : BOOT_DURATION_DEFAULT
  // 渲染质量同理：未知档位回落到默认，自定义精度夹回范围并取整到 50px
  if (!PREVIEW_QUALITIES.some((q) => q.value === data.previewQuality)) {
    data.previewQuality = DEFAULTS.previewQuality
  }
  const pq = Number(data.previewQualityValue)
  data.previewQualityValue = Number.isFinite(pq)
    ? Math.min(PREVIEW_CUSTOM_MAX, Math.max(PREVIEW_CUSTOM_MIN, Math.round(pq / 50) * 50))
    : DEFAULTS.previewQualityValue
  // 更新渠道：未知值回落稳定通道
  if (!UPDATE_CHANNELS.some((c) => c.value === data.updateChannel)) {
    data.updateChannel = DEFAULTS.updateChannel
  }
  // 下载线路：未知值回落直连
  if (!UPDATE_SOURCES.some((s) => s.value === data.updateSource)) {
    data.updateSource = DEFAULTS.updateSource
  }
  return data
}

/** Capacitor 8 内置 SystemBars 插件（仅安卓），用于让状态栏图标随主题切换。 */
interface SystemBarsPlugin {
  setStyle(opts: { style: string; bar?: string }): Promise<void>
}
const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

export const useSettingsStore = defineStore('settings', () => {
  const initial = load()
  // 界面语言放在 i18n 的共享 ref：core 层（原生对话框标题等）也能读，
  // 不经过 Pinia，避免 settings、platform、i18n 三者的循环依赖
  const locale = currentLocale
  locale.value = initial.locale
  const theme = ref<ThemeMode>(initial.theme)
  const fontFamily = ref(initial.fontFamily)
  const uiZoom = ref(initial.uiZoom)
  const bootEnabled = ref(initial.bootEnabled)
  const bootStyle = ref<BootStyleChoice>(initial.bootStyle)
  const bootDuration = ref(initial.bootDuration)
  const exifNotice = ref(initial.exifNotice)
  const minZoom = ref(initial.minZoom)
  const defaultZoom = ref(initial.defaultZoom)
  const panMargin = ref(initial.panMargin)
  const previewQuality = ref<PreviewQuality>(initial.previewQuality)
  const previewQualityValue = ref(initial.previewQualityValue)
  const wmSnap = ref(initial.wmSnap)
  const updateChannel = ref<UpdateChannel>(initial.updateChannel)
  const updateSource = ref<UpdateSource>(initial.updateSource)
  const dataDir = ref(initial.dataDir)
  const oobeDone = ref(initial.oobeDone)

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

  function persist(): void {
    saveJson(PERSIST_KEY, {
      locale: locale.value,
      theme: theme.value,
      fontFamily: fontFamily.value,
      uiZoom: uiZoom.value,
      bootEnabled: bootEnabled.value,
      bootStyle: bootStyle.value,
      bootDuration: bootDuration.value,
      exifNotice: exifNotice.value,
      minZoom: minZoom.value,
      defaultZoom: defaultZoom.value,
      panMargin: panMargin.value,
      previewQuality: previewQuality.value,
      previewQualityValue: previewQualityValue.value,
      wmSnap: wmSnap.value,
      updateChannel: updateChannel.value,
      updateSource: updateSource.value,
      dataDir: dataDir.value,
      oobeDone: oobeDone.value,
    })
  }

  /** auto 跟随系统解析出的明暗；个性主题取注册表里的固定 mode */
  function resolveMode(): 'light' | 'dark' {
    if (theme.value === 'auto') return systemDark.matches ? 'dark' : 'light'
    return THEMES.find((t) => t.id === theme.value)?.mode ?? 'dark'
  }

  function applyTheme(): void {
    const eff = theme.value === 'auto' ? (systemDark.matches ? 'dark' : 'light') : theme.value
    document.documentElement.dataset.theme = eff
    document.documentElement.dataset.mode = resolveMode()
    // 原生窗口/WebView 背景跟随主题：缩放窗口、切主题时边缘不再露出白底
    syncWindowBackground(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  }

  /** 界面语言：同步 <html lang>（排版断行 / 字体回退 / 无障碍朗读都依赖它） */
  function applyLocale(): void {
    document.documentElement.lang = locale.value
  }

  /** 自定义显示字体：写覆盖 --font，引用默认栈作后备；空值恢复默认 */
  function applyFont(): void {
    const family = fontFamily.value.trim()
    const rootStyle = document.documentElement.style
    if (family) rootStyle.setProperty('--font', `"${family}", var(--font-fallback)`)
    else rootStyle.removeProperty('--font')
  }

  /** 界面字号缩放：全局 font-size 与控件高度都乘这个系数（见 --ui-zoom） */
  function applyZoom(): void {
    document.documentElement.style.setProperty('--ui-zoom', String(uiZoom.value))
  }

  async function syncSystemBars(): Promise<void> {
    if (!isCapacitor) return
    // auto 交给系统原生跟随；手动主题按解析出的明暗设图标色
    const style = theme.value === 'auto' ? 'DEFAULT' : resolveMode() === 'dark' ? 'DARK' : 'LIGHT'
    try {
      await SystemBars.setStyle({ style })
    } catch {
      /* 非安卓环境无此插件实现 */
    }
  }

  /* persist 走防抖：拖滑杆（时长 / 质量值 / 字号）等连续变更曾每帧同步
     JSON.stringify + 写 localStorage（主线程阻塞 I/O），合并为静默 300ms
     一次；beforeunload flush 保证退出前落盘 */
  const persistSaver = createDebouncedSaver(persist, 300)
  window.addEventListener('beforeunload', () => {
    persistSaver.flush()
  })

  watchEffect(() => {
    applyLocale()
    applyTheme()
    applyFont()
    applyZoom()
    persistSaver.schedule()
    void syncSystemBars()
  })

  systemDark.addEventListener('change', () => {
    if (theme.value === 'auto') applyTheme()
  })

  return {
    locale,
    theme,
    fontFamily,
    uiZoom,
    bootEnabled,
    bootStyle,
    bootDuration,
    exifNotice,
    minZoom,
    defaultZoom,
    panMargin,
    previewQuality,
    previewQualityValue,
    wmSnap,
    updateChannel,
    updateSource,
    dataDir,
    oobeDone,
  }
})
