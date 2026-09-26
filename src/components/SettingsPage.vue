<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, Check, Download, ExternalLink, HardDrive, LoaderCircle } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { pickDirectory, executableDir, appDataDir, isTauri } from '@/core/platform'
import { openReleasePage, checkForUpdate, type UpdateInfo } from '@/core/updater'
import { APP_VERSION } from '@/core/version'
import { FONT_CATEGORY_LABELS, useFontsStore, type FontCategory } from '@/stores/fonts'
import { useSettingsStore, type PreviewQuality, type ThemeMode } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'

const emit = defineEmits<{ back: [] }>()

const settings = useSettingsStore()
const ws = useWorkspaceStore()
const fonts = useFontsStore()

const themeModel = computed({
  get: () => settings.theme,
  set: (v: unknown) => (settings.theme = v as ThemeMode),
})

const qualityModel = computed({
  get: () => settings.previewQuality,
  set: (v: unknown) => (settings.previewQuality = v as PreviewQuality),
})

const minZoomModel = computed({
  get: () => Math.round(settings.minZoom * 100),
  set: (v: number) => (settings.minZoom = Math.round(v) / 100),
})

const hasCustomFont = computed(() => !!settings.fontFamily)

function onFontFocus(): void {
  void fonts.ensureFonts()
}

/* ---------- 检查更新 ---------- */

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'error'
const updateState = ref<UpdateState>('idle')
const updateInfo = ref<UpdateInfo | null>(null)

async function checkUpdate(): Promise<void> {
  updateState.value = 'checking'
  updateInfo.value = null
  try {
    const info = await checkForUpdate()
    updateInfo.value = info
    updateState.value = info ? 'available' : 'latest'
  } catch {
    updateState.value = 'error'
  }
}

/* ---------- 数据位置（仅桌面） ---------- */

const dataDirShown = ref('')
onMounted(async () => {
  if (isTauri) {
    try {
      const { join } = await import('@tauri-apps/api/path')
      const base = settings.dataDir || (await executableDir()) || (await appDataDir())
      dataDirShown.value = await join(base, 'AlbumarkData')
    } catch {
      dataDirShown.value = settings.dataDir
    }
  }
})

async function changeDataDir(): Promise<void> {
  const dir = await pickDirectory('选择软件数据位置')
  if (dir) {
    settings.dataDir = dir
    dataDirShown.value = dir
    void ws.init()
  }
}

async function relaunchOobe(): Promise<void> {
  settings.oobeDone = false
  emit('back')
}
</script>

<template>
  <div class="page">
    <header class="head material" data-tauri-drag-region>
      <AppButton variant="ghost" size="sm" @click="emit('back')"><ArrowLeft :size="14" />返回</AppButton>
      <h1>设置</h1>
      <span class="flex" />
    </header>

    <div class="body">
      <section class="group">
        <h2>外观</h2>
        <div class="row">
          <div class="text">
            <span class="label">主题</span>
          </div>
          <AppSegment
            v-model="themeModel"
            :options="[
              { value: 'auto', label: '跟随系统' },
              { value: 'dark', label: '深色' },
              { value: 'light', label: '浅色' },
            ]"
          />
        </div>
        <div class="row col">
          <div class="text">
            <span class="label">显示字体</span>
          </div>
          <select
            class="select"
            :value="settings.fontFamily"
            @focus="onFontFocus"
            @pointerdown="onFontFocus"
            @change="settings.fontFamily = ($event.target as HTMLSelectElement).value"
          >
            <option value="">系统默认</option>
            <optgroup
              v-for="g in fonts.grouped()"
              :key="g.category"
              :label="FONT_CATEGORY_LABELS[g.category as FontCategory]"
            >
              <option v-for="f in g.items" :key="f.family" :value="f.family">
                {{ f.family }}
              </option>
            </optgroup>
          </select>
          <p v-if="fonts.loading" class="note">正在读取系统字体…</p>
          <p v-else-if="fonts.denied && hasCustomFont" class="note">
            浏览器未授权读取系统字体，列表为常用字体清单。
          </p>
        </div>
      </section>

      <section class="group">
        <h2>预览</h2>
        <div class="row col">
          <div class="text">
            <span class="label">预览安全区</span>
          </div>
          <AppSlider
            v-model="minZoomModel"
            :min="30"
            :max="100"
            :step="5"
            label="最小缩放"
            :format="(v) => `${v}%`"
            :default="100"
            title="双击复位"
            @reset="settings.minZoom = 1"
          />
        </div>
        <div class="row col">
          <div class="text">
            <span class="label">渲染质量</span>
          </div>
          <AppSegment
            v-model="qualityModel"
            :options="[
              { value: 'high', label: '高质量' },
              { value: 'balanced', label: '均衡' },
              { value: 'eco', label: '省电' },
            ]"
          />
        </div>
      </section>

      <section class="group">
        <h2>水印与导入</h2>
        <div class="row">
          <div class="text">
            <span class="label">水印吸附</span>
          </div>
          <AppSwitch v-model="settings.wmSnap" />
        </div>
        <div class="row">
          <div class="text">
            <span class="label">EXIF 缺失提醒</span>
          </div>
          <AppSwitch v-model="settings.exifNotice" />
        </div>
      </section>

      <section v-if="isTauri" class="group">
        <h2>数据</h2>
        <div class="row col">
          <div class="text">
            <span class="label">软件数据位置</span>
            <p class="desc mono">{{ dataDirShown || '…' }}</p>
          </div>
          <div class="btns">
            <AppButton size="sm" @click="changeDataDir"><HardDrive :size="13" />更改…</AppButton>
            <AppButton size="sm" variant="ghost" @click="relaunchOobe">重新运行引导</AppButton>
          </div>
        </div>
      </section>

      <section class="group">
        <h2>关于</h2>
        <div class="row">
          <div class="text">
            <span class="label">版本</span>
            <p class="desc">v{{ APP_VERSION }}</p>
          </div>
          <div class="btns">
            <template v-if="updateState === 'available' && updateInfo">
              <span class="update-hint"><Check :size="13" />新版本 v{{ updateInfo.version }}</span>
              <AppButton size="sm" variant="primary" @click="openReleasePage(updateInfo.url)">
                <Download :size="13" />前往下载
              </AppButton>
            </template>
            <template v-else>
              <span v-if="updateState === 'latest'" class="update-hint">
                <Check :size="13" />已是最新版本
              </span>
              <span v-else-if="updateState === 'error'" class="update-hint err">检查失败，稍后再试</span>
              <AppButton size="sm" :disabled="updateState === 'checking'" @click="checkUpdate">
                <LoaderCircle v-if="updateState === 'checking'" :size="13" class="spin" />
                <Download v-else :size="13" />检查更新
              </AppButton>
            </template>
          </div>
        </div>
        <div class="row">
          <div class="text">
            <span class="label">项目主页</span>
            <p class="desc">github.com/MogroWangStudio/Albumark</p>
          </div>
          <AppButton size="sm" variant="ghost" @click="openReleasePage('https://github.com/MogroWangStudio/Albumark')">
            <ExternalLink :size="13" />打开
          </AppButton>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  /* 顶部避开状态栏（安卓全面屏下页面从屏幕最顶端开始） */
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right)) 10px calc(12px + var(--safe-left));
  border-bottom: 1px solid var(--line);
  flex: none;
  user-select: none;
}
.head h1 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.flex {
  flex: 1;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 16px calc(28px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}
.group {
  width: min(640px, 100%);
  padding: 16px 18px;
  border-radius: var(--r-l);
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
}
.group h2 {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-3);
  margin-bottom: 4px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.text {
  min-width: 0;
}
.label {
  font-size: 13px;
}
.desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}
.desc.mono {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.select {
  width: 100%;
  height: var(--control-h);
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: 12.5px;
  color: var(--text);
}
.select:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.note {
  font-size: 11.5px;
  color: var(--text-3);
}
.update-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ok);
}
.update-hint.err {
  color: var(--danger);
}
.spin {
  animation: rotate 0.9s linear infinite;
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation-duration: 1.6s;
  }
}
</style>
