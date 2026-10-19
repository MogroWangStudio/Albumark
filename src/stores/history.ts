import { computed, nextTick, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { FULL_CROP, type Adjustments, type Crop } from '@/types/adjust'
import type { WatermarkLayer } from '@/types/watermark'
import { toast } from './toast'
import { useAdjustStore } from './adjust'
import { useImagesStore } from './images'
import { useWatermarkStore } from './watermark'
import { useWorkspaceStore } from './workspace'

/**
 * 全局撤销 / 重做。
 *
 * 采用「整份快照」而不是逐条命令：编辑操作分散在三个 store
 * （调节、裁剪、水印），快照能保证任意组合都能精确回退，
 * 也不会因为某一处新功能忘了登记命令而漏掉撤销点。
 * 快照里只有纯数据（图层不含素材位图，素材单独存在 assets 里），
 * 40 步的量级对内存没有压力。
 */
interface EditState {
  values: Adjustments
  perImage: Record<string, Adjustments>
  crops: Record<string, Crop>
  layers: WatermarkLayer[]
  wmPerImage: Record<string, WatermarkLayer[]>
}

interface Entry {
  state: EditState
  /** 这一步做了什么，用于按钮提示「撤销调节 / 撤销水印 / 撤销裁剪」 */
  label: string
}

/** 历史深度：连续拖滑杆只会按停顿合并，40 步足够覆盖一次完整调整 */
const LIMIT = 40
/** 连续操作的合并窗口：滑杆拖动停下 320ms 才落一步 */
const IDLE = 320

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const useHistoryStore = defineStore('history', () => {
  const adjust = useAdjustStore()
  const wm = useWatermarkStore()
  const images = useImagesStore()
  const ws = useWorkspaceStore()

  const past = ref<Entry[]>([])
  const future = ref<Entry[]>([])
  const current = ref<Entry | null>(null)

  /** 回填期间屏蔽监听，避免「恢复」本身又生成一步历史 */
  let applying = false
  let timer: number | null = null
  /** 有改动尚未落步（防抖窗口内）：撤销按钮应立即变为可用 */
  const pending = ref(false)

  const canUndo = computed(() => past.value.length > 0 || pending.value)
  const canRedo = computed(() => future.value.length > 0 && !pending.value)
  const undoLabel = computed(() => current.value?.label ?? '')
  const redoLabel = computed(() => future.value[future.value.length - 1]?.label ?? '')
  /** 水印工作室是沙盒草稿，保存语义独立，不参与照片编辑的撤销 */
  const suspended = computed(() => wm.studioActive)

  function snapshot(): EditState {
    return {
      values: clone(adjust.values),
      perImage: clone(adjust.perImage),
      crops: clone(adjust.crops),
      layers: clone(wm.layers),
      wmPerImage: clone(wm.perImage),
    }
  }

  /** 比对两份快照，判断这次改动属于哪一类编辑 */
  function labelFor(a: EditState, b: EditState): string {
    if (!same(a.crops, b.crops)) return '裁剪'
    if (!same(a.layers, b.layers) || !same(a.wmPerImage, b.wmPerImage)) return '水印'
    if (!same(a.values, b.values) || !same(a.perImage, b.perImage)) return '调节'
    return '编辑'
  }

  function commit(): void {
    if (applying) return
    pending.value = false
    const state = snapshot()
    if (!current.value) {
      current.value = { state, label: '编辑' }
      return
    }
    if (same(state, current.value.state)) return
    const label = labelFor(current.value.state, state)
    past.value.push(current.value)
    if (past.value.length > LIMIT) past.value.shift()
    current.value = { state, label }
    future.value = []
  }

  function schedule(): void {
    if (applying || wm.studioActive) return
    pending.value = true
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      commit()
    }, IDLE)
  }

  /** 立刻结算防抖中的改动：撤销前必须先把它落成一步，否则会撤掉上一步 */
  function flush(): void {
    if (!timer) return
    window.clearTimeout(timer)
    timer = null
    commit()
  }

  function restore(s: EditState): void {
    applying = true
    adjust.restoreState({ values: s.values, perImage: s.perImage, crops: s.crops })
    wm.restoreState(s.layers, s.wmPerImage)
    wm.setEditContext(images.activeId)
    // 正在裁剪页时把草稿同步到回填后的裁剪，避免预览与实际状态脱节
    if (adjust.cropMode) {
      const c = adjust.cropOf(images.activeId)
      adjust.cropDraft = c ? { ...c } : { ...FULL_CROP }
    }
    void nextTick(() => {
      applying = false
    })
  }

  function undo(): void {
    if (wm.studioActive) {
      toast('水印工作室的草稿不进入撤销历史')
      return
    }
    flush()
    const prev = past.value.pop()
    if (!prev) {
      toast('没有可撤销的操作')
      return
    }
    if (current.value) future.value.push(current.value)
    current.value = prev
    restore(prev.state)
  }

  function redo(): void {
    if (wm.studioActive) {
      toast('水印工作室的草稿不进入撤销历史')
      return
    }
    flush()
    const next = future.value.pop()
    if (!next) {
      toast('没有可重做的操作')
      return
    }
    if (current.value) {
      past.value.push(current.value)
      if (past.value.length > LIMIT) past.value.shift()
    }
    current.value = next
    restore(next.state)
  }

  /** 以当前状态为起点清空历史：启动装载完成、切换项目时调用 */
  function reset(): void {
    if (timer) {
      window.clearTimeout(timer)
      timer = null
    }
    pending.value = false
    past.value = []
    future.value = []
    current.value = { state: snapshot(), label: '编辑' }
  }

  // 编辑相关的五个数据源：任意一个变化都记一步（连续操作按停顿合并）
  watch(
    [
      () => adjust.values,
      () => adjust.perImage,
      () => adjust.crops,
      () => wm.layers,
      () => wm.perImage,
    ],
    schedule,
    { deep: true },
  )

  // 换项目：旧项目的历史不能套用到新项目上
  watch(
    () => ws.current?.id ?? null,
    () => reset(),
  )
  // 换水印作用域（工作目录 / 临时项目）：水印 store 换装配置后立即重立基线。
  // 跟随 wm.scopeKey 而不是目录路径——临时项目没有目录，作用域也会切换；
  // 否则「载入新目录的水印」会被记成一步可撤销的编辑，一按撤销就把
  // 上一个目录的水印带回来
  watch(
    () => wm.scopeKey,
    () => reset(),
  )

  current.value = { state: snapshot(), label: '编辑' }

  return {
    past,
    future,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    suspended,
    undo,
    redo,
    reset,
    flush,
  }
})
