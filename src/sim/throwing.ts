import cup from '../data/cup.json'
import difficulty from '../data/difficulty.json'
import throwing from '../data/throwing.json'
import { clamp, lerp } from './math'

/** 拉坯时那颗半透明圆球的半径。杯壁的转角不能比它更尖。 */
export const FINGER_RADIUS = 0.078

export function radiusAt(t: number, foot: number, belly: number, mouth: number): number {
  const knots = [0, 0.12, 0.45, 0.72, 1]
  const vals = [foot, foot + (belly - foot) * 0.35, belly, belly + (mouth - belly) * 0.25, mouth]
  if (t <= 0) return vals[0]
  if (t >= 1) return vals[vals.length - 1]
  for (let i = 0; i < knots.length - 1; i++) {
    if (t <= knots[i + 1]) {
      const u = (t - knots[i]) / (knots[i + 1] - knots[i])
      const s = u * u * (3 - 2 * u)
      return lerp(vals[i], vals[i + 1], s)
    }
  }
  return vals[vals.length - 1]
}

export function radiiFromHandles(foot: number, belly: number, mouth: number, n = cup.rings): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1)
    out.push(radiusAt(t, foot, belly, mouth))
  }
  return out
}

export function ghostRadii(): number[] {
  return radiiFromHandles(throwing.targetFoot, throwing.targetBelly, throwing.targetMouth)
}

export function cylinderRadii(r = cup.initialRadius): number[] {
  return Array.from({ length: cup.rings }, () => r)
}

export function thicknessFromRadii(radii: number[]): number[] {
  return radii.map((r) => clamp(cup.wall * (cup.initialRadius / Math.max(r, 0.2)), 0.03, 0.16))
}

export function centerOfMass(radii: number[]): { h: number; mouth: number } {
  let m = 0
  let my = 0
  for (let i = 0; i < radii.length; i++) {
    const w = radii[i] * radii[i]
    const y = radii.length <= 1 ? 0 : i / (radii.length - 1)
    m += w
    my += w * y
  }
  const mouth = Math.max(0.05, radii[radii.length - 1] ?? 0.05)
  return { h: m > 0 ? my / m : 0.5, mouth }
}

export function stability(input: {
  P: number
  rpm: number
  waterNorm: number
  hCenter: number
  mouthRadius: number
  steady: number
  poor: boolean
  waterZero: boolean
}): number {
  const base = input.P * throwing.plasticityCoeff
  const center = throwing.centerHeightPenalty * (input.hCenter / Math.max(0.05, input.mouthRadius))
  const rpm = throwing.rpmPenalty * (input.rpm / throwing.rpmRef) ** 2
  const water = throwing.waterPenalty * (input.waterNorm - throwing.waterSweet) ** 2
  const skill = throwing.skillBonus * Math.min(throwing.skillCapSeconds, Math.max(0, input.steady))
  let s = base - center - rpm - water + skill
  if (input.poor) s -= throwing.poorTax
  if (input.waterZero) s -= throwing.dryTax
  return s
}

function meanRange(radii: number[], t0: number, t1: number): number {
  const n = radii.length
  if (n === 0) return 0
  const i0 = Math.max(0, Math.floor(t0 * (n - 1)))
  const i1 = Math.min(n - 1, Math.ceil(t1 * (n - 1)))
  let s = 0
  let c = 0
  for (let i = i0; i <= i1; i++) {
    s += radii[i]
    c += 1
  }
  return c ? s / c : 0
}

export function matchesTarget(radii: number[]): boolean {
  const ghost = ghostRadii()
  if (radii.length !== ghost.length) return false
  let max = 0
  for (let i = 0; i < radii.length; i++) max = Math.max(max, Math.abs(radii[i] - ghost[i]))
  if (max > throwing.matchTolerance) return false
  const foot = meanRange(radii, 0, 0.14)
  const belly = meanRange(radii, 0.36, 0.56)
  const mouth = meanRange(radii, 0.88, 1)
  return mouth > belly && belly > foot
}

export interface ThrowInput {
  radii: number[]
  foot: number
  belly: number
  mouth: number
  rpm: number
  rpmDelta: number
  dt: number
  waterNorm: number
  P: number
  poor: boolean
  waterZero: boolean
  steady: number
  localTime: number
  totalTime: number
  forming?: boolean
}

export interface ThrowStep {
  radii: number[]
  s: number
  steady: number
  localTime: number
  totalTime: number
  event: 'local' | 'total' | null
  hCenter: number
  mouth: number
  sway: number
}

/** 0 时杯壁站正；越接近整体垮塌越接近 1。只驱动晃动，不改半径。 */
export function swayAmount(s: number): number {
  if (s >= difficulty.localCollapseS) return 0
  const span = difficulty.localCollapseS - difficulty.totalCollapseS
  return clamp((difficulty.localCollapseS - s) / Math.max(0.01, span), 0, 1)
}

export function stepThrow(input: ThrowInput): ThrowStep {
  let radii = input.radii
  if (input.forming !== false) {
    const dest = radiiFromHandles(input.foot, input.belly, input.mouth, input.radii.length)
    const rate = throwing.radiusPerSecondAtMaxRpm * (input.rpm / throwing.rpmMax) * input.dt
    radii = input.radii.map((r, i) => r + clamp(dest[i] - r, -rate, rate))
  } else {
    radii = input.radii.slice()
  }
  const com = centerOfMass(radii)
  let steady = Math.abs(input.rpmDelta) > throwing.steadyRpmDelta ? 0 : input.steady
  const s = stability({
    P: input.P,
    rpm: input.rpm,
    waterNorm: input.waterNorm,
    hCenter: com.h,
    mouthRadius: com.mouth,
    steady,
    poor: input.poor,
    waterZero: input.waterZero,
  })
  let localTime = input.localTime
  let totalTime = input.totalTime
  if (s < difficulty.totalCollapseS) {
    totalTime += input.dt
    localTime = 0
    steady = 0
  } else if (s < difficulty.localCollapseS) {
    localTime += input.dt
    totalTime = 0
    steady = 0
  } else {
    localTime = 0
    totalTime = 0
    steady = Math.min(throwing.skillCapSeconds, steady + input.dt)
  }
  let event: 'local' | 'total' | null = null
  if (totalTime >= difficulty.totalCollapseSeconds) {
    event = 'total'
    totalTime = 0
  } else if (input.localTime < difficulty.localCollapseSeconds && localTime >= difficulty.localCollapseSeconds) {
    event = 'local'
  }
  return { radii, s, steady, localTime, totalTime, event, hCenter: com.h, mouth: com.mouth, sway: swayAmount(s) }
}

export const THROW_SECTORS = 48
export type ShapeMode = 'column' | 'band'
export type ThrowTool = 'column' | 'radial' | 'smooth'

export interface WallState {
  r: number[]
  y: number[]
  vr: number[]
  vy: number[]
  restR: number[]
  /** 成形后相邻两点的竖直间距。斥力按它和实际间距的差值来。 */
  restDy: number[]
  /** 每个受力点名下的泥体积，成形和坍塌都不改它。 */
  vol: number[]
  /** 绕轴一圈的母线。手只改转到手指下的那几瓣，其余保持原样。 */
  sectorR: number[][]
  sectorY: number[][]
}

export interface WallStep {
  collapsed: boolean
  /** 大于 0 还撑得住，到 0 附近是临界，负数是已经超载。 */
  margin: number
  load: number
}

const WALL_G = 0.42
const WALL_CENT = 1.55
const WALL_PULL = 2500
const WALL_COHESION = 80
const WALL_VISC = 36
const WALL_REP = 3000
const WALL_REP_MAX = 90
const WALL_DAMP = 4.2
const WALL_SUBSTEP = 1 / 480

export function wallFromRadii(radii: number[], height = cup.height): WallState {
  const n = Math.max(2, radii.length)
  const r = radii.slice()
  const y = r.map((_, i) => (i / (n - 1)) * height)
  const restDy: number[] = []
  for (let i = 0; i < n - 1; i++) restDy.push(y[i + 1] - y[i])
  const vol = r.map((radius, i) => annulusVolume(radius, ownedLength(r, y, i), cup.wall))
  const sectorR = Array.from({ length: THROW_SECTORS }, () => r.slice())
  const sectorY = Array.from({ length: THROW_SECTORS }, () => y.slice())
  return { r, y, vr: r.map(() => 0), vy: r.map(() => 0), restR: r.slice(), restDy, vol, sectorR, sectorY }
}

function clayHold(input: { P: number; waterNorm: number; poor: boolean; waterZero: boolean }): number {
  const wet = Math.max(0, input.waterNorm - 0.1)
  let soft = 0.2 + wet * 1.25 - input.P * 0.85
  if (input.poor) soft += 0.32
  if (input.waterZero) soft += 0.4
  return 1 / clamp(soft, 0.16, 1.7)
}

function ownedLength(r: number[], y: number[], i: number): number {
  const n = r.length
  let length = 0
  if (i > 0) length += Math.hypot(r[i] - r[i - 1], y[i] - y[i - 1]) * 0.5
  if (i < n - 1) length += Math.hypot(r[i + 1] - r[i], y[i + 1] - y[i]) * 0.5
  return Math.max(length, 1e-6)
}

/** 外半径为 R、径向壁厚为 t、沿母线的材料长度为 L 时，旋转体体积是 π(2Rt − t²)L。 */
function annulusVolume(radius: number, length: number, thick: number): number {
  const span = Math.max(0, 2 * radius * thick - thick * thick)
  return Math.PI * span * length
}

function shellAt(radius: number, length: number, volume: number): { outer: number; thick: number } {
  const R = Math.max(radius, 1e-4)
  const L = Math.max(length, 1e-6)
  const S = volume / (Math.PI * L)
  if (S < R * R) {
    const inner = Math.sqrt(R * R - S)
    return { outer: R, thick: R - inner }
  }
  const outer = Math.sqrt(S)
  return { outer, thick: outer }
}

export function wallShell(wall: WallState): { outer: number[]; thickness: number[] } {
  const outer: number[] = []
  const thickness: number[] = []
  for (let i = 0; i < wall.r.length; i++) {
    const shell = shellAt(wall.r[i], ownedLength(wall.r, wall.y, i), wall.vol[i])
    outer.push(shell.outer)
    thickness.push(shell.thick)
  }
  return { outer, thickness }
}

export function wallVolume(wall: WallState): number {
  return wall.vol.reduce((sum, volume) => sum + volume, 0)
}

export function measuredWallVolume(wall: WallState): number {
  const shell = wallShell(wall)
  let sum = 0
  for (let i = 0; i < wall.r.length; i++) {
    const length = ownedLength(wall.r, wall.y, i)
    const outer = shell.outer[i]
    const inner = Math.max(0, outer - shell.thickness[i])
    sum += Math.PI * (outer * outer - inner * inner) * length
  }
  return sum
}

function circleWeight(dist: number, radius: number): number {
  if (!(radius > 0) || dist >= radius) return 0
  const u = dist / radius
  return Math.sqrt(Math.max(0, 1 - u * u))
}

function nearestIndex(y: number[], yHit: number): number {
  let center = 0
  let best = Infinity
  for (let i = 0; i < y.length; i++) {
    const d = Math.abs(y[i] - yHit)
    if (d < best) {
      best = d
      center = i
    }
  }
  return center
}

/** 接触点附近收成圆弧，宽度停在圆球直径上下，不会跟着推的幅度越摊越大。一步里肩上每个点最多挪过这一下的幅度，避免圆弧突然扩出去把邻圈拽走。 */
function roundShoulder(r: number[], y: number[], center: number, dir: number, weight: number[], limit: number): void {
  const y0 = y[center]
  let near = r[center]
  let nearDist = Infinity
  for (let i = center + dir; i >= 0 && i < r.length; i += dir) {
    const dist = Math.abs(y[i] - y0)
    const score = Math.abs(dist - FINGER_RADIUS)
    if (score < nearDist) {
      nearDist = score
      near = r[i]
    }
    if (dist > FINGER_RADIUS * 1.5) break
  }
  const drop = r[center] - near
  if (Math.abs(drop) < 0.004) return
  const reach = Math.min(Math.max(FINGER_RADIUS, Math.abs(drop)), FINGER_RADIUS * 2.2)
  let edge = -1
  for (let i = center + dir; i >= 0 && i < r.length; i += dir) {
    if (Math.abs(y[i] - y0) >= reach - 1e-4) {
      edge = i
      break
    }
  }
  if (edge < 0) return
  const span = Math.abs(y[edge] - y0)
  if (span < 1e-4) return
  const room = Math.max(0, limit)
  for (let i = center + dir; i !== edge && i >= 0 && i < r.length; i += dir) {
    const u = Math.abs(y[i] - y0) / span
    if (u >= 1) break
    const w = Math.sqrt(Math.max(0, 1 - u * u))
    const target = Math.max(0.02, r[edge] + (r[center] - r[edge]) * w)
    const delta = target - r[i]
    const step = Math.max(-room, Math.min(room, delta))
    if (Math.abs(step) < 1e-8) continue
    r[i] = Math.max(0.02, r[i] + step)
    const followed = Math.abs(delta) <= room + 1e-8 ? w : w * (Math.abs(step) / Math.abs(delta))
    weight[i] = Math.max(weight[i], followed)
  }
}

function editProfile(r: number[], y: number[], yHit: number, dr: number, dy: number, mode: ShapeMode): number[] {
  const n = r.length
  const weight = new Array<number>(n).fill(0)
  if (n === 0 || (dr === 0 && dy === 0)) return weight
  const center = nearestIndex(y, yHit)
  const centerY = y[center]
  const savedY = y.slice()
  const reachY = Math.min(Math.max(FINGER_RADIUS, Math.abs(dr), Math.abs(dy)), FINGER_RADIUS * 2.2)
  for (let i = 0; i < n; i++) {
    const dyh = y[i] - centerY
    const column = mode === 'column' && dyh >= -1e-8
    if (!column && i !== center) continue
    weight[i] = 1
    r[i] = Math.max(0.02, r[i] + dr)
    if (i > 0) y[i] += dy
  }
  const sides = mode === 'column' ? [-1] : [-1, 1]
  for (const dir of sides) roundShoulder(r, y, center, dir, weight, Math.abs(dr))
  if (dy !== 0) {
    for (let i = 0; i < n; i++) {
      if (weight[i] >= 1 || i === 0) continue
      const w = circleWeight(Math.abs(savedY[i] - centerY), reachY)
      if (w <= 0) continue
      y[i] += dy * w
      weight[i] = Math.max(weight[i], w)
    }
  }
  y[0] = 0
  const gap = 0.004
  if (mode === 'band') {
    for (let i = 1; i < n; i++) {
      if (weight[i] <= 0) {
        y[i] = savedY[i]
        continue
      }
      const lo = y[i - 1] + gap
      let hi = Number.POSITIVE_INFINITY
      for (let j = i + 1; j < n; j++) {
        if (weight[j] <= 0) {
          hi = savedY[j] - gap * (j - i)
          break
        }
      }
      y[i] = Math.min(hi, Math.max(lo, y[i]))
    }
  } else {
    let overlapped = false
    for (let i = 1; i < n; i++) {
      const savedGap = (savedY[i] ?? 0) - (savedY[i - 1] ?? 0)
      const floor = Math.max(gap, savedGap * 0.9)
      if ((y[i] ?? 0) < (y[i - 1] ?? 0) + floor) {
        overlapped = true
        break
      }
    }
    // 往下带时，肩上的落差如果收成最小缝，这几圈的材料长度会塌掉，同样的体积就把壁厚一下顶起来。
    // 改成接触点以上整段平移，腾出来的高度分给下面每一圈；单圈再短，也不低于这一步之前平均间距的七成。
    if (overlapped && center > 0) {
      const pitch = ((savedY[n - 1] ?? 1) - (savedY[0] ?? 0)) / Math.max(1, n - 1)
      const minGap = Math.max(gap, pitch * 0.72)
      const savedCenter = Math.max(1e-6, savedY[center] ?? 0)
      const yCenter = Math.max(minGap * center, y[center] ?? savedCenter)
      const scale = yCenter / savedCenter
      for (let i = 1; i < center; i++) {
        y[i] = (savedY[i] ?? 0) * scale
        weight[i] = 1
      }
      y[center] = yCenter
      weight[center] = 1
      for (let i = center + 1; i < n; i++) {
        y[i] = yCenter + (savedY[i] ?? 0) - savedCenter
        weight[i] = 1
      }
    }
    for (let i = 1; i < n; i++) {
      const floor = y[i - 1] + gap
      if (y[i] >= floor) continue
      const lift = floor - y[i]
      for (let j = i; j < n; j++) y[j] += lift
    }
  }
  return weight
}

function settleRest(wall: WallState, weight: number[]): void {
  const n = wall.r.length
  for (let i = 0; i < n; i++) {
    const w = weight[i]
    if (w <= 0) continue
    wall.restR[i] += (wall.r[i] - wall.restR[i]) * w
    wall.vr[i] = 0
    wall.vy[i] = 0
  }
  wall.y[0] = 0
  wall.vy[0] = 0
  for (let i = 0; i < n - 1; i++) {
    const w = Math.max(weight[i] ?? 0, weight[i + 1] ?? 0)
    if (w <= 0) continue
    const span = wall.y[i + 1] - wall.y[i]
    wall.restDy[i] += (span - wall.restDy[i]) * w
  }
}

function syncMean(wall: WallState): void {
  const n = wall.r.length
  const count = wall.sectorR.length
  if (count === 0) return
  for (let i = 0; i < n; i++) {
    let radius = 0
    let height = 0
    for (let s = 0; s < count; s++) {
      radius += wall.sectorR[s][i] ?? 0
      height += wall.sectorY[s][i] ?? 0
    }
    wall.r[i] = radius / count
    wall.y[i] = height / count
  }
  wall.y[0] = 0
  for (let s = 0; s < count; s++) wall.sectorY[s][0] = 0
}

export function shapeWall(wall: WallState, yHit: number, dr: number, dy: number, mode: ShapeMode = 'column'): void {
  const weight = editProfile(wall.r, wall.y, yHit, dr, dy, mode)
  settleRest(wall, weight)
  copyProfile(wall)
}

/**
 * 在滑过的这一段上解一次三次平滑样条：半径靠近一条尽量少弯曲的曲线，弯曲用二阶差分的平方来罚。
 * 两端钉在原来的壁上，修正量再乘一条端部斜率为零的升余弦，所以和没抹到的地方是一阶连续的。
 * 同一次只朝这条顺曲线走一截；再抹，就更靠近它。
 */
export function smoothWall(wall: WallState, y0: number, y1: number): void {
  const n = wall.r.length
  if (n < 3) return
  const travel = Math.abs(y1 - y0)
  if (travel < 1e-5) return
  const y = wall.y
  const lo = Math.min(y0, y1)
  const hi = Math.max(y0, y1)
  let L = 0
  let R = n - 1
  while (L < n - 1 && (y[L] ?? 0) < lo) L++
  while (R > 0 && (y[R] ?? 0) > hi) R--
  if (R < L) return
  if (R - L < 2) {
    L = Math.max(0, L - 1)
    R = Math.min(n - 1, R + 1)
  }
  if (R - L < 2) return
  const pitch = Math.max(1e-4, ((y[n - 1] ?? 1) - (y[0] ?? 0)) / (n - 1))
  const rho = 0.12 * Math.min(1, travel / pitch)
  const fair = fairSpline(wall.r, y, L, R, rho)
  if (!fair) return
  const span = Math.max(1e-6, (y[R] ?? 0) - (y[L] ?? 0))
  for (let j = 0; j < fair.length; j++) {
    const i = L + 1 + j
    if (i <= 0) continue
    const u = ((y[i] ?? 0) - (y[L] ?? 0)) / span
    const fade = Math.sin(Math.PI * u) ** 2
    const next = Math.max(0.02, wall.r[i] + (fair[j] - wall.r[i]) * fade)
    wall.r[i] = next
    wall.restR[i] = next
    wall.vr[i] = 0
    wall.vy[i] = 0
  }
  copyProfile(wall)
}

/** 端点固定的 Whittaker 平滑：min ‖s-r‖² + ρ‖Δ²s‖²。Δ² 按弧长写成斜率差，间距不匀时也不会被网格带偏。 */
function fairSpline(r: number[], y: number[], L: number, R: number, rho: number): number[] | null {
  const m = R - L - 1
  if (m <= 0) return null
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  const b = new Array<number>(m).fill(0)
  for (let j = 0; j < m; j++) {
    A[j][j] = 1
    b[j] = r[L + 1 + j] ?? 0
  }
  for (let i = L + 1; i <= R - 1; i++) {
    const hL = Math.max(1e-4, (y[i] ?? 0) - (y[i - 1] ?? 0))
    const hR = Math.max(1e-4, (y[i + 1] ?? 0) - (y[i] ?? 0))
    const scale = (hL + hR) / 2
    const coef = [scale / hL, -(scale / hL + scale / hR), scale / hR]
    const index = [i - 1, i, i + 1]
    let fixed = 0
    const free: { j: number; c: number }[] = []
    for (let k = 0; k < 3; k++) {
      const g = index[k]
      if (g <= L || g >= R) fixed += coef[k] * (r[g <= L ? L : R] ?? 0)
      else free.push({ j: g - L - 1, c: coef[k] })
    }
    for (const p of free) {
      b[p.j] -= rho * p.c * fixed
      for (const q of free) A[p.j][q.j] += rho * p.c * q.c
    }
  }
  return solveLinear(A, b)
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const m = b.length
  const M = A.map((row, i) => [...row, b[i] ?? 0])
  for (let col = 0; col < m; col++) {
    let pivot = col
    for (let row = col + 1; row < m; row++) if (Math.abs(M[row][col] ?? 0) > Math.abs(M[pivot][col] ?? 0)) pivot = row
    if (Math.abs(M[pivot][col] ?? 0) < 1e-10) return null
    if (pivot !== col) {
      const swap = M[col]
      M[col] = M[pivot]
      M[pivot] = swap
    }
    const div = M[col][col] ?? 1
    for (let k = col; k <= m; k++) M[col][k] = (M[col][k] ?? 0) / div
    for (let row = 0; row < m; row++) {
      if (row === col) continue
      const factor = M[row][col] ?? 0
      if (factor === 0) continue
      for (let k = col; k <= m; k++) M[row][k] = (M[row][k] ?? 0) - factor * (M[col][k] ?? 0)
    }
  }
  return M.map((row) => row[m] ?? 0)
}

function copyProfile(wall: WallState): void {
  for (let s = 0; s < wall.sectorR.length; s++) {
    wall.sectorR[s] = wall.r.slice()
    wall.sectorY[s] = wall.y.slice()
  }
}

/**
 * 长按的手指是一个挡板。只有转到这个位置、并且鼓出到挡板外的泥会被按回去。
 * 没鼓出来的不往外吸。
 */
export function pressProtrusion(
  wall: WallState,
  sector: number,
  yHit: number,
  targetR: number,
  fromOutside: boolean,
  mode: ShapeMode,
  maxStep: number,
): void {
  const count = wall.sectorR.length
  if (count === 0 || maxStep <= 0) return
  const index = ((sector % count) + count) % count
  const radius = wall.sectorR[index]
  const height = wall.sectorY[index]
  if (!radius || radius.length === 0) return
  let center = 0
  let best = Infinity
  for (let i = 0; i < radius.length; i++) {
    const d = Math.abs((height[i] ?? 0) - yHit)
    if (d < best) {
      best = d
      center = i
    }
  }
  const shell = shellAt(radius[center] ?? 0, ownedLength(radius, height, center), wall.vol[center] ?? 0)
  const surface = fromOutside ? shell.outer : Math.max(0.004, shell.outer - shell.thick)
  const gap = fromOutside ? surface - targetR : targetR - surface
  if (gap <= 0.0015) return
  const dr = (fromOutside ? -1 : 1) * Math.min(gap, maxStep)
  shapeSector(wall, index, yHit, dr, 0, mode)
}

/** 只改一瓣泥。平均母线跟着变，其它角度先不动，等转到手指下再改。 */
export function shapeSector(wall: WallState, sector: number, yHit: number, dr: number, dy: number, mode: ShapeMode): void {
  const count = wall.sectorR.length
  if (count === 0) {
    shapeWall(wall, yHit, dr, dy, mode)
    return
  }
  const index = ((sector % count) + count) % count
  const weight = editProfile(wall.sectorR[index], wall.sectorY[index], yHit, dr, dy, mode)
  syncMean(wall)
  for (let i = 0; i < wall.r.length; i++) {
    if ((weight[i] ?? 0) <= 0) continue
    wall.restR[i] = wall.r[i]
    wall.vr[i] = 0
    wall.vy[i] = 0
  }
  wall.y[0] = 0
  wall.vy[0] = 0
  for (let i = 0; i < wall.r.length - 1; i++) {
    if ((weight[i] ?? 0) <= 0 && (weight[i + 1] ?? 0) <= 0) continue
    wall.restDy[i] = wall.y[i + 1] - wall.y[i]
  }
}

export function sectorOf(angle: number, count = THROW_SECTORS): number {
  const tau = Math.PI * 2
  const u = ((angle % tau) + tau) % tau
  return Math.min(count - 1, Math.floor((u / tau) * count))
}

export function sectorsBetween(a0: number, a1: number, count = THROW_SECTORS): number[] {
  let d = a1 - a0
  const tau = Math.PI * 2
  while (d > Math.PI) d -= tau
  while (d < -Math.PI) d += tau
  const step = tau / count
  const n = Math.max(1, Math.ceil(Math.abs(d) / step))
  const out: number[] = []
  for (let k = 0; k <= n; k++) {
    const sector = sectorOf(a0 + (d * k) / n, count)
    if (out[out.length - 1] !== sector) out.push(sector)
  }
  return out
}

/** 手指占大约三瓣宽。from 到 to 是这一帧扫过的局部角，两端再留一瓣指宽。 */
export function fingerSectors(from: number | null, to: number, count = THROW_SECTORS): number[] {
  const step = (Math.PI * 2) / count
  const start = from ?? to
  let d = to - start
  const tau = Math.PI * 2
  while (d > Math.PI) d -= tau
  while (d < -Math.PI) d += tau
  const sign = d === 0 ? 1 : Math.sign(d)
  return sectorsBetween(start - sign * step, to + sign * step, count)
}

export function sectorShells(wall: WallState): { outer: number[][]; thickness: number[][]; heights: number[][] } {
  const outer: number[][] = []
  const thickness: number[][] = []
  const heights: number[][] = []
  for (let s = 0; s < wall.sectorR.length; s++) {
    const radius = wall.sectorR[s]
    const height = wall.sectorY[s]
    const ringOuter: number[] = []
    const ringThick: number[] = []
    for (let i = 0; i < radius.length; i++) {
      const shell = shellAt(radius[i] ?? 0, ownedLength(radius, height, i), wall.vol[i] ?? 0)
      ringOuter.push(shell.outer)
      ringThick.push(shell.thick)
    }
    outer.push(ringOuter)
    thickness.push(ringThick)
    heights.push(height.slice())
  }
  return { outer, thickness, heights }
}

function wrapPi(angle: number): number {
  let d = angle
  const tau = Math.PI * 2
  while (d > Math.PI) d -= tau
  while (d < -Math.PI) d += tau
  return d
}

/** 圆球压在这一瓣上的分量。扫过的角度算全压，两侧按圆弧收掉。 */
export function fingerWeight(from: number | null, to: number, sector: number, count: number, radius: number): number {
  if (count <= 0) return 0
  const step = (Math.PI * 2) / count
  const mid = (sector + 0.5) * step
  const angDist = (ang: number) => Math.abs(wrapPi(ang - mid))
  let dist = angDist(to)
  if (from != null) {
    const sweep = wrapPi(to - from)
    const rel = wrapPi(mid - from)
    if (sweep !== 0 && rel * sweep >= 0 && Math.abs(rel) <= Math.abs(sweep) + 1e-6) dist = 0
    else dist = Math.min(dist, angDist(from))
  }
  const arc = dist * Math.max(radius, 0.05)
  const reach = Math.max(FINGER_RADIUS * 2, step * Math.max(radius, 0.05) * 1.6)
  return circleWeight(arc, reach)
}

function radiusNear(radius: number[], height: number[], yHit: number): number {
  if (radius.length === 0) return 0.7
  const index = nearestIndex(height, yHit)
  return Math.max(0.05, radius[index] ?? 0.7)
}

/** 球心在杯壁中线的哪一侧。穿到另一侧时，推和离开对调。 */
export function touchFromOutside(wall: WallState, ang: number, t: number, radial: number): boolean {
  const i = nearestIndex(wall.y, t)
  const count = wall.sectorR.length
  let outer = wall.r[i] ?? 0.7
  if (count > 0) {
    const step = (Math.PI * 2) / count
    let a = ang % (Math.PI * 2)
    if (a < 0) a += Math.PI * 2
    const sector = Math.min(count - 1, Math.floor(a / step))
    outer = wall.sectorR[sector]?.[i] ?? outer
  }
  const thick = wallShell(wall).thickness[i] ?? cup.wall
  return radial >= outer - thick * 0.5
}

/**
 * 这一帧小球的半径变化、高度变化，换成杯壁上的一推。
 * 挤进壁的半径才算数；往上提以高度为主时，轻微的半径外移不会把上提整段丢掉。
 * 明显离开杯壁时，泥不追。
 */
export function contactPush(fromOutside: boolean, dRadial: number, dHeight: number): { dr: number; dy: number } {
  const into = fromOutside ? -dRadial : dRadial
  const retreat = into < -0.0015 && Math.abs(dRadial) > Math.abs(dHeight) * 0.65
  if (retreat) return { dr: 0, dy: 0 }
  const dr = into > 0 ? (fromOutside ? -into : into) : 0
  return { dr, dy: dHeight }
}

/** 按圆球的角度分量，把这一下分到附近几瓣上。 */
export function shapeFinger(wall: WallState, from: number | null, to: number, yHit: number, dr: number, dy: number, mode: ShapeMode): void {
  const count = wall.sectorR.length
  if (count === 0) {
    shapeWall(wall, yHit, dr, dy, mode)
    return
  }
  if (dr === 0 && dy === 0) return
  const gauge = radiusNear(wall.r, wall.y, yHit)
  for (let s = 0; s < count; s++) {
    const w = fingerWeight(from, to, s, count, gauge)
    if (w <= 0.03) continue
    shapeSector(wall, s, yHit, dr * w, dy * w, mode)
  }
}

/** 长按：转到圆球里、并且鼓出球面的泥，按圆球的弧收回去。 */
export function pressFinger(
  wall: WallState,
  from: number | null,
  to: number,
  yHit: number,
  targetR: number,
  fromOutside: boolean,
  mode: ShapeMode,
  maxStep: number,
): void {
  const count = wall.sectorR.length
  if (count === 0 || maxStep <= 0) return
  const gauge = radiusNear(wall.r, wall.y, yHit)
  for (let s = 0; s < count; s++) {
    const w = fingerWeight(from, to, s, count, gauge)
    if (w <= 0.03) continue
    pressProtrusion(wall, s, yHit, targetR, fromOutside, mode, maxStep * w)
  }
}

function integrateWall(wall: WallState, dt: number, rpm: number, hold: number): { collapsed: boolean; load: number } {
  const n = wall.r.length
  const shell = wallShell(wall)
  const refL = cup.height / Math.max(1, n - 1)
  const refVol = annulusVolume(cup.initialRadius, refL, cup.wall)
  const mass = wall.vol.map((volume) => (volume / refVol) * cup.initialRadius)
  const fr = new Array<number>(n).fill(0)
  const fy = new Array<number>(n).fill(0)
  const spin = (rpm / 600) ** 2
  let load = 0
  let collapsed = false
  for (let i = 1; i < n; i++) fy[i] -= mass[i] * WALL_G
  for (let i = 1; i < n; i++) fr[i] += mass[i] * WALL_CENT * spin * Math.max(0.05, wall.r[i])
  // 水平方向是黏性引力，把两点的半径差拉回成形时的差值。竖直方向只有斥力：下面的点把上面的点往上顶，上面的点把下面的点往下压。
  for (let i = 1; i < n; i++) {
    const lower = i - 1
    const thick = Math.max(shell.thickness[i], shell.thickness[lower])
    const restDr = wall.restR[i] - wall.restR[lower]
    const strain = wall.r[i] - wall.r[lower] - restDr
    const pullMax = Math.max(0.01, WALL_COHESION * hold * thick)
    const pullRaw = WALL_PULL * hold * strain
    load = Math.max(load, Math.abs(pullRaw) / pullMax)
    const pull = clamp(pullRaw, -pullMax, pullMax)
    fr[i] -= pull
    fr[lower] += pull
    const slide = wall.vr[i] - wall.vr[lower]
    const visc = clamp(WALL_VISC * hold * slide, -pullMax, pullMax)
    fr[i] -= visc
    fr[lower] += visc
    if (Math.abs(strain) > 0.11) collapsed = true
    const dy = wall.y[i] - wall.y[lower]
    const overlap = wall.restDy[lower] - dy
    if (overlap > 0) {
      const repMax = Math.max(0.01, WALL_REP_MAX * hold * thick)
      const repRaw = WALL_REP * hold * overlap
      load = Math.max(load, repRaw / repMax)
      const rep = Math.min(repRaw, repMax)
      fy[i] += rep
      fy[lower] -= rep
    }
  }
  const damp = Math.exp(-WALL_DAMP * dt)
  const pinR = wall.r[0]
  for (let i = 1; i < n; i++) {
    wall.vr[i] = (wall.vr[i] + (fr[i] / mass[i]) * dt) * damp
    wall.vy[i] = (wall.vy[i] + (fy[i] / mass[i]) * dt) * damp
    wall.vr[i] = clamp(wall.vr[i], -2.4, 2.4)
    wall.vy[i] = clamp(wall.vy[i], -2.4, 2.4)
    wall.r[i] += wall.vr[i] * dt
    wall.y[i] += wall.vy[i] * dt
    if (wall.y[i] < 0) {
      wall.y[i] = 0
      wall.vy[i] = 0
    }
  }
  wall.r[0] = pinR
  wall.y[0] = 0
  wall.vr[0] = 0
  wall.vy[0] = 0
  for (let i = 1; i < n; i++) {
    if (wall.y[i] < wall.y[i - 1] - 0.012) collapsed = true
    if (wall.r[i] < 0.04 || wall.r[i] > 1.72) collapsed = true
  }
  const top = wall.y[n - 1] ?? 0
  if (top < cup.height * 0.58) collapsed = true
  return { collapsed, load }
}

export function stepWall(wall: WallState, input: { dt: number; rpm: number; P: number; waterNorm: number; poor: boolean; waterZero: boolean }): WallStep {
  const oldR = wall.r.slice()
  const oldY = wall.y.slice()
  const hold = clayHold(input)
  let collapsed = false
  let load = 0
  let left = Math.max(0, input.dt)
  while (left > 1e-6) {
    const dt = Math.min(left, WALL_SUBSTEP)
    const step = integrateWall(wall, dt, input.rpm, hold)
    load = Math.max(load, step.load)
    if (step.collapsed) collapsed = true
    left -= dt
    if (collapsed) break
  }
  const count = wall.sectorR.length
  for (let s = 0; s < count; s++) {
    const colR = wall.sectorR[s]
    const colY = wall.sectorY[s]
    for (let i = 0; i < wall.r.length; i++) {
      colR[i] = (colR[i] ?? 0) + wall.r[i] - (oldR[i] ?? 0)
      colY[i] = (colY[i] ?? 0) + wall.y[i] - (oldY[i] ?? 0)
    }
    colY[0] = 0
  }
  return { collapsed, load, margin: 0.9 - load * 0.95 }
}
