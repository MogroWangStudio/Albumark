import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { isMacDesktop } from './core/platform'
import './styles/tokens.css'
import './styles/base.css'

// macOS 用系统原生红绿灯（窗口保留原生装饰，见 tauri.macos.conf.json）。
// 给标题栏 / 工作室 / 设置页留出按钮占位，其余平台为 0。
if (isMacDesktop) document.documentElement.style.setProperty('--traffic-light-inset', '78px')

createApp(App).use(createPinia()).mount('#app')
