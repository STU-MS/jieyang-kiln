import { SCHEMA_VERSION } from './schema'

export type StageId = 'mix' | 'throw' | 'dry' | 'glaze' | 'fire'
export type SeasonId = 'spring' | 'preFlood' | 'summer' | 'autumn' | 'winter'
export type WeatherId = 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'returningSouth' | 'coldAir'
export type Quality = 'excellent' | 'good' | 'poor'
export type PlacementId = 'vent' | 'shade' | 'sun'
export type FlawVisual =
  | 'dent'
  | 'crack'
  | 'pinhole'
  | 'warp'
  | 'chip'
  | 'stain'
  | 'bubble'
  | 'foot'
  | 'yellow'
  | 'matte'
  | 'crazing'
export type PatternId = 'rust' | 'hare' | 'oilspot' | 'none'
export type ShapeWord = 'round' | 'fair' | 'warp'
export type GlazeWord = 'held' | 'thin' | 'run'
export type Grade = 'L0' | 'L1' | 'L2'

export interface Flaw {
  id: string
  visual: FlawVisual
  from: string
}

export interface ClayParts {
  diger: number
  kaolin: number
  aged: number
}

export interface ClayState {
  parts: ClayParts
  water: number
  P: number
  H: number
  I: number
  C: number
  quality: Quality
  knead: number
  waterZero: boolean
}

export interface DryState {
  placement: PlacementId
  flipped: boolean
  covered: boolean
  fanMisused: boolean
  wetBody: boolean
  crackOpen: boolean
  raised: boolean
  wrapped: boolean
  duration: number
  humidityCurve: number[]
  scheduled: string[]
  sunCrack: boolean
  winterCrack: boolean
}

export interface BisqueState {
  deviation: number
  brittle: boolean
  wetExtra: number
  exploded: boolean
  scheduled: string[]
  maxTemp: number
}

export interface GlazePick {
  id: string
  layers: number
  concentration: number
}

export interface GlazeStamp {
  ring: number
  amount: number
}

export interface GlazeState {
  picks: GlazePick[]
  stamps: GlazeStamp[]
  mask: number[]
  uniformity: number
  totalLayers: number
  footRisk: boolean
  warned: boolean
  rimCovered: boolean
  stockLeft: number
}

export interface FireState {
  peakTemp: number
  holdHours: number
  doorOpened: boolean
  exploded: boolean
  scheduled: string[]
  heldExtra: boolean
}

export interface KilnResult {
  hueShift: number
  pattern: PatternId
  density: number
  gloss: number
  flow: number
  uniqueId: string
  signature: string
  grade: Grade
  shapeWord: ShapeWord
  glazeWord: GlazeWord
  demo: boolean
  geoHash: string
  atmosphere: number
  stuck: boolean
  shattered: boolean
  flaws: Flaw[]
}

export interface GameState {
  schemaVersion: number
  seed: number
  month: number
  season: SeasonId
  weather: WeatherId
  humidity: number
  temperature: number
  stage: StageId
  practice: boolean
  clay: ClayState | null
  radii: number[]
  thickness: number[]
  baseRadii: number[]
  lean: number
  dry: DryState | null
  bisque: BisqueState | null
  glaze: GlazeState | null
  fire: FireState | null
  result: KilnResult | null
  flaws: Flaw[]
  ops: string[]
  retries: number
  demoUsed: boolean
  elapsed: number
  failReason: null | 'stuck' | 'shatter' | 'explode' | 'crack' | 'throw'
}

export interface CupSnapshot {
  schemaVersion: number
  seed: number
  month: number
  season: SeasonId
  weather: WeatherId
  humidity: number
  temperature: number
  clay: ClayState
  radii: number[]
  thickness: number[]
  lean: number
  glaze: GlazeState
  fire: FireState
  result: KilnResult
  flaws: Flaw[]
  ops: string[]
}

export interface Profile {
  schemaVersion: number
  clearCount: number
  knowledgeCardIds: string[]
  quizCorrectIds: string[]
  lastQuizDate: string
  lastClearDate: string
  cups: CupSnapshot[]
  giftNoted: boolean
}

export interface SaveFile {
  schemaVersion: number
  profile: Profile
  run: GameState | null
}

export function emptyProfile(): Profile {
  return {
    schemaVersion: SCHEMA_VERSION,
    clearCount: 0,
    knowledgeCardIds: [],
    quizCorrectIds: [],
    lastQuizDate: '',
    lastClearDate: '',
    cups: [],
    giftNoted: false,
  }
}
