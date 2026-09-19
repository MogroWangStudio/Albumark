import { ref } from 'vue'
import { defineStore } from 'pinia'

/** 字体分类：按书写体系分组，等宽单独一类方便选等宽字体做排版 */
export type FontCategory = 'zh' | 'latin' | 'ja' | 'ko' | 'mono' | 'other'

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  zh: '中文',
  latin: '西文',
  ja: '日文',
  ko: '韩文',
  mono: '等宽',
  other: '其他',
}

export interface FontEntry {
  family: string
  category: FontCategory
}

const ZH_RE =
  /pingfang|hiragino sans gb|heiti|songti|stsong|simsun|nsimsun|simhei|kaiti|stkaiti|stkaisong|fangsong|stfangsong|yahei|yahei ui|dengxian|yuan ti|lihei|noto.*(sc|cjk(?!.*(jp|kr))|hans|hk)|source han|思源|苹方|冬青|黑体|宋体|楷体|仿宋|雅黑|圆体|隶书|魏碑|行楷|告示字体/i
const JA_RE =
  /(^|[^a-z])jp\b|gothic(?! *(sc|cjk|neo|pro.*(gb|cjk))|.*sc)|mincho|meiryo|meiryo ui|yu gothic|yu mincho|hiragino (mincho|kaku|maru)|osaka|游ゴシック|游明朝|ゴシック|明朝|楷書|noto.*(jp)/i
const KO_RE =
  /nanum|malgun|gulim|gungsuh|batang|dotum|cheju|apple sd gothic|noto.*(kr)|koddi|han (sans|serif)|한국/i
const MONO_RE =
  /mono|consolas|menlo|courier|cascadia|jetbrains|fira code|source code|inconsolata|hack$|sf mono|pt mono|ubuntu mono|等距/i

function classify(family: string): FontCategory {
  if (MONO_RE.test(family)) return 'mono'
  if (ZH_RE.test(family)) return 'zh'
  if (JA_RE.test(family)) return 'ja'
  if (KO_RE.test(family)) return 'ko'
  if (/^[\x20-\x7E]+$/.test(family)) return 'latin'
  return 'other'
}

/** queryLocalFonts 不可用 / 被拒时的兜底清单（按平台常见字体整理） */
const FALLBACK: FontEntry[] = [
  { family: 'Microsoft YaHei', category: 'zh' },
  { family: 'SimSun', category: 'zh' },
  { family: 'SimHei', category: 'zh' },
  { family: 'KaiTi', category: 'zh' },
  { family: 'DengXian', category: 'zh' },
  { family: 'PingFang SC', category: 'zh' },
  { family: 'Songti SC', category: 'zh' },
  { family: 'Kaiti SC', category: 'zh' },
  { family: 'Hiragino Sans GB', category: 'zh' },
  { family: 'Arial', category: 'latin' },
  { family: 'Helvetica Neue', category: 'latin' },
  { family: 'Segoe UI', category: 'latin' },
  { family: 'Georgia', category: 'latin' },
  { family: 'Times New Roman', category: 'latin' },
  { family: 'Verdana', category: 'latin' },
  { family: 'Yu Gothic', category: 'ja' },
  { family: 'Meiryo', category: 'ja' },
  { family: 'MS Mincho', category: 'ja' },
  { family: 'Hiragino Mincho ProN', category: 'ja' },
  { family: 'Malgun Gothic', category: 'ko' },
  { family: 'Apple SD Gothic Neo', category: 'ko' },
  { family: 'Consolas', category: 'mono' },
  { family: 'Menlo', category: 'mono' },
  { family: 'Courier New', category: 'mono' },
]

/** 系统字体列表：首次打开字体选择器时经用户手势扫描（Local Font Access API）。 */
export const useFontsStore = defineStore('fonts', () => {
  const fonts = ref<FontEntry[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  /** 扫描被浏览器拒绝时置真，UI 据此提示可手动键入 */
  const denied = ref(false)

  function supportLocalFonts(): boolean {
    return typeof (window as { queryLocalFonts?: unknown }).queryLocalFonts === 'function'
  }

  async function ensureFonts(): Promise<void> {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      if (!supportLocalFonts()) {
        fonts.value = FALLBACK
        denied.value = true
        return
      }
      const data = await (
        window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }
      ).queryLocalFonts()
      const map = new Map<string, FontEntry>()
      for (const f of data) {
        if (!f.family || map.has(f.family)) continue
        map.set(f.family, { family: f.family, category: classify(f.family) })
      }
      fonts.value = [...map.values()].sort((a, b) =>
        a.family.localeCompare(b.family, 'zh-Hans'),
      )
      if (!fonts.value.length) {
        fonts.value = FALLBACK
        denied.value = true
      }
    } catch {
      fonts.value = FALLBACK
      denied.value = true
    } finally {
      loaded.value = true
      loading.value = false
    }
  }

  /** 分类 → 字体列表（保持字母序） */
  function grouped(): { category: FontCategory; items: FontEntry[] }[] {
    const order: FontCategory[] = ['zh', 'latin', 'ja', 'ko', 'mono', 'other']
    return order
      .map((category) => ({
        category,
        items: fonts.value.filter((f) => f.category === category),
      }))
      .filter((g) => g.items.length)
  }

  return { fonts, loaded, loading, denied, supportLocalFonts, ensureFonts, grouped }
})
