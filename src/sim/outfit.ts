import data from '../data/outfit.json'
import type { GameSession } from '../game/types'

/**
 * 衣服规则（设计文档 §2.4）：MVP 三件，点选即穿，一次穿一件不叠穿。
 * 状态只记「现在穿的是哪件」——换穿别的 = 覆盖，不是叠加。
 */
export const OUTFIT_NONE = 0

export interface OutfitDef {
  /** 0 = 没穿（脱掉）。1..n = 衣服，进存档的就是这个数。 */
  readonly id: number
  /** 文案 key：界面用 t(`outfit.${key}`)，中文名不进数据表。 */
  readonly key: string
  readonly source: string
}

export const OUTFITS: readonly OutfitDef[] = data.outfits as readonly OutfitDef[]

const BY_ID = new Map<number, OutfitDef>(OUTFITS.map((o) => [o.id, o]))

export function outfitById(id: number): OutfitDef | null {
  return BY_ID.get(id) ?? null
}

/** 合法衣服状态：没穿（0）或数据表里注册过的 id。 */
export function isValidOutfitId(id: unknown): id is number {
  return id === OUTFIT_NONE || (typeof id === 'number' && BY_ID.has(id))
}

/** 当前穿的衣服 id。0 = 没穿。 */
export function wornOutfit(session: GameSession): number {
  return session.s4_outfit?.id ?? OUTFIT_NONE
}

/**
 * 穿上 id 对应的衣服，返回新一局（不改入参）。
 * - 没穿 → 穿上
 * - 穿的同一件 → 幂等，返回等价的新对象（重复点不产生变化）
 * - 穿的别的件 → 覆盖（MVP 不叠穿）
 * - 0 → 脱掉，字段移除
 * - 未注册 id → 抛错（调用方只能传数据表里的 id 或 0）
 */
export function wearOutfit(session: GameSession, id: number): GameSession {
  if (!isValidOutfitId(id)) throw new Error(`未注册的衣服：${id}`)
  const next: GameSession = { ...session }
  if (id === OUTFIT_NONE) {
    delete next.s4_outfit
  } else {
    next.s4_outfit = { id }
  }
  return next
}
