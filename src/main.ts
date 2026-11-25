import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { isMacDesktop, revealMainWindow } from './core/platform'
import './styles/tokens.css'
import './styles/base.css'

// macOS 用系统原生红绿灯（窗口保留原生装饰，见 tauri.macos.conf.json）。
// 给标题栏 / 工作室 / 设置页留出按钮占位，其余平台为 0。
if (isMacDesktop) document.documentElement.style.setProperty('--traffic-light-inset', '78px')

// 样式已加载：首帧（index.html 内联脚本）写入的主题底色交还给 --bg，
// 之后在设置里切换主题时背景才能跟着变
document.documentElement.style.removeProperty('background-color')

createApp(App).use(createPinia()).mount('#app')

// 窗口以 hidden 创建：主题与首帧 DOM 就绪后再显示，消除窗口级白屏
void revealMainWindow()
