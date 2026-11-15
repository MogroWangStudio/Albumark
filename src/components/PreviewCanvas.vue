<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { ChevronUp, Pipette } from 'lucide-vue-next'
import type { BackgroundLayer, WatermarkLayer } from '@/types/watermark'
import { clamp01, CROP_MIN, cropInnerBounds, cropRatioOf, cropRot, cropSourceSize, FULL_CROP, type Crop } from '@/types/adjust'
import { anchorPoint, hitTest, layerPivot, measureLayer } from '@/core/layout'
import { drawLayers, type AssetMap } from '@/core/draw'
import {
  backgroundAspect,
  blurRadiusPx,
  layoutBackgroundFrame,
  paintOverlay,
  paintPhotoOnBackground,
  renderBlurredCover,
  type BgFrameLayout,
} from '@/core/bg'
import { renderClient } from '@/core/renderer'
import { resolveTokens } from '@/core/tokens'
import { clampPanAxis, rubberband } from '@/core/viewmotion'
import { useAdjustStore } from '@/stores/adjust'
import { toast } from '@/stores/toast'
import { useImagesStore } from '@/stores/images'
import { PREVIEW_CUSTOM_MAX, PREVIEW_CUSTOM_MIN, useSettingsStore } from '@/stores/settings'
import { useWatermarkStore } from '@/stores/watermark'
import { useWorkspaceStore } from '@/stores/workspace'

const props = withDefaults(
  defineProps<{
    /** 悬浮面板占用的水平宽度（CSS px），0 = 面板未展开 */
    panelInset?: number
    /** 面板吸附在哪一侧：可用区域让到另一侧 */
    panelSide?: 'left' | 'right'
    /** 移动端底部抽屉占用的高度（CSS px），0 = 未弹起；预览中心相应上移 */
    panelBottomInset?: number
  }>(),
  { panelInset: 0, panelSide: 'right', panelBottomInset: 0 },
)

const emit = defineEmits<{ ctx: [e: MouseEvent] }>()

const images = useImagesStore()
const wm = useWatermarkStore()
const adjust = useAdjustStore()
const settings = useSettingsStore()
const ws = useWorkspaceStore()

const MAX_ZOOM = 12
const DBL_TAP_ZOOM = 2.5

/** 预设档位 → 精修长边上限 / 草稿长边上限 / 叠加层 DPR 上限 */
const PERF: Record<string, { final: number; draft: number; dprCap: number }> = {
  ultra: { final: 2400, draft: 1080, dprCap: 2 },
  high: { final: 1600, draft: 720, dprCap: 2 },
  balanced: { final: 1200, draft: 560, dprCap: 1.5 },
  eco: { final: 880, draft: 440, dprCap: 1 },
  minimal: { final: 640, draft: 320, dprCap: 1 },
}

/**
 * 自适应档的渲染长边范围：下限保证缩到很小时仍有可用清晰度，
 * 上限约束内存与解码开销（再高的倍率也不会无限吃显存）。
 */
const ADAPTIVE_MIN = 640
const ADAPTIVE_MAX = 3200

/** 自定义档位：精度（精修长边）无极可调，即时档与叠加层密度随之派生 */
function perfFor(q: string, custom: number): { final: number; draft: number; dprCap: number } {
  if (q === 'adaptive') return { final: ADAPTIVE_MAX, draft: 480, dprCap: 2 }
  if (q === 'custom') {
    const final = Math.min(PREVIEW_CUSTOM_MAX, Math.max(PREVIEW_CUSTOM_MIN, custom))
    return {
      final,
      draft: Math.max(320, Math.round(final * 0.45)),
      dprCap: final >= 1600 ? 2 : final >= 1200 ? 1.5 : 1,
    }
  }
  return PERF[q] ?? PERF.high!
}

/**
 * 自适应档当前需要的渲染长边：按「照片在屏幕上的实际像素」取景。
 * 放大时目标随之变大（≤ 源图原生长边 / ADAPTIVE_MAX），缩小时随之变小；
 * 不做这个换算的话，放大只是把同一张位图拉大，细节永远是糊的。
 */
function adaptiveLong(): number {
  const a = active.value
  const dpr = view.dpr || 1
  const fw = avail.w || view.w
  const fh = avail.h || view.h
  if (!a?.width || !a.height || !fw || !fh) return ADAPTIVE_MIN
  const geom = adjust.cropMode ? adjust.cropDraft : adjust.cropOf(a.id)
  const src = cropSourceSize(a.width, a.height, geom ?? undefined)
  // 裁剪编辑时显示整张变换后源图；其余情况画面只包含裁剪矩形
  const outW = Math.max(1, src.w * (adjust.cropMode ? 1 : (geom?.w ?? 1)))
  const outH = Math.max(1, src.h * (adjust.cropMode ? 1 : (geom?.h ?? 1)))
  const aspect = outW / outH
  // 适应窗口时照片的显示长边（CSS px）：等比放进可用区域
  const fitW = Math.min(fw, fh * aspect)
  const fitLong = Math.max(fitW, fitW / aspect)
  const wanted = Math.round(fitLong * zoom.value * dpr)
  const native = Math.max(outW, outH)
  return Math.max(320, Math.min(ADAPTIVE_MAX, native || ADAPTIVE_MAX, Math.max(ADAPTIVE_MIN, wanted)))
}

/** 即时（低清）渲染的自适应目标：约为精修目标的一半，拖动滑杆时先给一版能看的 */
function adaptiveDraftLong(): number {
  if (settings.previewQuality !== 'adaptive') return perf.value.draft
  return Math.min(1200, Math.max(480, Math.round(adaptiveLong() * 0.5)))
}

const frame = ref<HTMLDivElement | null>(null)
const cvBase = ref<HTMLCanvasElement | null>(null)
const cvOverlay = ref<HTMLCanvasElement | null>(null)

const view = reactive({ w: 0, h: 0, dpr: 1 })
/**
 * 可用区域（CSS px，相对 frame）：悬浮面板展开时让出其一侧，
 * 图片的适应与居中都以这块区域为基准，面板收起后平滑归位。
 */
const avail = reactive({ x: 0, y: 0, w: 0, h: 0 })
let availAnim = 0
/** 视图缩放：minZoom（安全区）= 适应窗口 */
const zoom = ref(1)
/** 平移（CSS px，相对可用区域中心） */
const pan = reactive({ x: 0, y: 0 })

/** 最近一次绘制结果在画布（设备像素）中的映射，用于命中测试与选框换算。 */
const resultMap = reactive({ w: 0, h: 0, scale: 1, ox: 0, oy: 0 })

const selRect = ref<{
  left: number
  top: number
  width: number
  height: number
  rotate: number
} | null>(null)
/** 底图正在渲染（低清刷新或精修进行中），用于加载提示 */
const rendering = ref(false)
/** 吸附参考线（图片坐标系中的 x/y），拖动中显示 */
const snapLines = ref<{ x?: number; y?: number } | null>(null)

let mctx: CanvasRenderingContext2D | null = null
let srcBitmap: ImageBitmap | null = null
let srcId: string | null = null
/** 合成结果位图缓存：缩放/平移只重绘，不重新渲染 */
let resultBmp: ImageBitmap | null = null
/** resultBmp/resultMap 所属的照片：与 active 不一致时交互手势必须停用 */
let resultId: string | null = null
/** 照片（不含边框环带）在 resultBmp 中的几何：背景水印的主线程组合用 */
const resultPhoto = reactive({
  offset: { x: 0, y: 0 },
  size: { w: 0, h: 0 },
  renderScale: 1,
})
/** 背景水印组合布局：照片矩形在画布（resultMap 坐标系）中的位置，拖动照片手势用 */
let bgLayout: BgFrameLayout | null = null
/** 背景模糊位图缓存：key = 源标识|模糊量|尺寸，拖模糊滑杆时按 LRU 淘汰 */
const bgBlurCache = new Map<string, OffscreenCanvas>()
let baseSeq = 0
let finalTimer: number | null = null
let settleTimer: number | null = null
let overlayRaf = false
let viewAnim = 0
let ro: ResizeObserver | null = null
/** 水印素材位图缓存：叠加层在主线程直接绘制 */
const assetBmps: AssetMap = new Map()

const active = computed(() => images.active)
const hasSelection = computed(() => !!wm.selectedId)
const minZoom = computed(() => Math.min(1, Math.max(0.3, settings.minZoom)))
const perf = computed(() => perfFor(settings.previewQuality, settings.previewQualityValue))

/* ---------- 可用区域：悬浮面板让位，中心偏移到剩余空白 ---------- */

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function targetAvail(): Rect {
  const maxInset = Math.max(0, view.w - 80)
  const inset = Math.min(Math.max(0, props.panelInset), maxInset)
  const maxBottom = Math.max(0, view.h - 80)
  const bottom = Math.min(Math.max(0, props.panelBottomInset), maxBottom)
  return {
    x: inset > 0 && props.panelSide === 'left' ? inset : 0,
    y: 0,
    w: view.w - inset,
    h: view.h - bottom,
  }
}

/** 面板展开/收起/换边时可用区域平滑过渡（可被下一次变化接管） */
function startAvailAnim(target: Rect): void {
  if (availAnim) cancelAnimationFrame(availAnim)
  const from = { x: avail.x, y: avail.y, w: avail.w, h: avail.h }
  const t0 = performance.now()
  const dur = 220
  const step = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    avail.x = from.x + (target.x - from.x) * e
    avail.y = from.y + (target.y - from.y) * e
    avail.w = from.w + (target.w - from.w) * e
    avail.h = from.h + (target.h - from.h) * e
    drawBase()
    drawOverlay()
    if (k < 1) availAnim = requestAnimationFrame(step)
    else {
      availAnim = 0
      // 让位动画结束后按新基准收紧一次，避免图片停到面板底下
      hardClampPan()
      drawBase()
      drawOverlay()
    }
  }
  availAnim = requestAnimationFrame(step)
}

const availCx = (): number => avail.x + avail.w / 2
const availCy = (): number => avail.y + avail.h / 2

watch(
  [() => props.panelInset, () => props.panelSide, () => props.panelBottomInset, () => view.w, () => view.h],
  () => {
    const t = targetAvail()
    // 首次（或从无到有）直接就位，之后的变化平滑过渡
    if (!view.w || avail.w <= 0) {
      Object.assign(avail, t)
      return
    }
    startAvailAnim(t)
  },
  { immediate: true },
)

/* ---------- 缩放预设 ---------- */

const zoomMenuOpen = ref(false)

const ZOOM_PRESETS: { label: string; value: number | 'fit' }[] = [
  { label: '50%', value: 0.5 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '适应窗口', value: 'fit' },
]

/** 提供给右键菜单等外部调用 */
function setZoom(z: number): void {
  zoomMenuOpen.value = false
  stopViewAnim()
  zoom.value = Math.min(MAX_ZOOM, Math.max(minZoom.value, z))
  hardClampPan()
  drawBase()
  drawOverlay()
  scheduleHiRes()
}

function fitView(): void {
  zoomMenuOpen.value = false
  stopViewAnim()
  animateViewTo(1, 0, 0)
}

function applyPreset(v: number | 'fit'): void {
  if (v === 'fit') fitView()
  else setZoom(v)
}

defineExpose({ fitView, setZoom, resetView })

function closeZoomMenu(): void {
  zoomMenuOpen.value = false
}
function onZoomKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') zoomMenuOpen.value = false
}
watch(zoomMenuOpen, (v) => {
  if (v) {
    window.setTimeout(() => document.addEventListener('click', closeZoomMenu), 0)
    document.addEventListener('keydown', onZoomKey)
  } else {
    document.removeEventListener('click', closeZoomMenu)
    document.removeEventListener('keydown', onZoomKey)
  }
})

function measureContext(): CanvasRenderingContext2D {
  if (!mctx) {
    mctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  }
  return mctx
}

/** 当前主题的强调色：随主题切换（画布上的参考线 / 锚点都用它） */
function accentCss(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffa72f'
}

function resolvedLayer(l: WatermarkLayer): WatermarkLayer {
  if (l.type !== 'text') return l
  const a = active.value
  return { ...l, content: resolveTokens(l.content, a?.exif, a?.baseName) }
}

function resolvedLayers(): WatermarkLayer[] {
  // 先取纯数据副本，再做令牌替换（响应式 Proxy 无法直接用于克隆）；
  // 用当前照片生效的图层（单独水印优先，否则全局）
  const a = active.value
  const list = wm.effectiveLayers(a?.id ?? null)
  return list.map((l) =>
    l.type === 'text'
      ? { ...l, content: resolveTokens(l.content, a?.exif, a?.baseName) }
      : l,
  )
}

/* ---------- 背景水印：主线程组合（背景与照片效果不进 Worker，拖动零往返） ---------- */

/** 当前照片生效的可见背景层（含「仅当前照片」覆盖应用）。列表靠前者在上。 */
function backgroundLayers(): BackgroundLayer[] {
  const a = active.value
  const list = resolvedLayers().filter(
    (l): l is BackgroundLayer => l.type === 'background' && l.visible,
  )
  const ov = wm.bgOverrideFor(a?.id ?? null)
  if (!ov) return list
  // 覆盖作用于第一层（布局层）：这张照片的背景图改用覆盖素材
  return list.map((l, i) =>
    i === 0
      ? { ...l, source: 'custom' as const, assetId: ov.assetId, aspect: ov.aspect ?? l.aspect }
      : l,
  )
}

/** 背景位图来源：custom 取素材缓存；self 取当前照片（resultBmp 的照片部分）。 */
function backgroundSource(l: BackgroundLayer): {
  bmp: ImageBitmap
  rect?: { x: number; y: number; w: number; h: number }
} | null {
  if (l.source === 'custom' && l.assetId) {
    const bmp = assetBmps.get(l.assetId)
    return bmp ? { bmp } : null
  }
  if (!resultBmp || !resultPhoto.size.w || !resultPhoto.size.h) return null
  return {
    bmp: resultBmp,
    rect: {
      x: resultPhoto.offset.x,
      y: resultPhoto.offset.y,
      w: resultPhoto.size.w,
      h: resultPhoto.size.h,
    },
  }
}

/** 带缓存的模糊背景：key = 源标识 | 模糊量 | 尺寸，拖滑杆时 LRU 淘汰。 */
function blurredCover(l: BackgroundLayer, fw: number, fh: number): OffscreenCanvas | null {
  const src = backgroundSource(l)
  if (!src) return null
  const blur = blurRadiusPx(l, fw, fh)
  const ident = l.source === 'custom' ? `a:${l.assetId}` : `p:${resultId ?? ''}`
  const key = `${ident}|${blur.toFixed(1)}|${fw}x${fh}`
  const hit = bgBlurCache.get(key)
  if (hit) return hit
  const out = renderBlurredCover(src.bmp, fw, fh, blur, src.rect)
  if (bgBlurCache.size >= 4) {
    const oldest = bgBlurCache.keys().next().value as string | undefined
    if (oldest) bgBlurCache.delete(oldest)
  }
  bgBlurCache.set(key, out)
  return out
}

/* ---------- 分层渲染：Worker 只负责底图（解码+调节），水印叠加层在主线程 ---------- */

let draftInFlight = false
let draftQueued = false

/**
 * 低清即时渲染：同一时刻只允许一个在途任务。
 * 拖动滑杆时逐帧请求会被合并——在途任务完成后若参数又变过，用最新参数补一帧，
 * 避免任务在 Worker 里排队堆积、延迟越滚越大。
 */
function scheduleDraft(): void {
  if (draftInFlight) {
    draftQueued = true
    return
  }
  draftInFlight = true
  void renderBase(true).finally(() => {
    draftInFlight = false
    if (draftQueued) {
      draftQueued = false
      scheduleDraft()
    }
  })
}

function scheduleBase(): void {
  if (!active.value) return
  rendering.value = true
  scheduleDraft()
  // 停顿 300ms 后再请求一次全分辨率精修
  if (finalTimer) window.clearTimeout(finalTimer)
  finalTimer = window.setTimeout(() => {
    void renderBase(false).finally(() => {
      rendering.value = false
    })
  }, 300)
}

function scheduleOverlay(): void {
  if (overlayRaf) return
  overlayRaf = true
  requestAnimationFrame(() => {
    overlayRaf = false
    // 素材齐备时同步绘制（即时反馈）；缺素材先画已有内容，加载后补一帧
    if (!hasMissingAssets()) {
      drawBase()
      drawOverlay()
      return
    }
    void syncAssets().then(() => {
      drawBase()
      drawOverlay()
    })
  })
}

function hasMissingAssets(): boolean {
  const list = resolvedLayers()
  if (list.some((l) => l.type === 'image' && !assetBmps.has((l as { assetId: string }).assetId)))
    return true
  for (const l of list) {
    if (l.type === 'background' && l.visible && l.source === 'custom' && l.assetId) {
      if (!assetBmps.has(l.assetId)) return true
    }
  }
  const ov = wm.bgOverrideFor(active.value?.id ?? null)
  return !!ov && !assetBmps.has(ov.assetId)
}

/**
 * 当前照片的源位图（按需解码到 targetLong 长边，不超过原生尺寸）。
 * 安卓 WebView 上解码一张 50MP 要数秒、RGBA 位图上百 MB，而预览输出长边
 * 有上限（≤ 精修档位），按目标尺寸解码后位图只有几 MB，Worker 侧的
 * 缩放与传输也随之变轻。缓存长边够用即复用，放大到更高需求才重解码。
 */
async function ensureBitmap(targetLong: number): Promise<ImageBitmap | null> {
  const a = active.value
  if (!a || !a.blob) return null
  if (
    srcBitmap &&
    srcId === a.id &&
    Math.max(srcBitmap.width, srcBitmap.height) >= Math.max(1, targetLong) - 2
  ) {
    return srcBitmap
  }
  if (srcBitmap) {
    srcBitmap.close()
    srcBitmap = null
    srcId = null
  }
  try {
    const long = Math.max(a.width, a.height) || 0
    const k = long > targetLong ? targetLong / long : 1
    srcBitmap = await createImageBitmap(
      a.blob,
      k < 1
        ? {
            imageOrientation: 'from-image',
            resizeWidth: Math.max(1, Math.round(a.width * k)),
            resizeHeight: Math.max(1, Math.round(a.height * k)),
          }
        : { imageOrientation: 'from-image' },
    )
    srcId = a.id
    return srcBitmap
  } catch {
    return null
  }
}

/** 清空底图与映射：画面保留旧照片内容会误导交互（尤其裁剪按旧画面取框） */
function clearResult(): void {
  resultBmp?.close()
  resultBmp = null
  resultId = null
  resultPhoto.offset = { x: 0, y: 0 }
  resultPhoto.size = { w: 0, h: 0 }
  resultPhoto.renderScale = 1
  bgLayout = null
  resultMap.w = 0
  resultMap.h = 0
  resultMap.scale = 1
  resultMap.ox = 0
  resultMap.oy = 0
  selRect.value = null
  for (const c of [cvBase.value, cvOverlay.value]) {
    const ctx = c?.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, c!.width, c!.height)
  }
}

async function renderBase(draft: boolean): Promise<void> {
  const a = active.value
  if (!a || !cvBase.value) return
  const seq = ++baseSeq
  const viewLong = Math.max(view.w, view.h) * view.dpr || 800
  const adaptive = settings.previewQuality === 'adaptive'
  // 即时刷新用「不低于当前显示分辨率」的档位：替换位图时尺寸不变，避免画面忽糊忽清地闪烁
  const currentLong = resultBmp ? Math.max(resultBmp.width, resultBmp.height) : 0
  const maxLong = draft
    ? Math.max(adaptiveDraftLong(), currentLong)
    : adaptive
      ? adaptiveLong()
      : Math.min(perf.value.final, viewLong)
  const bmp = await ensureBitmap(maxLong)
  if (!bmp) {
    // 照片文件未装载（后台渐进补齐中）或解码失败：清掉旧画面，
    // 新照片渲染出来之前不允许按旧画面取裁剪框 / 拖图层
    clearResult()
    return
  }
  srcBitmap = null // 即将转移给 Worker
  try {
    // 裁剪编辑中渲染「变换后全图」（框外要可见），确认后按矩形取样；
    // 翻转与拉直在两种状态下都生效。crops 里存的是响应式代理，
    // 传 Worker 前必须拍平为纯数据，否则结构化克隆失败、渲染静默中断
    const d = adjust.cropMode ? adjust.cropDraft : undefined
    const sel = adjust.cropMode
      ? { x: 0, y: 0, w: 1, h: 1, rot: d?.rot, flipH: d?.flipH, flipV: d?.flipV }
      : adjust.cropOf(a.id)
    const crop = sel ? { ...sel } : undefined
    // 边框与背景层由 Worker 处理（拍平为纯数据）：边框有背景时画环带、
    // 无背景时扩展画布；背景位图本身预览阶段由主线程组合。裁剪编辑时
    // 两者都不加，保持裁剪框坐标系
    const baseLayers = adjust.cropMode
      ? []
      : resolvedLayers()
          .filter((l) => l.type === 'border' || l.type === 'background')
          .map((l) => structuredClone(toRaw(l)))
    const res = await renderClient.renderPreview(
      bmp,
      [],
      baseLayers,
      adjust.snapshotFor(a.id),
      maxLong,
      crop,
    )
    if (seq !== baseSeq) {
      // 已被更新的请求取代：本次输出作废，归还的源位图与输出位图都要释放，
      // 否则既泄漏内存，丢失的 srcBack 还会迫使下一次渲染重新解码
      res.bitmap.close()
      res.srcBack.close()
      return
    }
    srcBitmap = res.srcBack
    srcId = a.id
    if (resultBmp) resultBmp.close()
    resultBmp = res.bitmap
    resultId = a.id
    resultPhoto.offset = { ...res.photoOffset }
    resultPhoto.size = { ...res.photoSize }
    resultPhoto.renderScale = res.renderScale
    drawBase()
    drawOverlay()
  } catch (err) {
    console.error("底图渲染失败", err)
    srcBitmap = null
    srcId = null
  }
}

/* ---------- 拉直 / 翻转的即时粗渲：低清位图缓存 + 主线程绘制 ---------- */

/** 裁剪模式下的一次性低清解码：拖动拉直时主线程逐帧绘制，不再每帧进 Worker */
let cropPreviewBmp: ImageBitmap | null = null
let cropPreviewId: string | null = null

async function ensureCropPreview(): Promise<ImageBitmap | null> {
  const a = active.value
  // 尺寸未知（照片还没装载）时不解码，等装载后由渲染流程补
  if (!a?.blob || !a.width || !a.height) return null
  if (cropPreviewBmp && cropPreviewId === a.id) return cropPreviewBmp
  releaseCropPreview()
  try {
    const long = Math.max(a.width, a.height) || 1
    const target = Math.min(1100, long)
    cropPreviewBmp = await createImageBitmap(a.blob, {
      resizeWidth: Math.max(1, Math.round((a.width / long) * target)),
      resizeHeight: Math.max(1, Math.round((a.height / long) * target)),
    })
    cropPreviewId = a.id
  } catch {
    cropPreviewBmp = null
  }
  return cropPreviewBmp
}

function releaseCropPreview(): void {
  cropPreviewBmp?.close()
  cropPreviewBmp = null
  cropPreviewId = null
}

/**
 * 拉直 / 翻转的即时粗渲：按 Worker 同一几何（翻转 → 旋转 → 轴对齐包围盒）
 * 把低清全图画到底图画布并更新映射，拖动中实时跟手；停顿后仍由 Worker 精修。
 */
function drawRotatedDraft(): void {
  const canvas = cvBase.value
  const a = active.value
  const d = adjust.cropDraft
  if (!canvas || !d || !a) return
  // 低清位图必须属于当前照片：切照片后缓存还挂着旧图时，
  // 拉直粗渲会把上一张画出来旋转（随后精修又跳回，肉眼可见串图）
  if (!cropPreviewBmp || cropPreviewId !== a.id) {
    void ensureCropPreview().then((bmp) => {
      if (bmp && adjust.cropDraft) drawRotatedDraft()
    })
    return
  }
  const bmp = cropPreviewBmp
  const dpr = view.dpr || 1
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = cropSourceSize(bmp.width, bmp.height, d)
  const fit = Math.min((avail.w * dpr) / s.w, (avail.h * dpr) / s.h)
  const scale = fit * zoom.value
  const ox = avail.x * dpr + (avail.w * dpr - s.w * scale) / 2 + pan.x * dpr
  const oy = avail.y * dpr + (avail.h * dpr - s.h * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(ox + (s.w * scale) / 2, oy + (s.h * scale) / 2)
  ctx.scale(scale, scale)
  ctx.rotate((cropRot(d) * Math.PI) / 180)
  ctx.scale(d.flipH ? -1 : 1, d.flipV ? -1 : 1)
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
  resultMap.w = s.w
  resultMap.h = s.h
  resultMap.scale = scale
  resultMap.ox = ox
  resultMap.oy = oy
  bgLayout = null
  drawOverlay()
}

/** 保持素材位图缓存与图层引用一致（异步加载缺失项后重绘叠加层）。 */
async function syncAssets(): Promise<void> {
  const needed = new Set<string>()
  for (const l of resolvedLayers()) {
    if (l.type === 'image') needed.add((l as { assetId: string }).assetId)
    else if (l.type === 'background' && l.visible && l.source === 'custom' && l.assetId)
      needed.add(l.assetId)
  }
  // 「仅当前照片」的背景覆盖图同样参与预览组合
  const ov = wm.bgOverrideFor(active.value?.id ?? null)
  if (ov) needed.add(ov.assetId)
  let dirty = false
  for (const key of [...assetBmps.keys()]) {
    if (!needed.has(key)) {
      assetBmps.get(key)?.close()
      assetBmps.delete(key)
      dirty = true
    }
  }
  const missing = [...needed].filter((id) => !assetBmps.has(id))
  if (missing.length) {
    // 以当前照片实际生效的图层为准收集（独立水印副本可能引用别的素材）
    const payloads = await wm.assetPayloads(resolvedLayers())
    for (const p of payloads) {
      if (!assetBmps.has(p.id)) {
        try {
          assetBmps.set(p.id, await createImageBitmap(p.blob))
        } catch {
          /* 无效素材跳过 */
        }
      }
    }
    dirty = true
  }
  if (dirty) {
    drawBase()
    drawOverlay()
  }
}

/** 把缓存的结果位图绘制到底图画布，并更新映射。有背景水印时主线程组合
 *  背景与照片（Worker 只输出照片 + 边框环带），拖动 / 滑杆即时跟手。 */
function drawBase(): void {
  const canvas = cvBase.value
  const bmp = resultBmp
  if (!canvas || !bmp) return
  const dpr = view.dpr || 1
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // 背景水印布局：画布尺寸与照片矩形由第一个可见背景层决定（与导出一致）
  const bgList = adjust.cropMode ? [] : backgroundLayers()
  const layout =
    bgList.length > 0 && resultPhoto.size.w > 0 && resultPhoto.size.h > 0
      ? layoutBackgroundFrame(
          bgList[0],
          resultPhoto.size.w,
          resultPhoto.size.h,
          backgroundAspect(bgList[0], resultPhoto.size.w, resultPhoto.size.h),
          resultPhoto.renderScale,
        )
      : null
  const W = layout ? layout.frameW : bmp.width
  const H = layout ? layout.frameH : bmp.height
  // 适应与居中都基于可用区域：面板占住一侧时，中心偏移到剩余空白
  const fit = Math.min((avail.w * dpr) / W, (avail.h * dpr) / H)
  const scale = fit * zoom.value
  const ox = avail.x * dpr + (avail.w * dpr - W * scale) / 2 + pan.x * dpr
  const oy = avail.y * dpr + (avail.h * dpr - H * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)

  const light = document.documentElement.dataset.mode === 'light'
  if (layout) {
    bgLayout = layout
    // 背景（列表靠前者更贴近照片 → 从末尾往前铺），模糊位图走缓存；
    // 每层铺完后叠各自的颜色遮罩（照片之下）
    for (let i = bgList.length - 1; i >= 0; i--) {
      const blurred = blurredCover(bgList[i], layout.frameW, layout.frameH)
      if (blurred) ctx.drawImage(blurred, 0, 0, layout.frameW, layout.frameH)
      paintOverlay(ctx, bgList[i], layout.frameW, layout.frameH)
    }
    const borders = resolvedLayers().filter(
      (l): l is import('@/types/watermark').BorderLayer => l.type === 'border' && l.visible,
    )
    paintPhotoOnBackground(
      ctx,
      bmp,
      resultPhoto.size.w,
      resultPhoto.size.h,
      layout,
      bgList[0],
      borders,
      resultPhoto.renderScale,
    )
  } else {
    bgLayout = null
    // 投影让照片贴在底色上仍有层次（明暗随主题 mode）
    ctx.save()
    ctx.shadowColor = light ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = 22 / scale
    ctx.shadowOffsetY = 5 / scale
    ctx.drawImage(bmp, 0, 0)
    ctx.restore()
  }
  // 1px 细描边：极浅照片在纯白底上也能看清边界
  ctx.strokeStyle = light ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1 / scale
  ctx.strokeRect(0, 0, W, H)
  resultMap.w = W
  resultMap.h = H
  resultMap.scale = scale
  resultMap.ox = ox
  resultMap.oy = oy
}

/**
 * 叠加层坐标系相对原图的像素折算：水印 offset 是原图尺度固定像素
 * （与边框宽度、背景偏移同一语义），绘制 / 命中 / 吸附 / 拖动写入必须
 * 全部经它换算，否则预览偏移会随渲染分辨率（缩放查看、窗口大小）漂移，
 * 导出也与所见不一致。正常路径 = 照片的取样缩放系数；裁剪编辑的粗渲
 * 坐标系基于低清全图，比例随之单独计算。
 */
function overlayPxScale(): number {
  const a = active.value
  if (adjust.cropMode) {
    if (cropPreviewBmp && a?.width) {
      const s = cropSourceSize(a.width, a.height, adjust.cropDraft ?? undefined)
      return s.w > 0 ? cropPreviewBmp.width / s.w : 1
    }
    return 1
  }
  return resultPhoto.renderScale || 1
}

/** 水印叠加层：主线程矢量绘制，拖动时只重绘这一层，不再经过 Worker。 */
function drawOverlay(): void {
  const canvas = cvOverlay.value
  // 映射始终基于 resultMap：正常路径为 Worker 输出位图，拉直粗渲时为
  // 「旋转包围盒 × 低清尺寸」——保证叠加层与底图共用同一坐标系不错位
  if (!canvas || !resultMap.w || !resultMap.h) return
  const dpr = Math.min(view.dpr || 1, perf.value.dprCap)
  const cw = Math.max(1, Math.round(view.w * dpr))
  const ch = Math.max(1, Math.round(view.h * dpr))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const fit = Math.min((avail.w * dpr) / resultMap.w, (avail.h * dpr) / resultMap.h)
  const scale = fit * zoom.value
  const ox = avail.x * dpr + (avail.w * dpr - resultMap.w * scale) / 2 + pan.x * dpr
  const oy = avail.y * dpr + (avail.h * dpr - resultMap.h * scale) / 2 + pan.y * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)

  const layers = resolvedLayers()
  const pxScale = overlayPxScale()
  const draft = adjust.cropMode ? adjust.cropDraft : null
  if (draft) {
    // 水印画进裁剪框坐标系：预览位置与应用裁剪后完全一致
    const sx = draft.x * resultMap.w
    const sy = draft.y * resultMap.h
    const sw = Math.max(1, draft.w * resultMap.w)
    const sh = Math.max(1, draft.h * resultMap.h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(sx, sy, sw, sh)
    ctx.clip()
    ctx.translate(sx, sy)
    drawLayers(ctx, sw, sh, layers, assetBmps, pxScale)
    ctx.restore()
  } else {
    drawLayers(ctx, resultMap.w, resultMap.h, layers, assetBmps, pxScale)
  }

  if (draft) {
    drawCropChrome(ctx, draft, scale, dpr)
    selRect.value = null
    return
  }

  // 吸附参考线
  const snap = snapLines.value
  if (snap) {
    ctx.save()
    ctx.strokeStyle = accentCss()
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1 / scale
    ctx.setLineDash([6 / scale, 4 / scale])
    if (snap.x !== undefined) {
      ctx.beginPath()
      ctx.moveTo(snap.x, 0)
      ctx.lineTo(snap.x, resultMap.h)
      ctx.stroke()
    }
    if (snap.y !== undefined) {
      ctx.beginPath()
      ctx.moveTo(0, snap.y)
      ctx.lineTo(resultMap.w, snap.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 选中图层的锚点十字（边框 / 背景层覆盖全画布、无定位锚点）
  const sel = wm.selected
  if (sel && sel.type !== 'border' && sel.type !== 'background') {
    const a = anchorPoint(sel.anchor, resultMap.w, resultMap.h)
    ctx.save()
    ctx.strokeStyle = accentCss()
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1 / scale
    const r = 7 / scale
    ctx.beginPath()
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
    ctx.moveTo(a.x - r * 1.8, a.y)
    ctx.lineTo(a.x + r * 1.8, a.y)
    ctx.moveTo(a.x, a.y - r * 1.8)
    ctx.lineTo(a.x, a.y + r * 1.8)
    ctx.stroke()
    ctx.restore()
  }

  updateSelRect()
}

/** 裁剪覆盖层：框外压暗、三分网格、白色边框与角标、裁剪后像素尺寸。 */
function drawCropChrome(ctx: CanvasRenderingContext2D, d: Crop, scale: number, oDpr: number): void {
  const W = resultMap.w
  const H = resultMap.h
  const x0 = d.x * W
  const y0 = d.y * H
  const x1 = (d.x + d.w) * W
  const y1 = (d.y + d.h) * H

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 0, W, y0)
  ctx.fillRect(0, y1, W, H - y1)
  ctx.fillRect(0, y0, x0, y1 - y0)
  ctx.fillRect(x1, y0, W - x1, y1 - y0)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 1 / scale
  ctx.beginPath()
  for (let i = 1; i <= 2; i++) {
    const gx = x0 + ((x1 - x0) * i) / 3
    const gy = y0 + ((y1 - y0) * i) / 3
    ctx.moveTo(gx, y0)
    ctx.lineTo(gx, y1)
    ctx.moveTo(x0, gy)
    ctx.lineTo(x1, gy)
  }
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.lineWidth = 1.5 / scale
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)

  // 四角 L 形与四边中点短线：握点暗示
  const arm = Math.min(18 / scale, (x1 - x0) / 3, (y1 - y0) / 3)
  const notch = Math.min(10 / scale, (x1 - x0) / 4, (y1 - y0) / 4)
  ctx.lineWidth = 2.5 / scale
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0)
  ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm)
  ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1)
  ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm)
  ctx.moveTo((x0 + x1) / 2, y0); ctx.lineTo((x0 + x1) / 2, y0 + notch)
  ctx.moveTo((x0 + x1) / 2, y1); ctx.lineTo((x0 + x1) / 2, y1 - notch)
  ctx.moveTo(x0, (y0 + y1) / 2); ctx.lineTo(x0 + notch, (y0 + y1) / 2)
  ctx.moveTo(x1, (y0 + y1) / 2); ctx.lineTo(x1 - notch, (y0 + y1) / 2)
  ctx.stroke()
  ctx.restore()

  // 裁剪后尺寸（原图像素）：按叠加层自身密度绘制，保证任何缩放下字号一致。
  // 图片坐标 → 底图设备像素（resultMap）→ 乘 k（叠加层/底图密度比）→ 叠加层像素
  const a = active.value
  if (!a?.width || !a.height) return
  const k = oDpr / (view.dpr || 1)
  const cx = (resultMap.ox + ((x0 + x1) / 2) * scale) * k
  const devY = (resultMap.oy + y0 * scale) * k
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const text = `${Math.round(d.w * a.width)} × ${Math.round(d.h * a.height)}`
  ctx.font = `600 ${10.5 * oDpr}px ${getComputedStyle(document.documentElement).fontFamily}`
  const tw = ctx.measureText(text).width
  const chipW = tw + 14 * oDpr
  const chipH = 19 * oDpr
  const bx = cx - chipW / 2
  const by = devY + 8 * oDpr
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
  ctx.beginPath()
  ctx.roundRect(bx, by, chipW, chipH, chipH / 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, by + chipH / 2 + 0.5 * oDpr)
  ctx.restore()
}

function updateSelRect(): void {
  const sel = wm.selected
  if (!sel || !resultMap.w) {
    selRect.value = null
    return
  }
  const box = measureLayer(sel, resultMap.w, resultMap.h, measureContext(), overlayPxScale())
  const dpr = view.dpr || 1
  const s = resultMap.scale
  selRect.value = {
    left: (resultMap.ox + (box.cx - box.w / 2) * s) / dpr,
    top: (resultMap.oy + (box.cy - box.h / 2) * s) / dpr,
    width: (box.w * s) / dpr,
    height: (box.h * s) / dpr,
    rotate: box.rotation,
  }
}

function toImagePx(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = cvBase.value!
  const dpr = view.dpr || 1
  const rect = canvas.getBoundingClientRect()
  const dx = (clientX - rect.left) * dpr
  const dy = (clientY - rect.top) * dpr
  return { x: (dx - resultMap.ox) / resultMap.scale, y: (dy - resultMap.oy) / resultMap.scale }
}

/* ---------- 白平衡取样 ---------- */

let wbCanvas: HTMLCanvasElement | null = null
/** 取 5×5 邻域均值：单像素容易把噪点当偏色，取一小块更稳 */
const WB_SAMPLE = 5

function sampleResult(x: number, y: number): { r: number; g: number; b: number } | null {
  const bmp = resultBmp
  if (!bmp) return null
  // 小图（缩略级）按实际边长取样，避免源矩形越界被拉伸
  const S = Math.max(1, Math.min(WB_SAMPLE, bmp.width, bmp.height))
  if (!wbCanvas) wbCanvas = document.createElement('canvas')
  wbCanvas.width = S
  wbCanvas.height = S
  const ctx = wbCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  // 贴边时把取样框整体收进图内，避免把透明像素平均进去
  const sx = Math.min(Math.max(0, Math.round(x) - (S >> 1)), Math.max(0, bmp.width - S))
  const sy = Math.min(Math.max(0, Math.round(y) - (S >> 1)), Math.max(0, bmp.height - S))
  ctx.clearRect(0, 0, S, S)
  ctx.drawImage(bmp, sx, sy, S, S, 0, 0, S, S)
  const d = ctx.getImageData(0, 0, S, S).data
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
  }
  const n = d.length / 4
  return { r: r / n, g: g / n, b: b / n }
}

/* ---------- 视图变换：缩放 / 平移 / 橡皮筋 ---------- */

/** 放大平移时图片边缘与面板/顶栏/底栏保留的呼吸边距 */
const PAN_MARGIN = 12

/** 图像在当前 zoom 下的显示尺寸（CSS px） */
function displaySize(): { w: number; h: number } {
  if (!resultBmp) return { w: avail.w, h: avail.h }
  const dpr = view.dpr || 1
  const fit = Math.min((avail.w * dpr) / resultBmp.width, (avail.h * dpr) / resultBmp.height) / dpr
  return { w: resultBmp.width * fit, h: resultBmp.height * fit }
}

function hardClampPan(): void {
  const d = displaySize()
  pan.x = clampPanAxis(pan.x, d.w, avail.w, zoom.value, false, PAN_MARGIN)
  pan.y = clampPanAxis(pan.y, d.h, avail.h, zoom.value, false, PAN_MARGIN)
}

function stopViewAnim(): void {
  if (viewAnim) {
    cancelAnimationFrame(viewAnim)
    viewAnim = 0
  }
}

function animateViewTo(tz: number, tpx: number, tpy: number): void {
  stopViewAnim()
  const sz = zoom.value
  const spx = pan.x
  const spy = pan.y
  const t0 = performance.now()
  const dur = 260
  const step = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    zoom.value = sz + (tz - sz) * e
    pan.x = spx + (tpx - spx) * e
    pan.y = spy + (tpy - spy) * e
    drawBase()
    drawOverlay()
    if (k < 1) viewAnim = requestAnimationFrame(step)
    else {
      viewAnim = 0
      scheduleHiRes()
    }
  }
  viewAnim = requestAnimationFrame(step)
}

/** 以某点（视口 CSS 坐标）为锚改变缩放，保持该点下的图像位置不动 */
function zoomAt(cx: number, cy: number, nextZoom: number): void {
  const z0 = zoom.value
  const z1 = Math.min(MAX_ZOOM, Math.max(minZoom.value, nextZoom))
  if (z1 === z0) return
  const rcx = cx - availCx()
  const rcy = cy - availCy()
  pan.x = rcx - ((rcx - pan.x) / z0) * z1
  pan.y = rcy - ((rcy - pan.y) / z0) * z1
  zoom.value = z1
  hardClampPan()
  drawBase()
  drawOverlay()
}

function onWheel(e: WheelEvent): void {
  if (!resultBmp) return
  e.preventDefault()
  stopViewAnim()
  const rect = cvBase.value!.getBoundingClientRect()
  // 触控板捏合带 ctrlKey，增量小、更细腻
  const k = e.ctrlKey ? 0.01 : 0.0016
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoom.value * Math.exp(-e.deltaY * k))
  scheduleHiRes()
}

/** 中键按下时阻止 Chromium 的自动滚动光标 */
function onMouseDown(e: MouseEvent): void {
  if (e.button === 1) e.preventDefault()
}

/* ---------- 指针手势：图层拖拽 / 平移 / 双指捏合 / 双击 ---------- */

interface PointerState {
  x: number
  y: number
  downT: number
  moved: boolean
}
const pointers = new Map<number, PointerState>()

type Gesture =
  | { type: 'idle' }
  | { type: 'layer'; id: string; startClient: { x: number; y: number }; startCx: number; startCy: number }
  | { type: 'photo'; id: string; startClient: { x: number; y: number }; startX: number; startY: number }
  | { type: 'pan'; startPan: { x: number; y: number }; startClient: { x: number; y: number } }
  | {
      type: 'pinch'
      startDist: number
      startZoom: number
      startMid: { x: number; y: number }
      startPan: { x: number; y: number }
    }
  | {
      type: 'crop'
      handle: CropHandle
      startCrop: Crop
      startNx: number
      startNy: number
    }

type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

let gesture: Gesture = { type: 'idle' }
let lastTap: { t: number; x: number; y: number } | null = null

function relCenter(clientX: number, clientY: number): { x: number; y: number } {
  const rect = cvBase.value!.getBoundingClientRect()
  return { x: clientX - rect.left - availCx(), y: clientY - rect.top - availCy() }
}

function pinchInfo(): { dist: number; mid: { x: number; y: number } } {
  const pts = [...pointers.values()]
  const [a, b] = pts
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mid: { x: (a.x + b.x) / 2 - availCx(), y: (a.y + b.y) / 2 - availCy() },
  }
}

/**
 * 拖动中的吸附：把图层中心吸附到图片中线、安全边距线与其他图层中心。
 * 带磁滞——进入吸附用 8px 容差，脱离要超出容差再 6px：没有这段滞回，
 * 手指在吸附线边缘微动时「吸住与释放」逐帧翻转，位置 0~8px 高频跳变
 * （表现为拖动抖动）。吸附状态按轴记在 dragSnap，整个手势期间共享。
 */
const SNAP_HYSTERESIS = 6 // CSS px：脱离吸附的额外距离

let dragSnap: { x: number | null; y: number | null } = { x: null, y: null }

function applySnap(cx: number, cy: number, excludeId: string): { cx: number; cy: number; lines: { x?: number; y?: number } } {
  const out: { cx: number; cy: number; lines: { x?: number; y?: number } } = { cx, cy, lines: {} }
  if (!settings.wmSnap || !resultMap.w) return out
  const dpr = view.dpr || 1
  const cssPerImg = resultMap.scale / dpr
  const threshold = 8 / cssPerImg // 进入吸附的容差（图片 px）
  const leaveThreshold = (8 + SNAP_HYSTERESIS) / cssPerImg
  const imgW = resultMap.w
  const imgH = resultMap.h
  const pxScale = overlayPxScale()
  const xs: number[] = [imgW / 2, imgW * 0.04, imgW * 0.96]
  const ys: number[] = [imgH / 2, imgH * 0.04, imgH * 0.96]
  for (const l of resolvedLayers()) {
    if (l.id === excludeId || !l.visible || l.type === 'border' || l.type === 'background') continue
    const c = layerPivot(l, imgW, imgH, pxScale)
    xs.push(c.x)
    ys.push(c.y)
  }
  // X 轴：已吸附则先给脱离机会（手指真实位置对吸附线的距离），仍吸附就强制对齐
  if (dragSnap.x !== null) {
    if (Math.abs(cx - dragSnap.x) > leaveThreshold) dragSnap.x = null
    else {
      out.cx = dragSnap.x
      out.lines.x = dragSnap.x
    }
  }
  if (dragSnap.x === null) {
    let best = threshold
    for (const x of xs) {
      const d = Math.abs(cx - x)
      if (d < best) {
        best = d
        dragSnap.x = x
        out.cx = x
        out.lines.x = x
      }
    }
  }
  // Y 轴同理
  if (dragSnap.y !== null) {
    if (Math.abs(cy - dragSnap.y) > leaveThreshold) dragSnap.y = null
    else {
      out.cy = dragSnap.y
      out.lines.y = dragSnap.y
    }
  }
  if (dragSnap.y === null) {
    let best = threshold
    for (const y of ys) {
      const d = Math.abs(cy - y)
      if (d < best) {
        best = d
        dragSnap.y = y
        out.cy = y
        out.lines.y = y
      }
    }
  }
  return out
}

/* ---------- 裁剪：框几何 ---------- */

/** 拉直（rot≠0）时框的活动范围：变换后源图中不含透明角落的内接矩形（归一化）。 */
function cropBounds(): { x0: number; y0: number; x1: number; y1: number } {
  const d = adjust.cropDraft
  const a = active.value
  if (!d || !a?.width || !a.height) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  return cropInnerBounds(a.width, a.height, d)
}

/**
 * 把矩形收敛到活动范围内（含最小边）。
 * base 用于保留矩形之外的几何量（拉直角度 / 翻转）：只调整选框时绝不能
 * 把 rot 丢掉——旧实现返回裸矩形，拖动选框或换比例就等于「拉直归零」。
 */
function clampRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bd: { x0: number; y0: number; x1: number; y1: number },
  base?: Pick<Crop, 'rot' | 'flipH' | 'flipV'>,
): Crop {
  const left = Math.min(Math.max(bd.x0, x0), bd.x1 - CROP_MIN)
  const top = Math.min(Math.max(bd.y0, y0), bd.y1 - CROP_MIN)
  const right = Math.min(Math.max(left + CROP_MIN, x1), bd.x1)
  const bottom = Math.min(Math.max(top + CROP_MIN, y1), bd.y1)
  return { ...base, x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 拖动手柄后的新裁剪框（归一化坐标）。比例锁定（ratio 为像素宽高比）时
 * 以锚定边/对角为基准联动另一维，可用空间不足时回缩，比例始终严格成立。
 */
function resizeCrop(
  start: Crop,
  handle: CropHandle,
  nx: number,
  ny: number,
  ratio: number | null,
  imgAspect: number,
  bd: { x0: number; y0: number; x1: number; y1: number },
): Crop {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = Math.min(nx, right - CROP_MIN)
  if (handle.includes('e')) right = Math.max(nx, left + CROP_MIN)
  if (handle.includes('n')) top = Math.min(ny, bottom - CROP_MIN)
  if (handle.includes('s')) bottom = Math.max(ny, top + CROP_MIN)
  if (!ratio) return clampRect(left, top, right, bottom, bd, start)

  const k = imgAspect / ratio // 归一化高 = 归一化宽 × k
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  if (!hasN && !hasS) {
    // 横边：垂直方向以框中心对称伸缩
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const availW = Math.min(2 * (cx - bd.x0), 2 * (bd.x1 - cx))
    const availH = Math.min(2 * (cy - bd.y0), 2 * (bd.y1 - cy))
    let w = Math.min(Math.max(CROP_MIN, right - left), Math.max(CROP_MIN, availW))
    let h = w * k
    if (h > availH) {
      h = Math.max(CROP_MIN, availH)
      w = h / k
    }
    return clampRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bd, start)
  }
  if (!hasW && !hasE) {
    // 纵边：水平方向以框中心对称伸缩
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const availW = Math.min(2 * (cx - bd.x0), 2 * (bd.x1 - cx))
    const availH = Math.min(2 * (cy - bd.y0), 2 * (bd.y1 - cy))
    let h = Math.min(Math.max(CROP_MIN, bottom - top), Math.max(CROP_MIN, availH))
    let w = h / k
    if (w > availW) {
      w = Math.max(CROP_MIN, availW)
      h = w * k
    }
    return clampRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bd, start)
  }
  // 角：对角为锚
  const ax = hasW ? right : left
  const ay = hasN ? bottom : top
  const availW = hasW ? ax - bd.x0 : bd.x1 - ax
  const availH = hasN ? ay - bd.y0 : bd.y1 - ay
  let w = Math.min(
    Math.max(CROP_MIN, hasW ? ax - left : right - ax),
    Math.max(CROP_MIN, availW),
  )
  let h = w * k
  if (h > availH) {
    h = Math.max(CROP_MIN, availH)
    w = h / k
  }
  return {
    ...start,
    x: hasW ? ax - w : ax,
    y: hasN ? ay - h : ay,
    w,
    h,
  }
}

/** 手柄在图片坐标系中的位置（角优先于边做命中）。 */
function cropHandles(d: Crop): { id: CropHandle; x: number; y: number }[] {
  const x0 = d.x * resultMap.w
  const x1 = (d.x + d.w) * resultMap.w
  const y0 = d.y * resultMap.h
  const y1 = (d.y + d.h) * resultMap.h
  const xm = (x0 + x1) / 2
  const ym = (y0 + y1) / 2
  return [
    { id: 'nw', x: x0, y: y0 },
    { id: 'ne', x: x1, y: y0 },
    { id: 'se', x: x1, y: y1 },
    { id: 'sw', x: x0, y: y1 },
    { id: 'n', x: xm, y: y0 },
    { id: 'e', x: x1, y: ym },
    { id: 's', x: xm, y: y1 },
    { id: 'w', x: x0, y: ym },
  ]
}

/** 命中裁剪手柄；框内整体返回 move，框外返回 null（交给平移手势）。 */
function hitCropHandle(p: { x: number; y: number }): CropHandle | null {
  const d = adjust.cropDraft
  if (!d || !resultMap.w) return null
  const dpr = view.dpr || 1
  const cssPerImg = resultMap.scale / dpr
  // 命中半径约 16 CSS px，小框时收进框内避免角/边重叠
  const r = Math.min(16 / cssPerImg, d.w * resultMap.w * 0.45, d.h * resultMap.h * 0.45)
  const hs = cropHandles(d)
  for (const h of hs) {
    if (h.id.length === 2 && Math.hypot(p.x - h.x, p.y - h.y) <= r) return h.id
  }
  for (const h of hs) {
    if (h.id.length === 1 && Math.hypot(p.x - h.x, p.y - h.y) <= r) return h.id
  }
  if (p.x >= d.x * resultMap.w && p.x <= (d.x + d.w) * resultMap.w && p.y >= d.y * resultMap.h && p.y <= (d.y + d.h) * resultMap.h) {
    return 'move'
  }
  return null
}

/** 选择比例后把当前框调整为该比例的最大内接矩形（保持中心，限制在活动范围内）。 */
function applyRatioToDraft(): void {
  const d = adjust.cropDraft
  const a = active.value
  const ratio = cropRatioOf(adjust.cropRatio)
  if (!d || !ratio) return
  // 比例换算用「变换后源图」的宽高比，而不是当前画面映射：
  // 刚改完拉直、精修位图还没回来时，resultMap 仍是旧角度的尺寸
  const src = a?.width && a.height ? cropSourceSize(a.width, a.height, d) : { w: resultMap.w, h: resultMap.h }
  if (!src.w || !src.h) return
  const k = src.w / src.h / ratio
  const bd = cropBounds()
  const cx = d.x + d.w / 2
  const cy = d.y + d.h / 2
  const availW = Math.min(2 * (cx - bd.x0), 2 * (bd.x1 - cx))
  const availH = Math.min(2 * (cy - bd.y0), 2 * (bd.y1 - cy))
  let w = Math.min(d.w, availW)
  let h = w * k
  if (h > availH) {
    h = availH
    w = h / k
  }
  w = Math.max(w, CROP_MIN)
  h = Math.max(h, CROP_MIN)
  // 只换比例，拉直角度与翻转必须原样带走（否则换比例等于把拉直清空）
  adjust.cropDraft = { ...d, ...clampRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bd) }
}

function onPointerDown(e: PointerEvent): void {
  const canvas = cvBase.value
  if (!canvas || !resultMap.w) return
  stopViewAnim()
  if (settleTimer) {
    window.clearTimeout(settleTimer)
    settleTimer = null
  }
  // 白平衡吸管：这一次点击只取色，不进入平移 / 选层 / 裁剪手势
  if (adjust.pickingWb) {
    if (resultId !== (active.value?.id ?? null)) return
    if (e.button === 1) {
      adjust.setPickingWb(false)
      return
    }
    const p = toImagePx(e.clientX, e.clientY)
    const s = sampleResult(p.x, p.y)
    if (s) {
      adjust.applyWhiteBalanceSample(s.r, s.g, s.b)
      const cur = adjust.snapshotFor(active.value?.id ?? null)
      toast(`白平衡已取样：色温 ${cur.temperature}，色调 ${cur.tint}`, 'success')
    }
    adjust.setPickingWb(false)
    return
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, downT: performance.now(), moved: false })
  // 指针已失活（极端时序 / 合成事件）时 capture 会抛错：降级为就近跟踪，不让手势建不起来
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略：move/up 仍会派发到画布元素本身 */
  }

  if (pointers.size === 2) {
    const { dist, mid } = pinchInfo()
    gesture = {
      type: 'pinch',
      startDist: dist,
      startZoom: zoom.value,
      startMid: mid,
      startPan: { x: pan.x, y: pan.y },
    }
    snapLines.value = null
    return
  }
  if (pointers.size > 2) return

  // 渲染结果尚未对应当前照片（新照片解码中）：只允许平移视图，
  // 裁剪 / 图层手势会把旧画面的几何与坐标写到新照片上
  const stale = resultId !== (active.value?.id ?? null)

  // 裁剪模式：手柄/框内交给裁剪手势，其余区域仍可平移视图
  if (adjust.cropMode && adjust.cropDraft && !stale) {
    if (e.button === 1) {
      gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
      return
    }
    const p = toImagePx(e.clientX, e.clientY)
    const hit = hitCropHandle(p)
    if (hit) {
      gesture = {
        type: 'crop',
        handle: hit,
        startCrop: { ...adjust.cropDraft },
        startNx: clamp01(p.x / resultMap.w),
        startNy: clamp01(p.y / resultMap.h),
      }
    } else {
      gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
    }
    return
  }

  const p = toImagePx(e.clientX, e.clientY)
  const list = stale ? [] : resolvedLayers()
  // 中键只负责平移预览，不选中 / 不拖动图层
  if (e.button === 1) {
    wm.selectedId = null
    snapLines.value = null
    gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
    return
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i]
    // 边框层覆盖全画布、无独立位置，只能从图层列表选中
    if (l.type === 'border' || l.type === 'background' || !l.visible) continue
    const box = measureLayer(resolvedLayer(l), resultMap.w, resultMap.h, measureContext(), overlayPxScale())
    if (hitTest(box, p.x, p.y)) {
      wm.selectedId = l.id
      const c = layerPivot(l, resultMap.w, resultMap.h, overlayPxScale())
      dragSnap = { x: null, y: null }
      gesture = {
        type: 'layer',
        id: l.id,
        startClient: { x: e.clientX, y: e.clientY },
        startCx: c.x,
        startCy: c.y,
      }
      return
    }
  }
  // 背景水印存在时，点按照片区域 = 拖动照片在背景上的位置（背景空白仍平移视图）
  if (bgLayout) {
    const r = bgLayout
    if (p.x >= r.photoX && p.x <= r.photoX + r.photoW && p.y >= r.photoY && p.y <= r.photoY + r.photoH) {
      const bg = backgroundLayers()[0]
      if (bg) {
        wm.selectedId = bg.id
        dragSnap = { x: null, y: null }
        gesture = {
          type: 'photo',
          id: bg.id,
          startClient: { x: e.clientX, y: e.clientY },
          startX: bg.offsetX,
          startY: bg.offsetY,
        }
        return
      }
    }
  }
  wm.selectedId = null
  snapLines.value = null
  gesture = { type: 'pan', startPan: { x: pan.x, y: pan.y }, startClient: { x: e.clientX, y: e.clientY } }
}

function onPointerMove(e: PointerEvent): void {
  const pt = pointers.get(e.pointerId)
  if (!pt) return
  const dx = e.clientX - pt.x
  const dy = e.clientY - pt.y
  if (Math.abs(dx) + Math.abs(dy) > 3) pt.moved = true
  pt.x = e.clientX
  pt.y = e.clientY

  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const { dist, mid } = pinchInfo()
    const raw = gesture.startZoom * (dist / gesture.startDist)
    // 捏合允许短暂越过边界，松手回弹
    let z = raw
    if (z < minZoom.value) z = minZoom.value - rubberband(minZoom.value - z, MAX_ZOOM - minZoom.value)
    else if (z > MAX_ZOOM) z = MAX_ZOOM + rubberband(z - MAX_ZOOM, MAX_ZOOM - minZoom.value)
    zoom.value = z
    // 捏合中点下的图像点保持不动（1:1 跟手）
    const u = {
      x: (gesture.startMid.x - gesture.startPan.x) / gesture.startZoom,
      y: (gesture.startMid.y - gesture.startPan.y) / gesture.startZoom,
    }
    pan.x = mid.x - u.x * z
    pan.y = mid.y - u.y * z
    drawBase()
    drawOverlay()
    return
  }

  if (gesture.type === 'crop') {
    if (!resultMap.w) return
    const p = toImagePx(e.clientX, e.clientY)
    const nx = clamp01(p.x / resultMap.w)
    const ny = clamp01(p.y / resultMap.h)
    const d = gesture.startCrop
    const bd = cropBounds()
    if (gesture.handle === 'move') {
      // 拉直后活动范围会小于已有框：先把框收进范围，再按位移移动，
      // 否则 bd.x1 - d.w 会小于 bd.x0，框被推到范围外（看起来像「裁剪被重置」）
      const w = Math.min(d.w, Math.max(CROP_MIN, bd.x1 - bd.x0))
      const h = Math.min(d.h, Math.max(CROP_MIN, bd.y1 - bd.y0))
      const x = Math.min(Math.max(bd.x0, d.x + nx - gesture.startNx), Math.max(bd.x0, bd.x1 - w))
      const y = Math.min(Math.max(bd.y0, d.y + ny - gesture.startNy), Math.max(bd.y0, bd.y1 - h))
      adjust.cropDraft = { x, y, w, h, rot: d.rot, flipH: d.flipH, flipV: d.flipV }
    } else {
      const ratio = cropRatioOf(adjust.cropRatio)
      // 与比例换算同源：以变换后源图为准，避免精修位图未回来时用到旧角度尺寸
      const img = active.value
      const src =
        img?.width && img.height
          ? cropSourceSize(img.width, img.height, d)
          : { w: resultMap.w, h: resultMap.h }
      const imgAspect = src.w / Math.max(1, src.h)
      adjust.cropDraft = resizeCrop(d, gesture.handle, nx, ny, ratio, imgAspect, bd)
    }
    drawOverlay()
    return
  }

  if (gesture.type === 'layer') {
    const canvas = cvBase.value
    if (!canvas || !resultMap.w) return
    const gid = gesture.id
    const dpr = view.dpr || 1
    const cssPerImg = resultMap.scale / dpr
    const imgW = resultMap.w
    const imgH = resultMap.h
    const proposedX = gesture.startCx + (e.clientX - gesture.startClient.x) / cssPerImg
    const proposedY = gesture.startCy + (e.clientY - gesture.startClient.y) / cssPerImg
    const snapped = applySnap(proposedX, proposedY, gid)
    const cx = Math.min(imgW, Math.max(0, snapped.cx))
    const cy = Math.min(imgH, Math.max(0, snapped.cy))
    const layer = wm.editTarget().find((l) => l.id === gid)
    if (!layer || layer.type === 'border' || layer.type === 'background') return
    const a = anchorPoint(layer.anchor, imgW, imgH)
    snapLines.value = snapped.lines.x !== undefined || snapped.lines.y !== undefined ? snapped.lines : null
    // 定位点与位移都在叠加层坐标系：写入前折算回原图尺度的 offset。
    // 拖动中保留浮点不取整——offset 折算系数 <1 时 round 的量化步长在屏幕上
    // 放大且不均匀（1px、2px 交替），是拖动抖动的来源之一；松手时统一取整
    const pxScale = overlayPxScale()
    wm.update(gid, {
      offsetX: (cx - a.x) / pxScale,
      offsetY: (cy - a.y) / pxScale,
    })
    return
  }

  if (gesture.type === 'photo') {
    // 拖动照片在背景上的位置：主线程即时组合，Worker 不参与。
    // bg.offsetX 是原图尺度像素：屏幕位移按取样系数折算；吸附与水印拖动
    // 共用同一套磁滞（dragSnap），拖动中保持浮点、松手时统一取整
    if (!resultMap.w || !bgLayout) return
    const dpr = view.dpr || 1
    const cssPerImg = resultMap.scale / dpr
    const pxScale = resultPhoto.renderScale || 1
    let nx = gesture.startX + (e.clientX - gesture.startClient.x) / cssPerImg / pxScale
    let ny = gesture.startY + (e.clientY - gesture.startClient.y) / cssPerImg / pxScale
    if (settings.wmSnap) {
      const threshold = 8 / cssPerImg
      const leaveThreshold = (8 + SNAP_HYSTERESIS) / cssPerImg
      // 照片中心（未吸附）= 画布中线 + 当前 offset（绝对式）。不能用
      // bgLayout.photoX + 增量：photoX 已含上一帧 offset，再叠加增量会
      // 把吸附修正重复计入形成正反馈——吸附状态逐帧振荡（拖动抖动主因）
      const cx = bgLayout.frameW / 2 + nx * pxScale
      const cy = bgLayout.frameH / 2 + ny * pxScale
      const lines: { x?: number; y?: number } = {}
      // 磁滞：已吸附的轴先判断脱离（按手指真实位置），仍吸附则强制对齐
      if (dragSnap.x !== null) {
        if (Math.abs(cx - dragSnap.x) > leaveThreshold) dragSnap.x = null
        else {
          nx += (dragSnap.x - cx) / pxScale
          lines.x = dragSnap.x
        }
      }
      if (dragSnap.x === null) {
        let best = threshold
        for (const x of [bgLayout.frameW / 2, bgLayout.frameW * 0.04, bgLayout.frameW * 0.96]) {
          const d = Math.abs(cx - x)
          if (d < best) {
            best = d
            dragSnap.x = x
            nx += (x - cx) / pxScale
            lines.x = x
          }
        }
      }
      if (dragSnap.y !== null) {
        if (Math.abs(cy - dragSnap.y) > leaveThreshold) dragSnap.y = null
        else {
          ny += (dragSnap.y - cy) / pxScale
          lines.y = dragSnap.y
        }
      }
      if (dragSnap.y === null) {
        let best = threshold
        for (const y of [bgLayout.frameH / 2, bgLayout.frameH * 0.04, bgLayout.frameH * 0.96]) {
          const d = Math.abs(cy - y)
          if (d < best) {
            best = d
            dragSnap.y = y
            ny += (y - cy) / pxScale
            lines.y = y
          }
        }
      }
      snapLines.value = lines.x !== undefined || lines.y !== undefined ? lines : null
    }
    wm.update(gesture.id, { offsetX: nx, offsetY: ny })
    drawBase()
    drawOverlay()
    return
  }

  if (gesture.type === 'pan') {
    const d = displaySize()
    pan.x = clampPanAxis(
      gesture.startPan.x + (e.clientX - gesture.startClient.x),
      d.w,
      avail.w,
      zoom.value,
      true,
      PAN_MARGIN,
    )
    pan.y = clampPanAxis(
      gesture.startPan.y + (e.clientY - gesture.startClient.y),
      d.h,
      avail.h,
      zoom.value,
      true,
      PAN_MARGIN,
    )
    drawBase()
    drawOverlay()
  }
}

/**
 * 拖动结束：把拖动产生的浮点 offset 取整落库。拖动中为平滑跟手不取整
 * （round 的量化步长经 pxScale 折算会在屏幕上放大且不均匀——抖动来源），
 * 数据落盘仍保持整数。
 */
function settleDragGesture(g: Gesture): void {
  if (g.type !== 'photo' && g.type !== 'layer') return
  const l = wm.editTarget().find((x) => x.id === g.id)
  if (!l || !('offsetX' in l) || !('offsetY' in l)) return
  wm.update(g.id, { offsetX: Math.round(l.offsetX), offsetY: Math.round(l.offsetY) })
}

function onPointerUp(e: PointerEvent): void {
  const pt = pointers.get(e.pointerId)
  pointers.delete(e.pointerId)
  const g = gesture

  if (g.type === 'pinch') {
    if (pointers.size < 2) {
      gesture = { type: 'idle' }
      // 松手回弹：缩放回到合法区间，平移回到边界内
      const tz = Math.min(MAX_ZOOM, Math.max(minZoom.value, zoom.value))
      const d = displaySize()
      zoom.value = tz
      const tx = clampPanAxis(pan.x, d.w, avail.w, zoom.value, false, PAN_MARGIN)
      const ty = clampPanAxis(pan.y, d.h, avail.h, zoom.value, false, PAN_MARGIN)
      if (Math.abs(tx - pan.x) > 0.5 || Math.abs(ty - pan.y) > 0.5) {
        animateViewTo(tz, tx, ty)
      } else {
        hardClampPan()
        drawBase()
        drawOverlay()
      }
      scheduleHiRes()
    }
    return
  }

  if (pointers.size > 0) {
    if (g.type === 'layer' || g.type === 'photo' || g.type === 'pan') {
      // 多指接管（如拖动中第二指落下）：本手势结束，位移量取整落库
      settleDragGesture(g)
      gesture = { type: 'idle' }
      snapLines.value = null
      scheduleOverlay()
    }
    return
  }

  gesture = { type: 'idle' }
  snapLines.value = null
  settleDragGesture(g)
  scheduleOverlay()

  // 双击/双触：快速且几乎未移动的两次点按 → 放大/还原
  const now = performance.now()
  const isTap = pt && !pt.moved && now - pt.downT < 300
  if (isTap && lastTap && now - lastTap.t < 340 && Math.hypot(pt!.x - lastTap.x, pt!.y - lastTap.y) < 28) {
    lastTap = null
    if (zoom.value > minZoom.value + 0.01) {
      animateViewTo(minZoom.value, 0, 0)
    } else {
      // 计算锚定该点、且已约束到边界内的目标视图，再从当前值动画过去
      const c = relCenter(pt!.x, pt!.y)
      const u = { x: (c.x - pan.x) / zoom.value, y: (c.y - pan.y) / zoom.value }
      const z0 = zoom.value
      const p0 = { x: pan.x, y: pan.y }
      zoom.value = DBL_TAP_ZOOM
      pan.x = c.x - u.x * DBL_TAP_ZOOM
      pan.y = c.y - u.y * DBL_TAP_ZOOM
      hardClampPan()
      const target = { x: pan.x, y: pan.y }
      zoom.value = z0
      pan.x = p0.x
      pan.y = p0.y
      animateViewTo(DBL_TAP_ZOOM, target.x, target.y)
    }
    return
  }
  if (isTap) lastTap = { t: now, x: pt!.x, y: pt!.y }

  // 平移结束：越界回弹（与拖动中、硬夹紧一样以让位后的可用区域为基准，
  // 面板展开时全视口基准会把图片放行到面板底下，造成部分内容无法拖回）
  if (g.type === 'pan') {
    const d = displaySize()
    const tx = clampPanAxis(pan.x, d.w, avail.w, zoom.value, false, PAN_MARGIN)
    const ty = clampPanAxis(pan.y, d.h, avail.h, zoom.value, false, PAN_MARGIN)
    if (Math.abs(tx - pan.x) > 0.5 || Math.abs(ty - pan.y) > 0.5) {
      animateViewTo(zoom.value, tx, ty)
    }
  }
}

/**
 * 缩放结束后按需重渲：自适应档跟随缩放双向调整（放大补精度、缩小降开销），
 * 固定档位只向上补到档位上限，不会主动降分辨率。
 */
function scheduleHiRes(): void {
  if (settleTimer) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    if (!resultBmp || !active.value) return
    // 固定档位的期望分辨率同样受精修档位封顶：放大到大倍率时若按缩放值计算，
    // 每次停顿都会触发一次输出完全相同的全管线渲染（安卓上一次要数秒）
    const adaptive = settings.previewQuality === 'adaptive'
    const desired = adaptive
      ? adaptiveLong()
      : Math.min(
          perf.value.final,
          Math.round(Math.max(view.w, view.h) * zoom.value * (view.dpr || 1)),
        )
    const current = Math.max(resultBmp.width, resultBmp.height)
    // 放大：差出可见的一档才补渲；缩小：明显超出需求才降一档。
    // 75% 的滞回避免在阈值附近反复重渲（安卓上一次全管线要数秒）
    const needMore = desired > current + (adaptive ? 80 : 100)
    const needLess = adaptive && desired < current * 0.75
    if (!needMore && !needLess) return
    rendering.value = true
    void renderBase(false).finally(() => {
      rendering.value = false
    })
  }, 280)
}

function resetView(): void {
  stopViewAnim()
  zoom.value = minZoom.value
  pan.x = 0
  pan.y = 0
}

/* ---------- 渲染调度 ---------- */

// 底图相关变化才走 Worker；水印图层变化只重绘叠加层。
// 边框参数与背景层的存在性决定 Worker 输出（扩展画布 vs 环带）；背景层
// 其余参数只作用于主线程组合，拖动 / 滑杆不需要进 Worker
let lastBaseSig = ""
function baseSignature(): string {
  const list = wm.effectiveLayers(active.value?.id ?? null)
  return JSON.stringify([
    list.filter((l) => l.type === "border").map((l) => toRaw(l)),
    list
      .filter((l) => l.type === "background")
      .map((l) => ({ id: l.id, visible: l.visible })),
  ])
}

// 背景层的布局参数（外扩 / 画幅比例 / 偏移 / 模糊 / 缩放等）只作用于主线程
// 组合——签名变了重画底图（画布尺寸、模糊缓存键、照片矩形都随之变），
// 不需要进 Worker；其余图层变化只重绘叠加层
let lastBgLayoutSig = ""
function bgLayoutSignature(): string {
  return JSON.stringify(
    wm
      .effectiveLayers(active.value?.id ?? null)
      .filter((l) => l.type === "background")
      .map((l) => toRaw(l)),
  )
}
watch(
  [
    active,
    () => adjust.values,
    () => adjust.perImage,
    () => settings.previewQuality,
    () => settings.previewQualityValue,
    () => adjust.cropMode,
    () => adjust.crops,
  ],
  () => scheduleBase(),
  { deep: true },
)
watch(
  [() => wm.layers, () => wm.perImage, () => wm.bgOverrides, () => wm.selectedId],
  () => {
    const sig = baseSignature()
    if (sig !== lastBaseSig) {
      lastBaseSig = sig
      scheduleBase()
    } else {
      const bgSig = bgLayoutSignature()
      if (bgSig !== lastBgLayoutSig) {
        lastBgLayoutSig = bgSig
        drawBase()
      }
      scheduleOverlay()
    }
  },
  { deep: true },
)

// 打开项目后的第一张照片回到适应视图；浏览中切换照片保持当前缩放与
// 视角（对比同一张的不同部位、或按固定比例过片时，视图不该被打断）。
// 照片还没装载（渐进补齐未轮到）就按需读取这一张，预览不必等整批队列，
// 装载完成后 watch 自动渲染
let lastActiveId: string | null = null
watch(
  () => active.value?.id,
  (id) => {
    // 换照片即结束取样：吸管是「当前这张」的动作，跨图保留会误点
    adjust.setPickingWb(false)
    if (!lastActiveId && id) resetView()
    lastActiveId = id ?? null
    void ws.ensureImageLoaded(id)
  },
)

// 离开调节页也结束取样，避免十字光标残留在裁剪 / 导出页
watch(
  () => adjust.panel,
  (p) => {
    if (p !== 'adjust') adjust.setPickingWb(false)
  },
)

/* ---------- 裁剪模式 ---------- */

// 进入时以当前裁剪为起点（无则整图），并回到适应视图看清全图；
// 退出时重新适应，确保确认后的裁剪结果完整呈现
watch(
  () => adjust.cropMode,
  (on) => {
    if (on) {
      const a = active.value
      adjust.cropRatio = 'free'
      adjust.cropDraft = { ...(a ? (adjust.cropOf(a.id) ?? FULL_CROP) : FULL_CROP) }
      void ensureCropPreview()
      fitView()
    } else {
      adjust.cropDraft = null
      releaseCropPreview()
      fitView()
    }
  },
)

// 编辑中切换照片：先把草稿存给旧照片（自动保存，与切面板同一语义），
// 再把框带到新照片（已裁剪用其裁剪，否则整图）
watch(
  [() => adjust.cropMode, () => active.value?.id],
  ([on], [prevOn, prevId]) => {
    if (prevOn && prevId && prevId !== active.value?.id) {
      adjust.commitCropDraft(prevId)
    }
    if (!on) return
    const a = active.value
    adjust.cropDraft = { ...(a ? (adjust.cropOf(a.id) ?? FULL_CROP) : FULL_CROP) }
  },
)

// 比例切换：立即把框调整为该比例的最大内接矩形
watch(
  () => adjust.cropRatio,
  () => {
    applyRatioToDraft()
    drawOverlay()
  },
)

// 草稿被指针以外的来源改动（撤销 / 重做回填）时重绘裁剪叠加层：
// 拖动路径自己会调用 drawOverlay，这里兜住其余入口，避免框与照片状态不一致
watch(
  () => adjust.cropDraft,
  () => {
    if (adjust.cropMode) drawOverlay()
  },
  { deep: true },
)

// 翻转 / 拉直变化：先在主线程用低清位图即时粗渲（拖动中实时跟手），
// 停顿 140ms 后再交给 Worker 精修（保留防抖，只在停顿时渲染一次）
watch(
  () => {
    const d = adjust.cropDraft
    return d ? `${d.rot ?? 0}|${d.flipH ? 1 : 0}|${d.flipV ? 1 : 0}` : ''
  },
  () => {
    if (!adjust.cropMode) return
    drawRotatedDraft()
    rendering.value = true
    if (finalTimer) window.clearTimeout(finalTimer)
    finalTimer = window.setTimeout(() => {
      void renderBase(false).finally(() => {
        rendering.value = false
      })
    }, 140)
  },
)

function onCropKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (adjust.pickingWb) {
    adjust.setPickingWb(false)
    return
  }
  if (adjust.cropMode) adjust.exitCrop()
}

onMounted(() => {
  window.addEventListener('keydown', onCropKey)
  if (frame.value) {
    ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      view.w = r.width
      view.h = r.height
      view.dpr = window.devicePixelRatio || 1
      hardClampPan()
      drawBase()
      drawOverlay()
      scheduleBase()
    })
    ro.observe(frame.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCropKey)
  ro?.disconnect()
  if (finalTimer) window.clearTimeout(finalTimer)
  if (settleTimer) window.clearTimeout(settleTimer)
  if (availAnim) cancelAnimationFrame(availAnim)
  stopViewAnim()
  releaseCropPreview()
  document.removeEventListener('click', closeZoomMenu)
  document.removeEventListener('keydown', onZoomKey)
  if (srcBitmap) {
    srcBitmap.close()
    srcBitmap = null
  }
  if (resultBmp) {
    resultBmp.close()
    resultBmp = null
  }
  for (const bmp of assetBmps.values()) bmp.close()
  assetBmps.clear()
})
</script>

<template>
  <div class="canvas-wrap">
    <div ref="frame" class="frame">
      <canvas
        ref="cvBase"
        class="canvas"
        :class="{ picking: adjust.pickingWb }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
        @mousedown="onMouseDown"
        @auxclick.prevent
        @contextmenu="emit('ctx', $event)"
      />
      <canvas ref="cvOverlay" class="canvas overlay" aria-hidden="true" />
      <div
        v-if="hasSelection && selRect"
        class="sel"
        :style="{
          left: `${selRect.left}px`,
          top: `${selRect.top}px`,
          width: `${selRect.width}px`,
          height: `${selRect.height}px`,
          transform: `rotate(${selRect.rotate}deg)`,
        }"
      />
    </div>
    <Transition name="fade">
      <div v-if="rendering && !adjust.pickingWb" class="render-hint" aria-hidden="true">
        <span class="render-spin" />渲染中
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="adjust.pickingWb" class="pick-hint" aria-hidden="true">
        <Pipette :size="12" />点按画面中的中性灰或白色
      </div>
    </Transition>
    <button
      class="zoom-badge"
      :class="{ open: zoomMenuOpen }"
      title="缩放预设"
      @click.stop="zoomMenuOpen = !zoomMenuOpen"
    >
      {{ Math.round(zoom * 100) }}%
      <ChevronUp class="zoom-caret" :size="11" />
      <Transition name="zoom-pop">
        <div v-if="zoomMenuOpen" class="zoom-pop" @click.stop>
          <button
            v-for="p in ZOOM_PRESETS"
            :key="p.label"
            class="zoom-item"
            :class="{ on: p.value !== 'fit' && Math.abs(p.value - zoom) < 0.001 }"
            @click.stop="zoomMenuOpen = false; applyPreset(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
      </Transition>
    </button>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: absolute;
  inset: 0;
  background: var(--canvas);
}
/* 预览安全区：图片适配与命中计算都基于这一帧，移动端避开系统手势条 */
.frame {
  position: absolute;
  inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
}
.overlay {
  pointer-events: none;
}
.canvas.picking {
  cursor: crosshair;
}
.canvas:active {
  cursor: grabbing;
}
.canvas.picking:active {
  cursor: crosshair;
}
/* 吸管提示：与渲染提示同位置同风格，同一时刻只会出现一个 */
.pick-hint {
  position: absolute;
  left: calc(10px + var(--safe-left));
  bottom: calc(40px + var(--safe-bottom));
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--accent);
  pointer-events: none;
}
.sel {
  position: absolute;
  pointer-events: none;
  border: 1.5px solid var(--accent);
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  transition: box-shadow var(--dur-fast) var(--ease);
}
/* 渲染中提示：与缩放药丸同风格的小徽章 */
.render-hint {
  position: absolute;
  left: calc(10px + var(--safe-left));
  bottom: calc(40px + var(--safe-bottom));
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  font-size: calc(11px * var(--ui-zoom, 1));
  color: var(--text-2);
}
.render-spin {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  border-top-color: var(--accent);
  animation: render-spin 0.9s linear infinite;
}
@keyframes render-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .render-spin {
    animation-duration: 2s;
  }
}
.zoom-badge {
  position: absolute;
  left: calc(10px + var(--safe-left));
  bottom: calc(10px + var(--safe-bottom));
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: var(--blur-material);
  -webkit-backdrop-filter: var(--blur-material);
  font-size: calc(11px * var(--ui-zoom, 1));
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
  transition: color var(--dur-hover) var(--ease-soft), border-color var(--dur-hover) var(--ease-soft),
    padding var(--dur-hover) var(--ease-soft);
}
/* 箭头默认不占位，悬停 / 打开时药丸扩宽、箭头滑入 */
.zoom-caret {
  width: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateY(1px);
  transition: opacity var(--dur-hover) var(--ease-soft), transform var(--dur-hover) var(--ease-soft),
    width var(--dur-hover) var(--ease-soft), margin-left var(--dur-hover) var(--ease-soft);
}
.zoom-badge:hover,
.zoom-badge.open {
  color: var(--text);
  border-color: var(--line-strong);
  padding-right: 6px;
}
.zoom-badge:hover .zoom-caret,
.zoom-badge.open .zoom-caret {
  width: 11px;
  margin-left: 3px;
  opacity: 0.75;
  transform: translateY(0);
}
.zoom-badge.open .zoom-caret {
  transform: rotate(-180deg);
}
/* 缩放预设：在数值上方弹出 */
.zoom-pop {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 118px;
  padding: 5px;
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  background: var(--surface-solid);
  box-shadow: var(--shadow-2);
  transform-origin: bottom left;
}
.zoom-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border-radius: 7px;
  text-align: left;
  font-size: calc(12.5px * var(--ui-zoom, 1));
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  transition: background var(--dur-hover) var(--ease-soft), color var(--dur-hover) var(--ease-soft);
}
.zoom-item:hover {
  background: var(--hover);
  color: var(--text);
}
.zoom-item.on {
  color: var(--accent);
  font-weight: 600;
}
.zoom-pop-enter-active,
.zoom-pop-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.zoom-pop-enter-from,
.zoom-pop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}
</style>
