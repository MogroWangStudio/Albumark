<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, Check, Download, ExternalLink, HardDrive, LoaderCircle, Play, Shuffle } from 'lucide-vue-next'
import AppButton from '@/components/ui/AppButton.vue'
import AppSegment from '@/components/ui/AppSegment.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import BootScreen from '@/components/BootScreen.vue'
import LogoMark from '@/components/brand/LogoMark.vue'
import { pickDirectory, executableDir, appDataDir, isTauri } from '@/core/platform'
import {
  checkForUpdate,
  downloadAndInstall,
  openReleasePage,
  type UpdateInfo,
} from '@/core/updater'
import { toast } from '@/stores/toast'
import { APP_VERSION } from '@/core/version'
import { FONT_CATEGORY_LABELS, useFontsStore, type FontCategory } from '@/stores/fonts'
import {
  BOOT_DURATION_DEFAULT,
  BOOT_DURATION_MAX,
  BOOT_DURATION_MIN,
  BOOT_STYLE_CHOICES,
  PREVIEW_CUSTOM_MAX,
  PREVIEW_CUSTOM_MIN,
  THEMES,
  pickBootStyle,
  useSettingsStore,
  type BootStyle,
  type BootStyleChoice,
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
  set: (v: unknown) => (settings.bootStyle = v as BootStyleChoice),
})

/** 时长以毫秒存储，滑杆按 100ms 取整并直接显示秒数 */
const bootDurationModel = computed({
  get: () => settings.bootDuration,
  set: (v: number) => (settings.bootDuration = Math.round(v / 100) * 100),
})

/* ---------- 启动动画试播 ----------
   按当前款式与时长在设置页上方播一次，不改动任何配置；
   选「随机」时每次试播都会重新抽一款，效果与下次启动一致 */
const previewing = ref(false)
const previewStyle = ref<BootStyle>('default')
const previewSeq = ref(0)
let previewTimer = 0

function previewBoot(): void {
  previewStyle.value = pickBootStyle(settings.bootStyle)
  previewSeq.value++
  previewing.value = true
  window.clearTimeout(previewTimer)
  // 与 App 启动时一致：动画总长 + 一点收尾余量后卸载，避免遮罩留下
  previewTimer = window.setTimeout(() => {
    previewing.value = false
  }, settings.bootDuration + 260)
}

onBeforeUnmount(() => window.clearTimeout(previewTimer))

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

/* ---------- 检查更新与自动更新 ---------- */

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'error'
const updateState = ref<UpdateState>('idle')
const updateInfo = ref<UpdateInfo | null>(null)
/** 下载进度：null = 总大小未知，只显示进行中 */
const updateProgress = ref<number | null>(null)

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

async function installUpdate(): Promise<void> {
  if (!updateInfo.value || updateState.value === 'downloading') return
  updateState.value = 'downloading'
  updateProgress.value = null
  try {
    const out = await downloadAndInstall(updateInfo.value, (pct) => {
      updateProgress.value = pct
    })
    toast(out.message, 'success')
    if (out.kind === 'manual') updateState.value = 'latest'
  } catch (err) {
    toast(`更新失败：${err instanceof Error ? err.message : '请稍后重试，或前往下载页手动获取'}`, 'error')
    updateState.value = 'available'
  }
}

const progressText = computed(() =>
  updateProgress.value === null ? '下载中…' : `下载 ${updateProgress.value}%`,
)

const isDownloading = computed(() => updateState.value === 'downloading')

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
        <template v-if="settings.bootEnabled">
          <div class="row col">
            <div class="text">
              <span class="label">动画款式</span>
              <p class="desc">八款编排各不相同；「随机」会在每次启动时抽一款</p>
            </div>
            <div class="styles" role="radiogroup" aria-label="启动动画款式">
              <button
                v-for="s in BOOT_STYLE_CHOICES"
                :key="s.value"
                class="style-card"
                :class="[`st-${s.value}`, { on: settings.bootStyle === s.value }]"
                role="radio"
                :aria-checked="settings.bootStyle === s.value"
                :title="s.hint"
                @click="bootStyleModel = s.value"
              >
                <span class="st-thumb">
                  <Shuffle v-if="s.value === 'random'" :size="16" class="st-rand" />
                  <LogoMark v-else class="st-logo" />
                </span>
                <span class="st-text">
                  <span class="st-name">{{ s.label }}</span>
                  <span class="st-hint">{{ s.hint }}</span>
                </span>
              </button>
            </div>
          </div>
          <div class="row col">
            <div class="text">
              <span class="label">动画时长</span>
              <p class="desc">整段动画的总长，随机款式同样按这个时长播放</p>
            </div>
            <AppSlider
              v-model="bootDurationModel"
              :min="BOOT_DURATION_MIN"
              :max="BOOT_DURATION_MAX"
              :step="100"
              label="时长"
              :format="(v) => `${(v / 1000).toFixed(1)} 秒`"
              :default="BOOT_DURATION_DEFAULT"
              @reset="settings.bootDuration = BOOT_DURATION_DEFAULT"
            />
          </div>
          <div class="row preview-row">
            <div class="text">
              <span class="label">预览效果</span>
              <p class="desc">按当前款式与时长播放一次，不会改动任何设置</p>
            </div>
            <AppButton size="sm" @click="previewBoot">
              <Play :size="13" />{{ previewing ? '重新预览' : '预览动画' }}
            </AppButton>
          </div>
        </template>
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
              <AppButton
                size="sm"
                variant="primary"
                :disabled="isDownloading"
                @click="installUpdate"
              >
                <LoaderCircle v-if="isDownloading" :size="13" class="spin" />
                <Download v-else :size="13" />{{ isDownloading ? progressText : '立即更新' }}
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

    <!-- 试播层：与启动时同一个组件，按当前选择播放一次后自动卸载 -->
    <BootScreen
      v-if="previewing"
      :key="previewSeq"
      :style-id="previewStyle"
      :duration="settings.bootDuration"
      preview
    />
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
  /* 顶部避开状态栏（安卓全面屏下页面从屏幕最顶端开始）；
     左侧让出 macOS 原生红绿灯 */
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right)) 10px
    calc(12px + var(--traffic-light-inset) + var(--safe-left));
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
  /* 切页时滚动条常驻，居中内容不会横向抖一下 */
  scrollbar-gutter: stable both-edges;
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
/* ---------- 启动动画款式：缩略示意 + 名称与一句描述 ---------- */
.styles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 8px;
}
.style-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--bg);
  text-align: left;
  transition:
    border-color var(--dur-hover) var(--ease-soft),
    background var(--dur-hover) var(--ease-soft);
}
.style-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--surface-solid);
}
.style-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.style-card.on {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.st-thumb {
  position: relative;
  flex: none;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--canvas) 90%, var(--text) 10%);
  overflow: hidden;
}
.st-logo {
  width: 24px;
  height: auto;
}
.st-rand {
  color: var(--accent);
}
.st-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.st-name {
  font-size: calc(12.5px * var(--ui-zoom, 1));
  line-height: 1.3;
}
.st-hint {
  font-size: calc(10.5px * var(--ui-zoom, 1));
  color: var(--text-3);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.style-card.on .st-name {
  color: var(--accent);
  font-weight: 600;
}
/* 每款的缩略示意：一眼能认出的静止标记，不在这里跑动画 */
.st-default .st-thumb::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px dashed color-mix(in srgb, var(--accent) 65%, transparent);
  border-radius: 50%;
}
.st-shutter .st-thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 50% 50%,
    transparent 0 9px,
    color-mix(in srgb, var(--bg) 76%, var(--text)) 10px
  );
}
.st-develop .st-logo {
  opacity: 0.75;
  filter: blur(1.3px);
}
.st-develop .st-thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 50% 55%,
    color-mix(in srgb, var(--accent) 20%, transparent),
    transparent 70%
  );
}
.st-flash .st-thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 62%);
}
.st-bars .st-thumb::before,
.st-bars .st-thumb::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 26%;
  background: rgba(10, 9, 8, 0.72);
}
.st-bars .st-thumb::before {
  top: 0;
}
.st-bars .st-thumb::after {
  bottom: 0;
}
.st-focus .st-thumb::after {
  content: '';
  position: absolute;
  inset: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
  border-radius: 2px;
}
.st-slide .st-logo {
  width: 20px;
  transform: translateY(-3px);
}
.st-slide .st-thumb::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 20px;
  height: 8px;
  transform: translateX(-50%);
  background:
    linear-gradient(var(--accent), var(--accent)) 50% 100% / 12px 1.5px no-repeat,
    linear-gradient(color-mix(in srgb, var(--accent) 65%, transparent), color-mix(in srgb, var(--accent) 65%, transparent)) 50% 40% / 18px 1px no-repeat,
    linear-gradient(color-mix(in srgb, var(--accent) 35%, transparent), color-mix(in srgb, var(--accent) 35%, transparent)) 50% 0 / 14px 1px no-repeat;
}
.st-double .st-logo {
  filter: drop-shadow(4px 0 0 color-mix(in srgb, var(--accent) 45%, transparent));
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
