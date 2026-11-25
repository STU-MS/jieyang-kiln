import { SCHEMA_VERSION, type GameSession, type Part, type ShapeState, type ShapeValues } from '../game/types'
import { isValidSplit } from '../sim/split'
import { SHAPE_PARTS, clampShapeValue, shapeSliders } from '../sim/shape'
import { decodeGlaze, encodeGlaze } from './glazeCodec'
import { isValidOutfitId } from '../sim/outfit'

const KEY = 'jieyang.taosu.save'

/** 存档在外部边界的替身：测试用内存实现，生产用 localStorage。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Loaded {
  /** 合法的一局；没有存档或存档坏了就是 null（空态 → 新局） */
  session: GameSession | null
  /** 存档读到了但被丢弃（版本不对 / 结构不对） */
  discarded: boolean
  /** 底层存储不可用，本局只能留在内存 */
  memoryOnly: boolean
}

/**
 * 读档。schemaVersion 不是 2（含 v1.x 的 1）→ 当没有存档，不迁移：
 * v1.x 是「做杯子」的另一种游戏，数据模型无对应关系。
 */
export function loadSession(store?: StorageLike): Loaded {
  const s = store ?? browserStorage()
  if (!s) return { session: null, discarded: false, memoryOnly: true }
  let raw: string | null
  try {
    raw = s.getItem(KEY)
  } catch {
    return { session: null, discarded: false, memoryOnly: true }
  }
  if (raw == null) return { session: null, discarded: false, memoryOnly: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { session: null, discarded: true, memoryOnly: false }
  }
  const session = sanitize(parsed)
  if (!session) return { session: null, discarded: true, memoryOnly: false }
  return { session, discarded: false, memoryOnly: false }
}

/** 写档。失败（隐私模式 / 配额满）返回 false，调用方继续玩内存态。 */
export function writeSession(session: GameSession, store?: StorageLike): boolean {
  const s = store ?? browserStorage()
  if (!s) return false
  try {
    // 釉层在存储边界换成游程编码，内存态仍是 Uint8Array（见 glazeCodec.ts）
    const { s6_glaze, ...rest } = session
    const payload = s6_glaze ? { ...rest, s6_glaze: encodeGlaze(s6_glaze) } : rest
    s.setItem(KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function sanitize(raw: unknown): GameSession | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (d.schemaVersion !== SCHEMA_VERSION) return null
  if (typeof d.id !== 'string' || d.id === '') return null
  if (typeof d.s1_confirmed !== 'boolean') return null
  // 比例不合法（有非数字 / 低于最小值 / 和不为 1）= 坏档。我们的写入方不会产出这种值，不修，直接新局。
  if (!isValidSplit(d.s1_split)) return null
  const session: GameSession = {
    schemaVersion: SCHEMA_VERSION,
    id: d.id,
    s1_confirmed: d.s1_confirmed,
    s1_split: { ...d.s1_split },
    // s2_shape 是后来加的阶段：旧存档没有它就补默认，不算坏档。有它则逐项修复（夹取 / 补中性）。
    s2_shape: sanitizeShape(d.s2_shape),
  }
  // ④ 衣服是可选字段：旧档（拆泥阶段存的）没有它，不算坏档。id 不在数据表里 → 只丢衣服，保留整局。
  const outfit = d.s4_outfit
  if (outfit != null) {
    const id = (outfit as Record<string, unknown>).id
    if (isValidOutfitId(id) && id !== 0) session.s4_outfit = { id }
  }
  // ⑤ 阴干同理：非布尔值不认，只丢标记。
  if (typeof d.s5_dried === 'boolean') session.s5_dried = d.s5_dried
  // 釉层缺失（拆泥阶段的存档）或解不出来：退回「还没上釉」，不把整局判成坏档——
  // 前面拆泥捏塑的进度比一层可重涂的釉值钱。
  const glaze = decodeGlaze(d.s6_glaze)
  if (glaze) session.s6_glaze = glaze
  return session
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/**
 * 把存档里的 s2_shape 修成合法形态：每根滑杆必须是有限数、夹到 [0,1]，缺的 id 补中性，
 * 多出来的 id 丢掉；animated 缺失或非布尔 → false。整体坏了（非对象）也只是退回全默认。
 */
function sanitizeShape(raw: unknown): ShapeState {
  const d = asRecord(raw)
  const animatedRaw = asRecord(d.animated)
  const valuesOut = {} as Record<Part, ShapeValues>
  const animated = {} as Record<Part, boolean>
  for (const part of SHAPE_PARTS) {
    const valuesRaw = asRecord(d[part])
    const values: ShapeValues = {}
    for (const slider of shapeSliders(part)) values[slider.id] = clampShapeValue(valuesRaw[slider.id])
    valuesOut[part] = values
    animated[part] = animatedRaw[part] === true
  }
  return { ...valuesOut, animated }
}
