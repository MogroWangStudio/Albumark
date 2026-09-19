import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.mws.albumark',
  appName: '辑印',
  webDir: 'dist',
  plugins: {
    // Capacitor 8 SystemBars：页面确定使用 viewport-fit=cover，
    // insets 以 CSS 变量（--safe-area-inset-*）透传给前端，避免首帧布局跳动
    SystemBars: {
      initialViewportFitValueHint: 'cover',
      insetsHandling: 'css',
    },
  },
}

export default config
