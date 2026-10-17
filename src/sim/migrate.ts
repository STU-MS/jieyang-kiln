import { SCHEMA_VERSION } from './schema'
import { giftCards } from './profile'
import { emptyProfile, type CupSnapshot, type GameState, type Profile, type SaveFile, type StageId } from './types'

const STAGES: StageId[] = ['mix', 'throw', 'dry', 'glaze', 'fire']

function failed(): { save: SaveFile; gifted: boolean } {
  return {
    gifted: true,
    save: { schemaVersion: SCHEMA_VERSION, profile: giftCards(emptyProfile()), run: null },
  }
}

function isStage(value: unknown): value is StageId {
  return typeof value === 'string' && STAGES.includes(value as StageId)
}

function sanitizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<Profile>
  const cups = Array.isArray(data.cups) ? data.cups.filter(isSnapshot).slice(-24) : []
  return {
    schemaVersion: SCHEMA_VERSION,
    clearCount: typeof data.clearCount === 'number' ? data.clearCount : 0,
    knowledgeCardIds: Array.isArray(data.knowledgeCardIds) ? data.knowledgeCardIds.filter((id) => typeof id === 'string') : [],
    quizCorrectIds: Array.isArray(data.quizCorrectIds) ? data.quizCorrectIds.filter((id) => typeof id === 'string') : [],
    lastQuizDate: typeof data.lastQuizDate === 'string' ? data.lastQuizDate : '',
    lastClearDate: typeof data.lastClearDate === 'string' ? data.lastClearDate : '',
    cups,
    giftNoted: Boolean(data.giftNoted),
  }
}

function isSnapshot(value: unknown): value is CupSnapshot {
  if (!value || typeof value !== 'object') return false
  const data = value as CupSnapshot
  return data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.radii) && data.radii.length >= 8 && Boolean(data.result?.uniqueId)
}

function sanitizeRun(raw: unknown): GameState | null {
  if (raw == null) return null
  if (!raw || typeof raw !== 'object') return null
  const data = raw as GameState
  if (data.schemaVersion !== SCHEMA_VERSION) return null
  if (!isStage(data.stage) || typeof data.seed !== 'number') return null
  if (!Array.isArray(data.ops) || !Array.isArray(data.flaws) || !Array.isArray(data.radii)) return null
  return data
}

export function migrate(raw: unknown): { save: SaveFile; gifted: boolean } {
  if (raw == null) return { gifted: false, save: { schemaVersion: SCHEMA_VERSION, profile: emptyProfile(), run: null } }
  if (typeof raw !== 'object') return failed()
  const data = raw as Partial<SaveFile>
  if (data.schemaVersion !== SCHEMA_VERSION) return failed()
  const profile = sanitizeProfile(data.profile)
  if (!profile) return failed()
  if (data.run == null) return { gifted: false, save: { schemaVersion: SCHEMA_VERSION, profile, run: null } }
  const run = sanitizeRun(data.run)
  if (!run) return failed()
  return { gifted: false, save: { schemaVersion: SCHEMA_VERSION, profile, run } }
}
