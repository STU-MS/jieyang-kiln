import clayData from '../data/clay.json'
import climate from '../data/climate.json'
import difficulty from '../data/difficulty.json'
import firing from '../data/firing.json'
import glazeData from '../data/glaze.json'
import { mixClay } from './clay'
import { bisqueBandWidth, humidityCurve, placementDrySeconds, seasonOf, weatherById } from './drying'
import { planStageEvents } from './events'
import { buildGlaze, glazeById, glazeStock } from './glaze'
import { computeKilnResult, geometryHash } from './kiln'
import { hashString, mulberry32 } from './rng'
import { SCHEMA_VERSION } from './schema'
import { cylinderRadii, ghostRadii, thicknessFromRadii } from './throwing'
import type {
  BisqueState,
  ClayState,
  CupSnapshot,
  FireState,
  GameState,
  GlazePick,
  GlazeStamp,
  PlacementId,
  SeasonId,
  WeatherId,
} from './types'

const DRY_SOURCES = new Set([
  'e1',
  'e2',
  'e3',
  'e4',
  'e5',
  'e6',
  'e7',
  'e8',
  'e9',
  'e10',
  'e11',
  'sun',
  'winter',
  'bisque',
  'bisque-hot',
])

function rollWeather(seed: number, season: SeasonId): WeatherId {
  const table = climate.weights[season] as Record<string, number>
  const entries = Object.entries(table)
  const rng = mulberry32(hashString(`weather|${seed}|${season}`))
  const sum = entries.reduce((total, [, weight]) => total + weight, 0)
  let cursor = rng() * sum
  for (const [id, weight] of entries) {
    cursor -= weight
    if (cursor <= 0) return id as WeatherId
  }
  return (entries[entries.length - 1]?.[0] as WeatherId) ?? 'cloudy'
}

export function createRun(seed: number, month: number, practice: boolean): GameState {
  const season = seasonOf(month)
  const weather = rollWeather(seed, season)
  const seasonDef = climate.seasons.find((item) => item.id === season) ?? climate.seasons[3]
  const weatherDef = weatherById(weather)
  const rng = mulberry32(seed ^ 0x51a7)
  const span = seasonDef.humidity[1] - seasonDef.humidity[0]
  const humidity = Math.max(35, Math.min(98, seasonDef.humidity[0] + rng() * span + weatherDef.humidityAdd))
  const temperature =
    seasonDef.temperature[0] + rng() * (seasonDef.temperature[1] - seasonDef.temperature[0]) + weatherDef.tempAdd
  return {
    schemaVersion: SCHEMA_VERSION,
    seed,
    month,
    season,
    weather,
    humidity,
    temperature,
    stage: 'mix',
    practice,
    clay: null,
    radii: [],
    thickness: [],
    baseRadii: [],
    lean: 0,
    dry: null,
    bisque: null,
    glaze: null,
    fire: null,
    result: null,
    flaws: [],
    ops: [],
    retries: 0,
    demoUsed: false,
    elapsed: 0,
    failReason: null,
  }
}

export function withClay(state: GameState, clay: ClayState): GameState {
  return { ...state, clay, failReason: null }
}

export function beginThrow(state: GameState): GameState {
  const clay = state.clay
  const token = clay ? `mix:${clay.parts.diger},${clay.parts.kaolin},${clay.parts.aged},${clay.water}` : 'mix:empty'
  const radii = cylinderRadii()
  return {
    ...state,
    stage: 'throw',
    radii,
    thickness: thicknessFromRadii(radii),
    baseRadii: [],
    ops: state.ops.includes(token) ? state.ops : [...state.ops, token],
    failReason: null,
  }
}

export function finishThrow(
  state: GameState,
  radii: number[],
  thickness = thicknessFromRadii(radii),
  novice = false,
  practice = state.practice,
): GameState {
  const thrown: GameState = {
    ...state,
    radii,
    thickness,
    baseRadii: radii.slice(),
    ops: [...state.ops, `throw:${geometryHash(radii)}`],
    failReason: null,
  }
  return freshDry(thrown, 'shade', novice, practice)
}

function freshDry(state: GameState, placement: PlacementId, novice: boolean, practice: boolean): GameState {
  const scheduled = planStageEvents({
    seed: state.seed,
    phase: 'dry',
    season: state.season,
    weather: state.weather,
    novice,
    practice,
    salt: state.ops.join(','),
  })
  return {
    ...state,
    stage: 'dry',
    dry: {
      placement,
      flipped: false,
      covered: false,
      fanMisused: false,
      wetBody: false,
      crackOpen: false,
      raised: false,
      wrapped: false,
      duration: placementDrySeconds(placement, state.season, state.humidity),
      humidityCurve: humidityCurve(state.seed, state.humidity),
      scheduled: scheduled.map((event) => event.id),
      sunCrack: false,
      winterCrack: false,
    },
    bisque: {
      deviation: 0,
      brittle: false,
      wetExtra: 0,
      exploded: false,
      scheduled: [],
      maxTemp: 0,
    },
    failReason: null,
  }
}

export function setPlacement(state: GameState, placement: PlacementId): GameState {
  if (!state.dry) return state
  return {
    ...state,
    dry: {
      ...state.dry,
      placement,
      duration: placementDrySeconds(placement, state.season, state.humidity),
    },
  }
}

export function peakHumidity(state: GameState): number {
  const curve = state.dry?.humidityCurve ?? [state.humidity]
  return Math.max(state.humidity, ...curve)
}

export function currentBand(state: GameState): number {
  return bisqueBandWidth(state.season, peakHumidity(state))
}

export function armBisque(state: GameState, novice: boolean, practice: boolean): { state: GameState; blocked: 'crack' | null } {
  if (state.dry?.crackOpen) return { state: { ...state, failReason: 'crack' }, blocked: 'crack' }
  const planned = planStageEvents({
    seed: state.seed,
    phase: 'bisque',
    season: state.season,
    weather: state.weather,
    novice,
    practice,
    salt: state.ops.join(','),
    forceId: state.dry?.wetBody ? 'e9' : undefined,
  })
  const wetExtra = Math.max(state.bisque?.wetExtra ?? 0, state.ops.includes('e4:miss') ? 0.15 : 0)
  const bisque: BisqueState = {
    deviation: 0,
    brittle: false,
    wetExtra,
    exploded: false,
    scheduled: planned.map((event) => event.id),
    maxTemp: 0,
  }
  return { state: { ...state, bisque, failReason: null }, blocked: null }
}

export function finishBisque(state: GameState, deviation: number, maxTemp: number): GameState {
  if (state.stage === 'glaze') return state
  const ceiling = difficulty.bisqueCeiling + difficulty.bisqueOverTemp
  const brittle = maxTemp > ceiling
  const flaws = state.flaws.filter((flaw) => flaw.from !== 'bisque' && flaw.from !== 'bisque-hot')
  if (deviation > difficulty.bisqueDeviationLimit) flaws.push({ id: 'pinhole-bisque', visual: 'pinhole', from: 'bisque' })
  if (brittle) flaws.push({ id: 'brittle', visual: 'crack', from: 'bisque-hot' })
  return {
    ...state,
    stage: 'glaze',
    flaws,
    bisque: {
      deviation,
      brittle,
      wetExtra: state.bisque?.wetExtra ?? 0,
      exploded: false,
      scheduled: state.bisque?.scheduled ?? [],
      maxTemp,
    },
    ops: [...state.ops, `bisque:${deviation.toFixed(1)}`],
    failReason: null,
  }
}

export function beginFire(state: GameState, picks: GlazePick[], stamps: GlazeStamp[], cards: number, novice: boolean, practice: boolean): GameState {
  const stock = glazeStock(cards, state.clay?.quality ?? 'good')
  const glaze = buildGlaze(picks, stamps, stock)
  const holdHours = 2
  const fire = scheduleFire(state, holdHours, novice, practice)
  return {
    ...state,
    stage: 'fire',
    glaze,
    fire,
    result: null,
    failReason: null,
    ops: [...state.ops, `glaze:${picks.map((pick) => `${pick.id}:${pick.layers}`).join(',')}`],
  }
}

function scheduleFire(state: GameState, holdHours: number, novice: boolean, practice: boolean): FireState {
  const planned = planStageEvents({
    seed: state.seed,
    phase: 'fire',
    season: state.season,
    weather: state.weather,
    novice,
    practice,
    salt: `${state.ops.join(',')}|hold:${holdHours}`,
    forceId: holdHours < firing.lowHoldHours ? 'e15' : undefined,
  })
  return {
    peakTemp: state.fire?.peakTemp ?? 1120,
    holdHours,
    doorOpened: false,
    exploded: false,
    scheduled: planned.map((event) => event.id),
    heldExtra: false,
  }
}

export function retuneFire(state: GameState, peakTemp: number, holdHours: number, novice: boolean, practice: boolean): GameState {
  return { ...state, fire: { ...scheduleFire(state, holdHours, novice, practice), peakTemp } }
}

export function finishFire(state: GameState, forceSafe = false): { state: GameState; fail: null | 'stuck' | 'shatter' } {
  if (state.result && !forceSafe) {
    if (state.result.shattered) return { state, fail: 'shatter' }
    if (state.result.stuck) return { state, fail: 'stuck' }
    return { state, fail: null }
  }
  const result = computeKilnResult(state, forceSafe)
  if (result.shattered) return { state: { ...state, result, failReason: 'shatter' }, fail: 'shatter' }
  if (result.stuck) return { state: { ...state, result, failReason: 'stuck' }, fail: 'stuck' }
  return { state: { ...state, result, failReason: null }, fail: null }
}

export function collapseToMix(state: GameState): GameState {
  return {
    ...state,
    stage: 'mix',
    clay: null,
    radii: [],
    thickness: [],
    baseRadii: [],
    lean: 0,
    dry: null,
    bisque: null,
    glaze: null,
    fire: null,
    result: null,
    flaws: [],
    ops: [...state.ops, 'collapse'],
    retries: state.retries + 1,
    failReason: null,
  }
}

export function retryStage(state: GameState, countIt: boolean, novice: boolean, practice: boolean): GameState {
  let next: GameState = {
    ...state,
    failReason: null,
    result: null,
    retries: countIt ? state.retries + 1 : state.retries,
    ops: [...state.ops, `retry:${state.stage}`],
  }
  if (next.stage === 'mix') {
    next.clay = next.clay ? { ...next.clay, knead: 0 } : null
    return next
  }
  if (next.stage === 'throw') {
    const radii = cylinderRadii()
    return { ...next, radii, thickness: thicknessFromRadii(radii), flaws: next.flaws.filter((flaw) => flaw.from !== 'throw') }
  }
  if (next.stage === 'dry') {
    next = {
      ...next,
      flaws: next.flaws.filter((flaw) => !DRY_SOURCES.has(flaw.from)),
      lean: 0,
    }
    return freshDry(next, 'shade', novice, practice)
  }
  if (next.stage === 'glaze') return { ...next, glaze: null, stage: 'glaze' }
  return { ...next, fire: scheduleFire(next, next.fire?.holdHours ?? 2, novice, practice), stage: 'fire' }
}

function safeGlaze(): { picks: GlazePick[]; stamps: GlazeStamp[] } {
  return {
    picks: [
      { id: 'qinghui', layers: 1, concentration: 0.7 },
      { id: 'mihuang', layers: 1, concentration: 0.6 },
    ],
    stamps: [],
  }
}

export function applyDemo(state: GameState, novice: boolean, practice: boolean): GameState {
  const marked: GameState = { ...state, demoUsed: true, failReason: null, ops: [...state.ops, `demo:${state.stage}`] }
  if (marked.stage === 'mix') {
    const recipe = clayData.recommended
    const clay = mixClay(recipe, recipe.water, marked.humidity, 1)
    return beginThrow(withClay(marked, clay))
  }
  if (marked.stage === 'throw') return finishThrow(marked, ghostRadii())
  if (marked.stage === 'dry') {
    const dried = freshDry(marked, 'shade', novice, true)
    return finishBisque(dried, 0, 640)
  }
  if (marked.stage === 'glaze') {
    const safe = safeGlaze()
    return beginFire(marked, safe.picks, safe.stamps, 0, novice, practice)
  }
  const safe = safeGlaze()
  const stocked = buildGlaze(safe.picks, safe.stamps, 8)
  const fired: GameState = {
    ...marked,
    glaze: stocked,
    fire: { peakTemp: 1120, holdHours: 2, doorOpened: false, exploded: false, scheduled: [], heldExtra: true },
    bisque: marked.bisque ? { ...marked.bisque, brittle: false, exploded: false } : marked.bisque,
  }
  const done = finishFire(fired, true)
  return done.state
}

export function snapshotOf(state: GameState): CupSnapshot | null {
  if (!state.result || !state.clay || !state.glaze || !state.fire) return null
  if (state.result.stuck || state.result.shattered) return null
  return {
    schemaVersion: SCHEMA_VERSION,
    seed: state.seed,
    month: state.month,
    season: state.season,
    weather: state.weather,
    humidity: state.humidity,
    temperature: state.temperature,
    clay: state.clay,
    radii: state.radii.slice(),
    thickness: state.thickness.slice(),
    lean: state.lean,
    glaze: state.glaze,
    fire: state.fire,
    result: state.result,
    flaws: state.result.flaws,
    ops: state.ops.slice(),
  }
}

export function needsDemo(retries: number): boolean {
  return retries >= difficulty.maxRetriesBeforeDemo
}

/** 可塑性、吸湿都刚踏进甜区的泥。揉完，含水，但不取推荐配方。 */
function edgeClay(humidity: number): ClayState {
  const [p0, p1] = clayData.sweet.P
  const [h0, h1] = clayData.sweet.H
  let best: ClayState | null = null
  let bestScore = Infinity
  for (let kaolin = 0; kaolin <= 20; kaolin++) {
    for (let aged = 0; aged <= 20 - kaolin; aged++) {
      const diger = 20 - kaolin - aged
      for (let water = 1; water <= clayData.waterMax; water++) {
        const clay = mixClay({ diger, kaolin, aged }, water, humidity, 1)
        if (clay.P < p0 || clay.P > p1 || clay.H < h0 || clay.H > h1) continue
        const wet = Math.max(0, water / clayData.waterMax - 0.1)
        if (0.2 + wet * 1.25 - clay.P * 0.85 > 0.16) continue
        const score = clay.P - p0 + (clay.H - h0)
        if (score < bestScore) {
          bestScore = score
          best = clay
        }
      }
    }
  }
  const recipe = clayData.recommended
  return best ?? mixClay(recipe, recipe.water, humidity, 1)
}

/** 两种釉温区相交的最低点，各上一层、浓度贴着操作下限。 */
function edgeGlaze(): { picks: GlazePick[]; peak: number } {
  let best: { a: string; b: string; peak: number } | null = null
  const list = glazeData.glazes
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const lo = Math.max(list[i].tempMin, list[j].tempMin)
      const hi = Math.min(list[i].tempMax, list[j].tempMax)
      if (lo > hi) continue
      if (!best || lo < best.peak) best = { a: list[i].id, b: list[j].id, peak: lo }
    }
  }
  return {
    picks: [
      { id: best?.a ?? 'jianghe', layers: 1, concentration: 0.3 },
      { id: best?.b ?? 'wuguang', layers: 1, concentration: 0.3 },
    ],
    peak: best?.peak ?? 1080,
  }
}

function legalPeak(picks: GlazePick[]): number | null {
  if (picks.length === 0) return null
  let lo = -Infinity
  let hi = Infinity
  for (const pick of picks) {
    const spec = glazeById(pick.id)
    if (!spec) return null
    lo = Math.max(lo, spec.tempMin)
    hi = Math.min(hi, spec.tempMax)
  }
  if (lo > hi) return null
  return lo
}

/** 用刚好达标的数值结束当前环节，并进入下一步。 */
export function skipStage(state: GameState, novice: boolean): GameState {
  const marked: GameState = {
    ...state,
    failReason: null,
    ops: [...state.ops, `skip:${state.stage}`],
  }
  if (marked.stage === 'mix') return beginThrow(withClay(marked, edgeClay(marked.humidity)))
  if (marked.stage === 'throw') {
    const radii = cylinderRadii()
    return finishThrow(
      { ...marked, flaws: marked.flaws.filter((flaw) => flaw.from !== 'throw') },
      radii,
      thicknessFromRadii(radii),
      novice,
      marked.practice,
    )
  }
  if (marked.stage === 'dry') {
    const cleaned: GameState = {
      ...marked,
      flaws: marked.flaws.filter((flaw) => !DRY_SOURCES.has(flaw.from)),
      lean: 0,
    }
    const dried = freshDry(cleaned, 'shade', novice, marked.practice)
    return finishBisque(dried, difficulty.bisqueDeviationLimit, difficulty.bisqueCeiling)
  }
  if (marked.stage === 'glaze') {
    const edge = edgeGlaze()
    const entered = beginFire(marked, edge.picks, [], 0, novice, marked.practice)
    return retuneFire(entered, edge.peak, firing.lowHoldHours, novice, marked.practice)
  }
  const edge = edgeGlaze()
  const picks = marked.glaze?.picks ?? []
  const peak = legalPeak(picks) ?? edge.peak
  const glaze = legalPeak(picks) != null && marked.glaze ? marked.glaze : buildGlaze(edge.picks, [], glazeStock(0, marked.clay?.quality ?? 'good'))
  const fired: GameState = {
    ...marked,
    result: null,
    glaze,
    fire: {
      peakTemp: peak,
      holdHours: firing.lowHoldHours,
      doorOpened: false,
      exploded: false,
      scheduled: [],
      heldExtra: false,
    },
  }
  return finishFire(fired, false).state
}
