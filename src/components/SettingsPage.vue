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
import {
  BOOT_STYLES,
  PREVIEW_CUSTOM_MAX,
  PREVIEW_CUSTOM_MIN,
  THEMES,
  useSettingsStore,
  type BootStyle,
  type PreviewQuality,
  type ThemeDef,
  type ThemeMode,
} from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'

const emit = defineEmits<{ back: [] }>()

const settings = useSettingsStore()
const ws = useWorkspaceStore()
const fonts = useFontsStore()

const themeModel = computed({
  get: () => settings.theme,
  set: (v: unknown) => (settings.theme = v as ThemeMode),
})

/** 跟随系统的色卡对半分亮暗，其余直接用主题自己的配色（含文字色） */
function swatchStyle(t: ThemeDef): Record<string, string> {
  if (t.id === 'auto') {
    return {
      '--sw-bg': 'linear-gradient(115deg, #ffffff 0 50%, #101010 50% 100%)',
      '--sw-canvas': 'linear-gradient(115deg, #ececea 0 50%, #24211d 50% 100%)',
      '--sw-accent': t.swatch.accent,
      '--sw-text': t.swatch.text,
      '--sw-text2': t.swatch.text2,
    }
  }
  return {
    '--sw-bg': t.swatch.bg,
    '--sw-canvas': t.swatch.canvas,
    '--sw-accent': t.swatch.accent,
    '--sw-text': t.swatch.text,
    '--sw-text2': t.swatch.text2,
  }
}

const zoomModel = computed({
  get: () => String(settings.uiZoom),
  set: (v: unknown) => (settings.uiZoom = Number(v)),
})

const bootStyleModel = computed({
  get: () => settings.bootStyle,
  set: (v: unknown) => (settings.bootStyle = v as BootStyle),
})

const qualityModel = computed({
  get: () => settings.previewQuality,
  set: (v: unknown) => (settings.previewQuality = v as PreviewQuality),
})

const qualityValueModel = computed({
  get: () => settings.previewQualityValue,
  set: (v: number) => (settings.previewQualityValue = v),
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
        <div class="row col">
          <div class="text">
            <span class="label">主题</span>
          </div>
          <div class="themes" role="radiogroup" aria-label="主题">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="theme"
              role="radio"
              :aria-checked="settings.theme === t.id"
              :title="t.hint"
              @click="themeModel = t.id"
            >
              <span class="swatch" :class="{ auto: t.id === 'auto' }" :style="swatchStyle(t)">
                <span class="ln" />
                <span class="ln2" />
                <span class="ph"><span class="dot" /></span>
              </span>
              <span class="t-label">{{ t.label }}</span>
            </button>
          </div>
        </div>
        <div class="row col">
          <div class="text">
            <span class="label">界面字号</span>
          </div>
          <AppSegment
            v-model="zoomModel"
            :options="[
              { value: '0.9', label: '小' },
              { value: '1', label: '标准' },
              { value: '1.1', label: '大' },
              { value: '1.25', label: '特大' },
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
        <div class="row">
          <div class="text">
            <span class="label">启动动画</span>
            <p class="desc">启动时的品牌动画，关闭后直接进入界面</p>
          </div>
          <AppSwitch v-model="settings.bootEnabled" />
        </div>
        <div v-if="settings.bootEnabled" class="row col">
          <div class="text">
            <span class="label">动画款式</span>
          </div>
          <AppSegment v-model="bootStyleModel" :options="BOOT_STYLES" />
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
              { value: 'ultra', label: '极致' },
              { value: 'high', label: '高质量' },
              { value: 'balanced', label: '均衡' },
              { value: 'eco', label: '省电' },
              { value: 'minimal', label: '极省' },
              { value: 'custom', label: '自定义' },
            ]"
          />
          <AppSlider
            v-if="settings.previewQuality === 'custom'"
            v-model="qualityValueModel"
            :min="PREVIEW_CUSTOM_MIN"
            :max="PREVIEW_CUSTOM_MAX"
            :step="50"
            label="预览精度"
            :format="(v) => `${v} px`"
            :default="1200"
            @reset="settings.previewQualityValue = 1200"
          />
          <p class="note">
            预览精度是放大查看时的渲染长边（像素）：越高越清晰，耗电与发热越高；
            导出始终使用原图全分辨率，不受此设置影响。
          </p>
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
  font-size: calc(15px * var(--ui-zoom, 1));
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
  font-size: calc(12px * var(--ui-zoom, 1));
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
  font-size: calc(13px * var(--ui-zoom, 1));
}
.desc {
  margin-top: 2px;
  font-size: calc(11.5px * var(--ui-zoom, 1));
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
  font-size: calc(12.5px * var(--ui-zoom, 1));
  color: var(--text);
}
.select:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.note {
  font-size: calc(11.5px * var(--ui-zoom, 1));
  color: var(--text-3);
}
/* ---------- 主题色卡：一小块「相纸台」示意，无渐变堆砌 ---------- */
.themes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 12px;
}
.theme {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}
/* 主题色卡：微缩「照片条目卡」示意——文字行 + 相纸 + 强调点。
   文字行用主题自己的文字色，深色主题靠亮色线条即可辨识 */
.swatch {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--sw-bg);
  overflow: hidden;
  transition: border-color var(--dur-hover) var(--ease-soft), transform var(--dur-hover) var(--ease-soft);
}
.theme:hover .swatch {
  border-color: var(--accent);
}
.swatch .ln,
.swatch .ln2 {
  position: absolute;
  left: 8%;
  height: 6%;
  border-radius: 999px;
  background: var(--sw-text);
}
.swatch .ln {
  top: 12%;
  width: 34%;
}
.swatch .ln2 {
  top: 24%;
  width: 20%;
  background: var(--sw-text2);
}
.swatch .ph {
  position: absolute;
  inset: 38% 18% 18%;
  border-radius: 3px;
  background: var(--sw-canvas);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.swatch .dot {
  position: absolute;
  right: 7%;
  bottom: 26%;
  width: 9%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--sw-accent);
}
/* 跟随系统：相纸对半分亮暗 */
.swatch.auto .ph {
  background: linear-gradient(115deg, #ececea 0 50%, #24211d 50% 100%);
}
.theme.on .swatch {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.t-label {
  font-size: calc(12px * var(--ui-zoom, 1));
  color: var(--text-2);
  text-align: center;
  transition: color var(--dur-hover) var(--ease-soft);
}
.theme.on .t-label {
  color: var(--accent);
  font-weight: 600;
}
.update-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: calc(12px * var(--ui-zoom, 1));
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
