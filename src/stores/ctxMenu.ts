import { ref } from 'vue'
import type { ContextMenuItem } from '@/components/AppContextMenu.vue'

/**
 * 全局上下文菜单的共享状态（照 toast 的模块级模式，非 pinia）。
 * App.vue 挂载唯一的 <AppContextMenu> 实例，任何组件都可以在这里
 * 打开菜单——右键（预览 / 缩略图）与移动端长按（工作目录 / 项目）
 * 走同一条通路，安卓返回键与 Escape 的关闭处理只需看这里。
 */
export const ctxMenu = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

export function openCtxMenu(x: number, y: number, items: ContextMenuItem[]): void {
  ctxMenu.value = { x, y, items }
}

export function closeCtxMenu(): void {
  ctxMenu.value = null
}
