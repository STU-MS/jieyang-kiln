import difficulty from '../data/difficulty.json'
import firing from '../data/firing.json'
import { hashString, mulberry32 } from './rng'
import { SCHEMA_VERSION } from './schema'
import type { Flaw, GameState, GlazeWord, Grade, KilnResult, PatternId, ShapeWord } from './types'
import { glazeById } from './glaze'

const HONOR = new Set(['faint-scar'])

export function geometryHash(radii: number[]): string {
  const q = radii.map((r) => r.toFixed(3)).join(',')
  return (hashString(q) >>> 0).toString(16).padStart(8, '0')
}

function pushFlaw(flaws: Flaw[], flaw: Flaw): void {
  if (!flaws.some((item) => item.id === flaw.id)) flaws.push(flaw)
}

function shapeOf(state: GameState, flaws: Flaw[]): ShapeWord {
  if (state.lean > 0.08 || flaws.some((f) => f.visual === 'warp' && !HONOR.has(f.id))) return 'warp'
  if (state.lean < 0.04) return 'round'
  return 'fair'
}

function glazeWordOf(state: GameState, flaws: Flaw[], gloss: number): GlazeWord {
  if (state.glaze?.footRisk || flaws.some((f) => f.visual === 'foot')) return 'run'
  if ((state.glaze?.uniformity ?? 1) < 0.4 || gloss < 0.35 || flaws.some((f) => f.visual === 'matte')) return 'thin'
  return 'held'
}

function gradeOf(state: GameState, flaws: Flaw[], shape: ShapeWord, glazeWord: GlazeWord, demo: boolean): Grade {
  const real = flaws.filter((f) => !HONOR.has(f.id))
  if (
    !demo &&
    real.length === 0 &&
    shape === 'round' &&
    glazeWord === 'held' &&
    state.clay?.quality !== 'poor' &&
    !state.glaze?.footRisk &&
    (state.glaze?.uniformity ?? 0) >= 0.7
  ) {
    return 'L0'
  }
  const wounded = real.some((f) =>
    ['chip', 'crack', 'pinhole', 'crazing', 'warp', 'stain', 'bubble', 'foot', 'yellow'].includes(f.visual),
  )
  if (wounded || shape === 'warp') return 'L2'
  return 'L1'
}

export function computeKilnResult(state: GameState, forceSafe = false): KilnResult {
  const clay = state.clay
  const glaze = state.glaze
  const fire = state.fire
  const geo = geometryHash(state.radii)
  const canonical = [
    SCHEMA_VERSION,
    state.seed,
    (clay?.I ?? 0).toFixed(4),
    (glaze?.picks ?? []).map((p) => `${p.id}:${p.layers}:${p.concentration.toFixed(2)}`).join(','),
    fire?.peakTemp ?? 0,
    fire?.holdHours ?? 0,
    geo,
    state.ops.join(','),
    state.flaws.map((f) => f.id).join(','),
    state.lean.toFixed(3),
    forceSafe ? 'safe' : 'play',
  ].join('|')
  const rng = mulberry32(hashString(canonical))
  let atmosphere = rng()
  if (state.ops.includes('e13:ok')) atmosphere = Math.min(1, atmosphere + 0.18)
  const iron = clay?.I ?? 0
  const hueShift = (rng() - 0.5) * 36 + (iron - 0.2) * 24
  const picks = glaze?.picks ?? []
  const ids = new Set(picks.map((p) => p.id))
  let pattern: PatternId = 'none'
  const roll = rng()
  if (ids.has('tiexiu') || ids.has('jianghe')) pattern = roll > 0.25 ? 'rust' : 'oilspot'
  else if (ids.has('caomu')) pattern = roll > 0.4 ? 'hare' : 'oilspot'
  else if (ids.has('qinghui')) pattern = roll > 0.55 ? 'hare' : 'none'
  else if (ids.has('mihuang')) pattern = roll > 0.7 ? 'oilspot' : 'none'
  else pattern = 'none'
  const density = Math.max(0, Math.min(1, rng() * 0.45 + (pattern === 'none' ? 0.05 : 0.35) + (ids.has('tiexiu') ? 0.2 : 0)))
  let gloss = 0.4 + rng() * 0.45
  const flow = (rng() - 0.5) * 2
  const flaws = state.flaws.map((f) => ({ ...f }))
  for (const pick of picks) {
    const spec = glazeById(pick.id)
    if (!spec || !fire) continue
    if (fire.peakTemp < spec.tempMin) {
      gloss = Math.min(gloss, 0.28)
      pushFlaw(flaws, { id: `matte-${pick.id}`, visual: 'matte', from: 'temp-low' })
    } else if (fire.peakTemp > spec.tempMax) {
      gloss = Math.max(gloss, 0.82)
      pushFlaw(flaws, { id: `run-${pick.id}`, visual: 'foot', from: 'temp-high' })
    }
  }
  const chips = state.flaws.filter((f) => f.visual === 'chip').length
  if (chips > 0 && rng() < Math.min(0.95, difficulty.chipCrackBonus * chips)) {
    pushFlaw(flaws, { id: 'chip-crack', visual: 'crack', from: 'chip' })
  }
  if ((fire?.holdHours ?? 0) < firing.lowHoldHours && !state.ops.includes('e15:ok') && !fire?.heldExtra) {
    gloss = Math.min(gloss, 0.3)
    pushFlaw(flaws, { id: 'underfired', visual: 'matte', from: 'hold' })
  }
  const stuckRoll = rng()
  const stuck = !forceSafe && Boolean(glaze?.footRisk) && stuckRoll < firing.stuckChance
  const shattered = !forceSafe && (Boolean(state.bisque?.brittle) || Boolean(fire?.exploded))
  const demo = forceSafe || state.demoUsed
  const shapeWord = shapeOf(state, flaws)
  const glazeWord = glazeWordOf(state, flaws, gloss)
  const grade = gradeOf(state, flaws, shapeWord, glazeWord, demo)
  const signature = [
    hueShift.toFixed(3),
    pattern,
    density.toFixed(4),
    gloss.toFixed(4),
    flow.toFixed(3),
    atmosphere.toFixed(4),
    flaws.map((f) => f.id).sort().join('+'),
    geo,
    state.lean.toFixed(3),
  ].join('|')
  const uniqueId = `JY-${(hashString(`${signature}|${canonical}`) >>> 0).toString(16).padStart(8, '0')}`
  return {
    hueShift,
    pattern,
    density,
    gloss,
    flow,
    uniqueId,
    signature,
    grade,
    shapeWord,
    glazeWord,
    demo,
    geoHash: geo,
    atmosphere,
    stuck,
    shattered,
    flaws,
  }
}
