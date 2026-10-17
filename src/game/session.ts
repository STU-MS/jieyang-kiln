import { useSyncExternalStore } from 'react'
import type { GameState, Profile } from '../sim/types'
import { emptyProfile } from '../sim/types'

interface Snap {
  profile: Profile
  run: GameState | null
  memoryOnly: boolean
}

let profile = emptyProfile()
let run: GameState | null = null
let memoryOnly = false
let extra = 0
let snap: Snap = { profile, run, memoryOnly }
const listeners = new Set<() => void>()

function emit(): void {
  snap = { profile, run, memoryOnly }
  listeners.forEach((listener) => listener())
}

export const session = {
  get: () => snap,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  hydrate(nextProfile: Profile, nextRun: GameState | null, nextMemory: boolean) {
    profile = nextProfile
    run = nextRun
    memoryOnly = nextMemory
    extra = 0
    emit()
  },
  setProfile(next: Profile) {
    profile = next
    emit()
  },
  setRun(next: GameState | null) {
    if (!next || next.seed !== run?.seed) extra = 0
    run = next
    emit()
  },
  setMemoryOnly(next: boolean) {
    memoryOnly = next
    emit()
  },
  addElapsed(dt: number) {
    extra += dt
  },
  flushElapsed() {
    if (!run || extra === 0) return
    run = { ...run, elapsed: run.elapsed + extra }
    extra = 0
    emit()
  },
  elapsed() {
    return (run?.elapsed ?? 0) + extra
  },
}

export function useSession(): Snap {
  return useSyncExternalStore(session.subscribe, session.get)
}
