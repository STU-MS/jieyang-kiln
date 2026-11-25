import { defaultShapeState } from '../sim/shape'

/** 一局的状态。纯数据，不含 mesh；mesh 由数据 + 资产在运行时生成（设计文档 §3）。 */
export type Part = 'head' | 'body' | 'arms' | 'legs'

/** 拆泥：四个部位的泥量占比，0–1，和恒为 1。 */
export type Split = Record<Part, number>

/** 单个部位的形态滑杆值：滑杆 id → 0–1，中心 0.5 = 默认形状（id 见 src/data/shape.json）。 */
export type ShapeValues = Record<string, number>

/** ② 捏：四部位滑杆值 + 每个部位的出生变形动画是否播放过。 */
export type ShapeState = Record<Part, ShapeValues> & { animated: Record<Part, boolean> }

/**
 * 釉层：一张 UV 贴图，每像素记「哪种釉、多厚」（设计文档 §2.6）。
 * 不变量：glazeIds 为 0 的像素 thickness 恒为 0（露胎没有厚度）。
 */
export interface GlazeLayer {
  width: number
  height: number
  /** 每像素釉种，0 = 无釉 */
  glazeIds: Uint8Array
  /** 每像素厚度 1–3 层；无釉处为 0 */
  thickness: Uint8Array
}

export interface GameSession {
  schemaVersion: 2
  id: string
  /** ① 拆泥是否已确认（动画播放过后）。未确认时 s1_split 仍是当前滑杆值。 */
  s1_confirmed: boolean
  s1_split: Split
  s2_shape: ShapeState
  /** ④ 衣服。undefined = 还没穿过（拆泥阶段的存档就是这种，读档不算坏档）。0 不落盘：脱掉即移除字段。 */
  s4_outfit?: { id: number }
  /** ⑤ 阴干。undefined / false = 还没阴干；true 是单向门，不可逆。 */
  s5_dried?: boolean
  /** ⑥ 上釉。undefined = 还没上釉（拆泥阶段的存档就是这种，读档不算坏档）。 */
  s6_glaze?: GlazeLayer
}

export const SCHEMA_VERSION = 2 as const

/** 新的一局：id 由调用方注入（测试可注入固定值）。形态滑杆全中性、动画未播放。 */
export function newSession(id: string, split: Split): GameSession {
  return { schemaVersion: SCHEMA_VERSION, id, s1_confirmed: false, s1_split: { ...split }, s2_shape: defaultShapeState() }
}
