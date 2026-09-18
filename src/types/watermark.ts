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
  /** 图层中心 X（图片宽度百分比 0-100） */
  x: number
  /** 图层中心 Y（图片高度百分比 0-100） */
  y: number
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

export type TextLayerPatch = Partial<Omit<TextLayer, 'type'>>
export type ImageLayerPatch = Partial<Omit<ImageLayer, 'type'>>
export type LayerPatch = TextLayerPatch | ImageLayerPatch
