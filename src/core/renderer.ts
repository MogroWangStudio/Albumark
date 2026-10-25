import type { WatermarkLayer } from '@/types/watermark'
import type { Adjustments, Crop } from '@/types/adjust'
import type { RenderJob } from '@/workers/render.worker'

interface RenderReply {
  bitmap?: ImageBitmap
  bytes?: ArrayBuffer
  width?: number
  height?: number
  srcBack: ImageBitmap
  err?: string
}

type Pending = { resolve: (v: RenderReply) => void; reject: (e: unknown) => void }

export interface AssetPayload {
  id: string
  blob: Blob
}

/**
 * 与渲染 Worker 的连接。源图以 Transferable 方式传入，
 * 渲染完成后随结果原样归还（srcBack），避免重复解码。
 */
export class RenderClient {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  /** worker 已崩溃：下一次请求前重建，否则每个任务都要空等看门狗超时 */
  private dead = false

  constructor() {
    this.spawn()
  }

  private spawn(): void {
    const worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener(
      'message',
      (e: MessageEvent<{ id: number } & RenderReply>) => {
        const { id, err, ...rest } = e.data
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        if (err !== undefined) {
          // 失败任务仍会归还源位图：主线程侧不再使用它，必须释放，
          // 否则每失败一次就泄漏一张全尺寸位图
          ;(rest as { srcBack?: ImageBitmap }).srcBack?.close()
          p.reject(new Error(`渲染失败：${err}`))
        } else {
          p.resolve(rest as RenderReply)
        }
      },
    )
    worker.addEventListener('error', (err) => {
      this.dead = true
      const pending = [...this.pending.values()]
      this.pending.clear()
      for (const p of pending) p.reject(err)
    })
    this.worker = worker
  }

  /** 无回应看门狗：worker 被系统回收 / 线程卡死时，任务永不回报会让渲染
   *  静默冻结。超时即拒绝并移除 pending，后续调整照常重试。 */
  private static readonly WATCHDOG_MS = 15_000

  private request(job: Omit<RenderJob, 'id'>, transfer: Transferable[]): Promise<RenderReply> {
    const id = ++this.seq
    if (this.dead || !this.worker) {
      // 旧 worker 已终止（其错误事件已拒绝过在途任务）：换一个新的再发
      this.worker?.terminate()
      this.dead = false
      this.spawn()
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const watchdog = setTimeout(() => {
        if (settled) return
        settled = true
        this.pending.delete(id)
        reject(new Error('渲染超时（worker 无回应）'))
      }, RenderClient.WATCHDOG_MS)
      this.pending.set(id, {
        resolve: (v) => {
          if (settled) return
          settled = true
          clearTimeout(watchdog)
          resolve(v)
        },
        reject: (e) => {
          if (settled) return
          settled = true
          clearTimeout(watchdog)
          reject(e)
        },
      })
      this.worker?.postMessage({ job: { ...job, id } }, transfer)
    })
  }

  /** 预览渲染：返回合成结果位图，源位图随 srcBack 归还以供复用。 */
  async renderPreview(
    src: ImageBitmap,
    assets: AssetPayload[],
    layers: WatermarkLayer[],
    adjustments: Adjustments,
    maxSize: number,
    crop?: Crop,
  ): Promise<{ bitmap: ImageBitmap; srcBack: ImageBitmap }> {
    const res = await this.request(
      { bitmap: src, assets, layers, adjustments, crop, maxSize, quality: 0.92, want: 'bitmap' },
      [src],
    )
    if (!res.bitmap) throw new Error('预览渲染失败')
    return { bitmap: res.bitmap, srcBack: res.srcBack }
  }

  /** 编码渲染：解码源图并输出 JPEG / PNG 字节。 */
  async renderImage(
    blob: Blob,
    assets: AssetPayload[],
    layers: WatermarkLayer[],
    adjustments: Adjustments,
    maxSize: number,
    quality: number,
    crop: Crop | undefined,
    format: 'jpg' | 'png',
  ): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
    const src = await createImageBitmap(blob)
    const res = await this.request(
      {
        bitmap: src,
        assets,
        layers,
        adjustments,
        crop,
        maxSize,
        quality,
        want: format === 'png' ? 'png' : 'jpeg',
      },
      [src],
    )
    if (!res.bytes) throw new Error('导出渲染失败')
    return { bytes: res.bytes, width: res.width ?? 0, height: res.height ?? 0 }
  }

  terminate(): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const p of pending) p.reject(new Error('渲染器已关闭'))
    this.worker?.terminate()
    this.worker = null
    this.dead = false
  }
}

/** 预览专用渲染通道。 */
export const renderClient = new RenderClient()
