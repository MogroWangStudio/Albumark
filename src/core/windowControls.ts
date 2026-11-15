import { isMacDesktop, isTauri } from './platform'

/**
 * 桌面自绘窗控：Windows/Linux 由前端画最小化 / 最大化 / 关闭三键
 * （无系统窗框，decorations: false），macOS 用系统红绿灯、前端不画。
 * 主界面顶栏与设置页等全屏覆盖页共用——覆盖页要自带窗控，
 * 否则盖住主顶栏后窗口就没有可用的窗口操作入口了。
 */
export function useWindowControls(): {
  visible: boolean
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
} {
  let win: { minimize(): void; toggleMaximize(): void; close(): void } | null = null
  if (isTauri) {
    void import('@tauri-apps/api/window').then((m) => {
      win = m.getCurrentWindow()
    })
  }
  return {
    visible: isTauri && !isMacDesktop,
    minimize: async () => {
      await win?.minimize()
    },
    toggleMaximize: async () => {
      await win?.toggleMaximize()
    },
    close: async () => {
      await win?.close()
    },
  }
}
