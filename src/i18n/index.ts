import { computed, type ComputedRef } from 'vue'
import { currentLocale } from './locale'
import en from './messages/en'
import ja from './messages/ja'
import ko from './messages/ko'
import type { Locale } from './types'

export { LANGUAGES, detectLocale } from './types'
export type { Locale } from './types'

/**
 * 翻译词条以「中文原文」为键：缺失翻译时原样回落到中文，界面永远不会显示
 * 裸键名。新增界面文案时直接 `t('中文原文')` 即可，再按需补 en / ja / ko。
 * 需要插值用 `{0}`、`{1}`（按参数顺序替换），例如 `t('已保存模板「{0}」', name)`。
 */
const DICTS: Record<Exclude<Locale, 'zh-CN'>, Record<string, string>> = {
  en: en as Record<string, string>,
  ja: ja as Record<string, string>,
  ko: ko as Record<string, string>,
}

function format(template: string, args: unknown[]): string {
  if (!args.length) return template
  return template.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = args[Number(i)]
    return v == null ? m : String(v)
  })
}

/** 不依赖 Pinia 上下文的纯函数版本（少数 store / core 场景直接调用） */
export function translate(locale: Locale, key: string, ...args: unknown[]): string {
  if (locale === 'zh-CN') return format(key, args)
  const hit = DICTS[locale]?.[key]
  return format(hit ?? key, args)
}

/**
 * 组件内翻译：读取当前语言偏好。t() 在渲染期被调用时会把 locale 记为依赖，
 * 切换语言后整页文案立即刷新，不需要逐组件订阅。
 */
export function useI18n(): {
  t: (key: string, ...args: unknown[]) => string
  locale: ComputedRef<Locale>
} {
  const locale = computed(() => currentLocale.value)
  const t = (key: string, ...args: unknown[]): string => translate(currentLocale.value, key, ...args)
  return { t, locale }
}

/** 非组件上下文（store / core）使用：同样跟随全局设置 */
export function t(key: string, ...args: unknown[]): string {
  return translate(currentLocale.value, key, ...args)
}
