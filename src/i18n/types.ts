/** 支持的语言：首批四种，新增语言时同步注册表与 `messages/<locale>/` 目录 */
export type Locale = 'zh-CN' | 'en' | 'ja' | 'ko'

export const LANGUAGES: { value: Locale; label: string; hint: string }[] = [
  { value: 'zh-CN', label: '简体中文', hint: 'zh-CN' },
  { value: 'en', label: 'English', hint: 'en' },
  { value: 'ja', label: '日本語', hint: 'ja' },
  { value: 'ko', label: '한국어', hint: 'ko' },
]

/** 按系统语言挑一个受支持的语言；都不匹配时回落到简体中文 */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const list = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language]
  for (const raw of list) {
    const tag = (raw || '').toLowerCase()
    if (tag.startsWith('zh')) return 'zh-CN'
    if (tag.startsWith('ja')) return 'ja'
    if (tag.startsWith('ko')) return 'ko'
    if (tag.startsWith('en')) return 'en'
  }
  return 'zh-CN'
}
