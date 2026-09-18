import type { WatermarkLayer } from '@/types/watermark'
import type { Adjustments } from '@/types/adjust'
import type { RenderJob } from '@/workers/render.worker'

interface RenderReply {
  bitmap?: ImageBitmap
  bytes?: ArrayBuffer
  width?: number
  height?: number
  srcBack: ImageBitmap
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
  private worker: Worker
  private seq = 0
  private pending = new Map<number, Pending>()

  constructor() {
    this.worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.addEventListener(
      'message',
      (e: MessageEvent<{ id: number } & RenderReply>) => {
        const { id, ...rest } = e.data
        const p = this.pending.get(id)
        if (p) {
          this.pending.delete(id)
          p.resolve(rest as RenderReply)
        }
      },
    )
    this.worker.addEventListener('error', (err) => {
      const pending = [...this.pending.values()]
      this.pending.clear()
      for (const p of pending) p.reject(err)
    })
  }

  private request(job: Omit<RenderJob, 'id'>, transfer: Transferable[]): Promise<RenderReply> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ job: { ...job, id } }, transfer)
    })
  }

  /** 预览渲染：返回合成结果位图，源位图随 srcBack 归还以供复用。 */
  async renderPreview(
    src: ImageBitmap,
    assets: AssetPayload[],
    layers: WatermarkLayer[],
    adjustments: Adjustments,
    maxSize: number,
  ): Promise<{ bitmap: ImageBitmap; srcBack: ImageBitmap }> {
    const res = await this.request(
      { bitmap: src, assets, layers, adjustments, maxSize, quality: 0.92, want: 'bitmap' },
      [src],
    )
    if (!res.bitmap) throw new Error('预览渲染失败')
    return { bitmap: res.bitmap, srcBack: res.srcBack }
  }

  /** 导出渲染：解码源图并输出 JPEG 字节。 */
  async renderJpeg(
    blob: Blob,
    assets: AssetPayload[],
    layers: WatermarkLayer[],
    adjustments: Adjustments,
    maxSize: number,
    quality: number,
  ): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
    const src = await createImageBitmap(blob)
    const res = await this.request(
      { bitmap: src, assets, layers, adjustments, maxSize, quality, want: 'jpeg' },
      [src],
    )
    if (!res.bytes) throw new Error('导出渲染失败')
    return { bytes: res.bytes, width: res.width ?? 0, height: res.height ?? 0 }
  }

  terminate(): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const p of pending) p.reject(new Error('渲染器已关闭'))
    this.worker.terminate()
  }
}

/** 预览专用渲染通道。 */
export const renderClient = new RenderClient()
