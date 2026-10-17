import { migrate } from '../sim/migrate'
import { SCHEMA_VERSION } from '../sim/schema'
import type { GameState, Profile, SaveFile } from '../sim/types'

const KEY = 'jieyang.ceramic.save'

export function loadSave(): { save: SaveFile; gifted: boolean; memoryOnly: boolean } {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { save: migrate(null).save, gifted: false, memoryOnly: false }
    const migrated = migrate(JSON.parse(raw) as unknown)
    return { save: migrated.save, gifted: migrated.gifted, memoryOnly: false }
  } catch {
    return { save: migrate(null).save, gifted: false, memoryOnly: true }
  }
}

export function writeSave(profile: Profile, run: GameState | null): boolean {
  try {
    const file: SaveFile = { schemaVersion: SCHEMA_VERSION, profile, run }
    localStorage.setItem(KEY, JSON.stringify(file))
    return true
  } catch {
    return false
  }
}
