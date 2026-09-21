export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'difference'
  | 'luminosity'

export interface TileOptions {
  enabled: boolean
  /** 水平间距，占图层宽度的百分比 */
  gapX: number
  /** 垂直间距，占图层高度的百分比 */
  gapY: number
}

export interface BaseLayer {
  id: string
  name: string
  visible: boolean
  /**
   * 定位锚点（九宫格）。图层中心 = 锚点 + 偏移，
   * 偏移以图片宽/高的百分比存储，跨分辨率保持构图一致。
   */
  anchor: AnchorPreset
  /** 相对锚点的水平偏移（图片长边百分比，可为负；横竖屏切换数值不变） */
  offsetX: number
  /** 相对锚点的垂直偏移（图片长边百分比，可为负） */
  offsetY: number
  /** 基准尺寸占图片长边的百分比 */
  scale: number
  /** 旋转角度（度） */
  rotation: number
  /** 不透明度 0-100 */
  opacity: number
  blend: BlendMode
  tile: TileOptions
}

export interface TextShadow {
  enabled: boolean
  blur: number
  opacity: number
  x: number
  y: number
}

export interface TextStroke {
  enabled: boolean
  width: number
  color: string
}

export interface TextBackground {
  enabled: boolean
  color: string
  opacity: number
  padding: number
  radius: number
}

export interface TextLayer extends BaseLayer {
  type: 'text'
  content: string
  fontFamily: string
  fontWeight: number
  italic: boolean
  color: string
  /** 字距（字号百分比） */
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  /**
   * 文字框锚点（九宫格）：文字框（含背景条）的哪个位置对准定位点。
   * 缺省按「居中」处理（定位点落在框中心），兼容旧数据。
   */
  boxAnchor?: AnchorPreset
  shadow: TextShadow
  stroke: TextStroke
  background: TextBackground
}

export interface ImageLayer extends BaseLayer {
  type: 'image'
  assetId: string
  /** 宽高比（宽/高） */
  aspect: number
}

export type WatermarkLayer = TextLayer | ImageLayer

export interface SerializedAsset {
  id: string
  name: string
  dataUrl: string
  aspect: number
}

export interface WatermarkTemplate {
  id: string
  name: string
  builtin?: boolean
  createdAt?: number
  updatedAt?: number
  layers: WatermarkLayer[]
  assets: SerializedAsset[]
}

export type AnchorPreset =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

/** 旧版百分比坐标 → 锚点 + 偏移 的迁移。 */
export function migrateLayer<T extends WatermarkLayer>(l: T): T {
  if ('anchor' in l && typeof l.anchor === 'string') return l
  const legacy = l as unknown as { x?: number; y?: number }
  const x = typeof legacy.x === 'number' ? legacy.x : 50
  const y = typeof legacy.y === 'number' ? legacy.y : 50
  const col = x < 25 ? 0 : x < 75 ? 1 : 2
  const row = y < 25 ? 0 : y < 75 ? 1 : 2
  const anchor = (['top', 'middle', 'bottom'][row] +
    '-' +
    (['left', 'center', 'right'][col] as string)) as AnchorPreset
  const rest = { ...l } as Record<string, unknown>
  delete rest.x
  delete rest.y
  return { ...rest, anchor, offsetX: x - col * 50, offsetY: y - row * 50 } as T
}

export type TextLayerPatch = Partial<Omit<TextLayer, 'type'>>
export type ImageLayerPatch = Partial<Omit<ImageLayer, 'type'>>
export type LayerPatch = TextLayerPatch | ImageLayerPatch
