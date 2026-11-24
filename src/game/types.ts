/** 一局的状态。纯数据，不含 mesh；mesh 由数据 + 资产在运行时生成（设计文档 §3）。 */
export type Part = 'head' | 'body' | 'arms' | 'legs'

/** 拆泥：四个部位的泥量占比，0–1，和恒为 1。 */
export type Split = Record<Part, number>

export interface GameSession {
  schemaVersion: 2
  id: string
  /** ① 拆泥是否已确认（动画播放过后）。未确认时 s1_split 仍是当前滑杆值。 */
  s1_confirmed: boolean
  s1_split: Split
}

export const SCHEMA_VERSION = 2 as const

/** 新的一局：id 由调用方注入（测试可注入固定值）。 */
export function newSession(id: string, split: Split): GameSession {
  return { schemaVersion: SCHEMA_VERSION, id, s1_confirmed: false, s1_split: { ...split } }
}
