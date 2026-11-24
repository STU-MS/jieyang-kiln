import { SCHEMA_VERSION, type GameSession } from '../game/types'
import { isValidSplit } from '../sim/split'

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
    s.setItem(KEY, JSON.stringify(session))
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
  return { schemaVersion: SCHEMA_VERSION, id: d.id, s1_confirmed: d.s1_confirmed, s1_split: { ...d.s1_split } }
}
