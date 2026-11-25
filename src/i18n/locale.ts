import { ref } from 'vue'
import type { Locale } from './types'

/**
 * 全局界面语言：独立于 Pinia store 的共享响应式值。
 * i18n 只读它，settings store 负责写入与持久化——这样 core 层（如原生文件
 * 对话框标题）也能安全调用 `t()`，不会形成「settings → platform → i18n →
 * settings」的循环依赖。
 */
export const currentLocale = ref<Locale>('zh-CN')
