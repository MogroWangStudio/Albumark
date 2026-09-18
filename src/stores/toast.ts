import { reactive } from 'vue'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

export const toasts = reactive<Toast[]>([])

let seq = 0

export function toast(message: string, tone: Toast['tone'] = 'info'): void {
  const id = ++seq
  toasts.push({ id, message, tone })
  if (toasts.length > 4) toasts.shift()
  window.setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, 3400)
}
