import difficulty from '../data/difficulty.json'
import { allEvents, type GameEvent } from '../content/text'
import { hashString, mulberry32 } from './rng'
import type { FireState, Flaw, GameState, SeasonId, WeatherId } from './types'
import firing from '../data/firing.json'

export const EVENT_ACTIONS = [
  'cover',
  'raise',
  'wrap',
  'wait',
  'redirectFan',
  'patchCrack',
  'brace',
  'slowHeat',
  'delayKiln',
  'reposition',
  'moreAir',
  'closeDoor',
  'adjustAtmosphere',
  'extendHold',
] as const

export type EventAction = (typeof EVENT_ACTIONS)[number]

export function isEventAction(value: string): value is EventAction {
  return (EVENT_ACTIONS as readonly string[]).includes(value)
}

export function catalogEvents(): GameEvent[] {
  return allEvents().filter((event) => isEventAction(event.action))
}

function weightOf(event: GameEvent, season: SeasonId, weather: WeatherId): number {
  let w = event.weight
  if (event.boostWeather.includes(weather)) w *= 2.4
  if (event.boostSeason.includes(season)) w *= 2
  return w
}

function pickOne(rng: () => number, pool: GameEvent[], season: SeasonId, weather: WeatherId): GameEvent {
  const weights = pool.map((event) => weightOf(event, season, weather))
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = rng() * sum
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

export function planStageEvents(input: {
  seed: number
  phase: 'dry' | 'bisque' | 'fire'
  season: SeasonId
  weather: WeatherId
  novice: boolean
  practice: boolean
  salt: string
  forceId?: string
}): GameEvent[] {
  if (input.practice && !input.forceId) return []
  const pool = catalogEvents().filter((event) => event.phase === input.phase && !event.playerTriggered)
  const max = difficulty.maxEvents[input.phase]
  const rng = mulberry32(hashString(`${input.seed}|${input.phase}|${input.salt}`))
  if (input.forceId) {
    const forced = catalogEvents().find((event) => event.id === input.forceId)
    return forced ? [forced] : []
  }
  const p = input.novice
    ? difficulty.eventProbability[input.phase] * difficulty.noviceProbabilityScale
    : difficulty.eventProbability[input.phase]
  let count = 0
  for (let i = 0; i < max; i++) if (rng() < p) count += 1
  const chosen: GameEvent[] = []
  const rest = pool.slice()
  for (let i = 0; i < count && rest.length > 0; i++) {
    const event = pickOne(rng, rest, input.season, input.weather)
    chosen.push(event)
    const idx = rest.findIndex((item) => item.id === event.id)
    if (idx >= 0) rest.splice(idx, 1)
  }
  return chosen
}

function withOp(state: GameState, event: GameEvent, ok: boolean): GameState {
  return { ...state, ops: [...state.ops, `${event.id}:${ok ? 'ok' : 'miss'}`] }
}

function addFlaw(state: GameState, flaw: Flaw): GameState {
  if (state.flaws.some((item) => item.id === flaw.id)) return state
  return { ...state, flaws: [...state.flaws, flaw] }
}

function dentMouth(radii: number[]): number[] {
  const next = radii.slice()
  const n = next.length
  for (let i = Math.floor(n * 0.86); i < n; i++) next[i] = Math.max(0.12, next[i] * 0.86)
  return next
}

function chipMouth(radii: number[]): number[] {
  const next = radii.slice()
  const i = Math.max(0, next.length - 3)
  next[i] = Math.max(0.1, next[i] - 0.1)
  return next
}

function patchDry(state: GameState, patch: Partial<GameState['dry']>): GameState {
  if (!state.dry) return state
  return { ...state, dry: { ...state.dry, ...patch } }
}

function patchBisque(state: GameState, patch: Partial<NonNullable<GameState['bisque']>>): GameState {
  if (!state.bisque) return state
  return { ...state, bisque: { ...state.bisque, ...patch } }
}

function patchFire(state: GameState, patch: Partial<FireState>): GameState {
  if (!state.fire) return state
  return { ...state, fire: { ...state.fire, ...patch } }
}

type Handler = (state: GameState, event: GameEvent, ok: boolean, temp: number) => GameState

function miss(state: GameState, event: GameEvent, ok: boolean, flaw: Flaw | null, extra: (s: GameState) => GameState): GameState {
  let next = withOp(state, event, ok)
  if (!ok && flaw) next = addFlaw(next, flaw)
  if (ok && event.id === 'e6') next = addFlaw(next, { id: 'faint-scar', visual: 'crack', from: 'e6' })
  return extra(next)
}

const handlers: Record<EventAction, Handler> = {
  cover: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'wet-mouth', visual: 'dent', from: 'e1' }, (s) => {
      if (ok) return patchDry(s, { covered: true })
      return patchDry({ ...s, radii: dentMouth(s.radii) }, { wetBody: true })
    }),
  raise: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'foot-yellow', visual: 'yellow', from: 'e2' }, (s) =>
      ok ? patchDry(s, { raised: true }) : s,
    ),
  wrap: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'cold-crack', visual: 'crack', from: 'e3' }, (s) =>
      ok ? patchDry(s, { wrapped: true }) : s,
    ),
  wait: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'surface-water', visual: 'stain', from: 'e4' }, (s) =>
      ok ? s : patchBisque(s, { wetExtra: Math.max(s.bisque?.wetExtra ?? 0, 0.15) }),
    ),
  redirectFan: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'shell-crazing', visual: 'crazing', from: 'e5' }, (s) =>
      patchDry(s, { fanMisused: true }),
    ),
  patchCrack: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'open-crack', visual: 'crack', from: 'e6' }, (s) =>
      ok ? s : patchDry(s, { crackOpen: true }),
    ),
  brace: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'rim-chip', visual: 'chip', from: 'e7' }, (s) => {
      if (ok) return s
      return { ...s, radii: chipMouth(s.radii) }
    }),
  slowHeat: (state, event, ok) =>
    miss(
      state,
      event,
      ok,
      ok
        ? null
        : event.id === 'e16'
          ? { id: 'orange-peel', visual: 'pinhole', from: 'e16' }
          : { id: 'hidden-crack', visual: 'crack', from: 'e8' },
      (s) => s,
    ),
  delayKiln: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'wet-burst', visual: 'crack', from: 'e9' }, (s) =>
      ok ? patchDry(s, { wetBody: false }) : patchBisque(s, { exploded: true }),
    ),
  reposition: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'kiln-warp', visual: 'warp', from: 'e10' }, (s) =>
      ok ? s : { ...s, lean: s.lean + 0.12 },
    ),
  moreAir: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'smoke-stain', visual: 'stain', from: 'e11' }, (s) => s),
  closeDoor: (state, event, ok, temp) =>
    miss(state, event, ok, ok ? null : { id: 'crazing', visual: 'crazing', from: 'e12' }, (s) => {
      if (ok) return patchFire(s, { doorOpened: false })
      if (temp >= firing.doorShatterTemp) return patchFire(s, { exploded: true, doorOpened: true })
      return patchFire(s, { doorOpened: true })
    }),
  adjustAtmosphere: (state, event, ok) =>
    miss(
      state,
      event,
      ok,
      ok
        ? null
        : event.id === 'e14'
          ? { id: 'black-spot', visual: 'stain', from: 'e14' }
          : { id: 'yellow-cast', visual: 'yellow', from: 'e13' },
      (s) => s,
    ),
  extendHold: (state, event, ok) =>
    miss(state, event, ok, ok ? null : { id: 'underfired', visual: 'matte', from: 'e15' }, (s) =>
      ok ? patchFire({ ...s, fire: s.fire ? { ...s.fire, holdHours: s.fire.holdHours + 1, heldExtra: true } : s.fire }, {}) : s,
    ),
}

export function applyEvent(state: GameState, event: GameEvent, ok: boolean, temp = 0): GameState {
  if (!isEventAction(event.action)) return state
  return handlers[event.action](state, event, ok, temp)
}
