import cup from '../data/cup.json'
import glazeData from '../data/glaze.json'
import { clamp } from './math'
import type { GlazePick, GlazeStamp, GlazeState, Quality } from './types'

export function glazeStock(cards: number, quality: Quality): number {
  const bonus = Math.min(glazeData.stockCardCap, Math.max(0, cards)) * glazeData.stockPerCard
  const extra = quality === 'excellent' ? glazeData.stockExcellent : 0
  return glazeData.stockBase + bonus + extra
}

export function glazeCost(picks: GlazePick[], stamps: GlazeStamp[]): number {
  return picks.reduce((s, p) => s + p.layers * glazeData.layerCost, 0) + stamps.length * glazeData.brushCost
}

function evenness(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  if (mean < 0.05) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return clamp(1 - Math.sqrt(variance) / mean, 0, 1)
}

export function buildGlaze(picks: GlazePick[], stamps: GlazeStamp[], stockStart: number): GlazeState {
  const n = cup.rings
  const mask = Array.from({ length: n }, () => 0)
  const totalLayers = picks.reduce((s, p) => s + p.layers, 0)
  const coat = picks.reduce((s, p) => s + p.layers * p.concentration * 0.28, 0)
  const footRisk = totalLayers > glazeData.footLayerLimit
  const rimStart = Math.floor(n * 0.92)
  const footEnd = Math.floor(n * 0.08)
  for (let i = footEnd; i < rimStart; i++) mask[i] = clamp(coat, 0, 1)
  if (footRisk) {
    for (let i = 0; i < footEnd; i++) mask[i] = clamp(coat * 0.85, 0, 1)
  }
  let rimCovered = false
  for (const stamp of stamps) {
    const i0 = clamp(Math.round(stamp.ring), 0, n - 1)
    for (let k = -2; k <= 2; k++) {
      const i = i0 + k
      if (i < 0 || i >= n) continue
      mask[i] = clamp(mask[i] + stamp.amount * (1 - Math.abs(k) / 3), 0, 1)
    }
    if (i0 >= rimStart) rimCovered = true
  }
  const uniformity = evenness(mask.slice(footEnd, rimStart))
  return {
    picks: picks.map((p) => ({ ...p })),
    stamps: stamps.map((s) => ({ ...s })),
    mask,
    uniformity,
    totalLayers,
    footRisk,
    warned: uniformity < glazeData.uniformWarn,
    rimCovered,
    stockLeft: stockStart - glazeCost(picks, stamps),
  }
}

export function glazeById(id: string) {
  return glazeData.glazes.find((g) => g.id === id)
}
