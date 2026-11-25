import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  checkForUpdate,
  compareVersions,
  downloadUpdate,
  installStagedUpdate,
  listReleases,
  releaseToUpdateInfo,
  type DownloadBuffer,
  type ReleaseEntry,
  type UpdateInfo,
} from '@/core/updater'
import { APP_VERSION } from '@/core/version'
import { t } from '@/i18n'
import { toast } from '@/stores/toast'
import { useSettingsStore } from '@/stores/settings'

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'paused'
  | 'ready'
  | 'installing'
  | 'error'

/** 下载完成后自动重启安装的读秒秒数 */
const AUTO_INSTALL_SEC = 6

/**
 * 全局更新状态机：从设置页提升为常驻 store。设置页是 v-if 挂载的覆盖页，
 * 切走即卸载——此前下载进度、断点缓冲与读秒安装都随组件丢失，用户在
 * 下载期间离开设置页就「没有任何信息显示」且下载实质报废。现在状态
 * 全局常驻：下载中切走页面继续在后台跑，更新弹窗与设置页共享同一状态，
 * 下载 / 暂停 / 安装等动作收敛在更新弹窗内单一交互面。
 */
export const useUpdaterStore = defineStore('updater', () => {
  const settings = useSettingsStore()

  const updateState = ref<UpdateState>('idle')
  const updateInfo = ref<UpdateInfo | null>(null)
  /** 下载进度：null = 总大小未知，只显示进行中 */
  const updateProgress = ref<number | null>(null)
  /** 下载速度（KB/s）：≥400ms 采样一次，暂停 / 完成时归 null */
  const downloadSpeed = ref<number | null>(null)
  /** 断点续传缓冲：暂停时保留已下载字节，继续时原样传回 */
  let downloadBuf: DownloadBuffer | null = null
  /** 暂停标记：区分「暂停」与「取消」两种 abort */
  let pauseRequested = false
  /** 下载完成的暂存路径：读秒结束后派发替换脚本用 */
  const stagedPath = ref('')
  /** 读秒：N 秒后自动重启安装 */
  const countdown = ref(0)
  let countdownTimer: number | undefined
  /** 下载中的取消句柄：downloadUpdate 的 AbortController */
  let downloadCtl: AbortController | null = null

  /** 更新弹窗开合：检查发现新版本即自动弹出，之后可随时从设置页打开 */
  const dialogOpen = ref(false)
  function openDialog(): void {
    dialogOpen.value = true
  }
  function closeDialog(): void {
    dialogOpen.value = false
  }

  /* ---------- 版本列表：查看全部版本、更新或降级 ---------- */

  /** 版本列表弹窗开合（与更新弹窗同挂 App 全局层，切设置页不丢） */
  const versionListOpen = ref(false)
  /** 全部发布版本（含预发布），按版本号从新到旧 */
  const releases = ref<ReleaseEntry[]>([])
  const releasesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')

  function openVersionList(): void {
    versionListOpen.value = true
    if (releasesState.value === 'idle') void loadReleases()
  }

  function closeVersionList(): void {
    versionListOpen.value = false
  }

  /** 拉取版本列表：失败保留错误态，弹窗里给重试入口 */
  async function loadReleases(force = false): Promise<void> {
    if (releasesState.value === 'loading') return
    releasesState.value = 'loading'
    try {
      releases.value = await listReleases(settings.updateSource, force)
      releasesState.value = 'ready'
    } catch {
      releasesState.value = 'error'
    }
  }

  /** 当前选中的目标版本是否为降级（低于正在运行的版本） */
  const isDowngrade = computed(
    () => !!updateInfo.value && compareVersions(updateInfo.value.version, APP_VERSION) < 0,
  )

  /**
   * 选中某个版本作为下载目标：先结束进行中的下载 / 读秒并丢弃旧断点，
   * 再解析该版本的资产，最后关掉版本列表、打开更新弹窗走同一套下载安装流程。
   * 降级与升级共用这条链路，差别只在弹窗文案与警告。
   */
  async function selectRelease(entry: ReleaseEntry): Promise<void> {
    stopCountdown()
    pauseRequested = false
    downloadCtl?.abort()
    downloadCtl = null
    downloadBuf = null
    updateProgress.value = null
    downloadSpeed.value = null
    updateState.value = 'checking'
    try {
      updateInfo.value = await releaseToUpdateInfo(entry, settings.updateSource)
      updateState.value = 'available'
      versionListOpen.value = false
      openDialog()
    } catch {
      updateState.value = 'error'
      toast(t('无法获取该版本的安装包信息，请前往发布页手动下载'), 'error')
    }
  }

  async function checkUpdate(): Promise<void> {
    updateState.value = 'checking'
    updateInfo.value = null
    try {
      const info = await checkForUpdate(settings.updateChannel, settings.updateSource)
      updateInfo.value = info
      updateState.value = info ? 'available' : 'latest'
      // 检查到新版本：自动弹出更新窗口（更新日志 / 进度 / 操作的集中查看面）
      if (info) openDialog()
    } catch {
      updateState.value = 'error'
    }
  }

  /** 检查结果失效（换渠道 / 换线路）：复位等待重新检查 */
  function resetCheck(): void {
    stopCountdown()
    updateState.value = 'idle'
    updateInfo.value = null
  }

  /** 下载更新包：安卓下载完直接交给系统安装器；桌面端暂存后进入读秒。
   *  下载中可暂停（abort 保留断点缓冲）与取消；传 resume 即从断点续传。 */
  async function runDownload(resume?: DownloadBuffer): Promise<void> {
    if (!updateInfo.value || updateState.value === 'downloading') return
    updateState.value = 'downloading'
    if (!resume) {
      updateProgress.value = null
      downloadBuf = { chunks: [], loaded: 0, total: 0 }
    }
    downloadSpeed.value = null
    pauseRequested = false
    const ctl = new AbortController()
    downloadCtl = ctl
    try {
      const out = await downloadUpdate(
        updateInfo.value,
        (pct, kbps) => {
          if (pct !== null) updateProgress.value = pct
          if (kbps !== null) downloadSpeed.value = kbps
        },
        ctl.signal,
        settings.updateSource,
        resume ?? downloadBuf ?? undefined,
      )
      if (ctl.signal.aborted) return // 已中断：丢弃结果，状态由 pause/cancel 复位
      downloadBuf = null
      if (out.kind === 'auto') {
        // 安卓：已交给系统安装器，回到待更新态（取消安装可再次拉起）
        toast(out.message, 'success')
        updateState.value = 'available'
        return
      }
      stagedPath.value = out.stagedPath
      updateState.value = 'ready'
      startCountdown()
    } catch (err) {
      if (ctl.signal.aborted) {
        // 已被新目标版本接管（版本列表里改选）：状态由 selectRelease 负责，
        // 旧任务不能把手动选中的版本状态改回「待更新」
        if (downloadCtl !== ctl) return
        // 暂停：缓冲保留（updateProgress 不清），等「继续下载」从断点接着走
        updateState.value = pauseRequested ? 'paused' : 'available'
        return
      }
      // 传输层错误（断网 / 服务端异常）：缓冲保留，可从断点继续或放弃
      toast(
        t(
          '更新失败：{0}',
          err instanceof Error ? err.message : t('请稍后重试，或前往下载页手动获取'),
        ),
        'error',
      )
      updateState.value = 'available'
    } finally {
      if (downloadCtl === ctl) downloadCtl = null
    }
  }

  function installUpdate(): void {
    void runDownload()
  }

  /** 暂停下载：abort 但保留断点缓冲，回到可继续态 */
  function pauseDownload(): void {
    if (updateState.value !== 'downloading') return
    pauseRequested = true
    downloadCtl?.abort()
    downloadSpeed.value = null
    updateState.value = 'paused'
  }

  /** 继续下载：带上暂停前保留的缓冲从断点续传 */
  function resumeDownload(): void {
    if (updateState.value !== 'paused' || !downloadBuf) return
    void runDownload(downloadBuf)
  }

  /** 取消下载：中断传输、丢弃断点缓冲，回到待更新态 */
  function cancelDownload(): void {
    pauseRequested = false
    downloadCtl?.abort()
    downloadBuf = null
    updateProgress.value = null
    updateState.value = 'available'
  }

  function startCountdown(): void {
    stopCountdown()
    countdown.value = AUTO_INSTALL_SEC
    countdownTimer = window.setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0) void installStaged()
    }, 1000)
  }

  function stopCountdown(): void {
    if (countdownTimer !== undefined) {
      window.clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  }

  /** 立即或读秒归零后安装：派发替换脚本，应用随即退出 */
  async function installStaged(): Promise<void> {
    if (updateState.value !== 'ready') return
    stopCountdown()
    updateState.value = 'installing'
    try {
      await installStagedUpdate(stagedPath.value)
      // 正常路径：替换脚本已在等本进程退出，界面随之消失
    } catch (err) {
      toast(
        t('安装失败：{0}', err instanceof Error ? err.message : t('请重试，或前往下载页手动获取')),
        'error',
      )
      updateState.value = 'available'
    }
  }

  /** 稍后：停表保留已下载的包，回到等待手动更新 */
  function deferInstall(): void {
    stopCountdown()
    updateState.value = 'available'
  }

  const progressText = computed(() => {
    if (updateProgress.value === null) return t('下载中…')
    const speed = downloadSpeed.value
    const kbps =
      speed !== null && speed >= 1024
        ? `${(speed / 1024).toFixed(1)} MB/s`
        : speed !== null
          ? `${speed} KB/s`
          : null
    return kbps
      ? t('下载 {0}% · {1}', updateProgress.value, kbps)
      : t('下载 {0}%', updateProgress.value)
  })

  const pausedText = computed(() =>
    updateProgress.value === null
      ? t('下载已暂停')
      : t('已暂停 · 已下载 {0}%', updateProgress.value),
  )

  const readyText = computed(() => t('{0} 秒后自动重启安装', countdown.value))

  const isDownloading = computed(() => updateState.value === 'downloading')

  return {
    updateState,
    updateInfo,
    updateProgress,
    downloadSpeed,
    countdown,
    dialogOpen,
    openDialog,
    closeDialog,
    versionListOpen,
    releases,
    releasesState,
    openVersionList,
    closeVersionList,
    loadReleases,
    isDowngrade,
    selectRelease,
    checkUpdate,
    resetCheck,
    installUpdate,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    installStaged,
    deferInstall,
    progressText,
    pausedText,
    readyText,
    isDownloading,
  }
})
