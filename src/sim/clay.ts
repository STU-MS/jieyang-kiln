import clayData from '../data/clay.json'
import { clamp } from './math'
import type { ClayParts, ClayState, Quality } from './types'

const priceOf: Record<string, number> = {}
for (const clay of clayData.clays) priceOf[clay.id] = clay.price

export function mixClay(parts: ClayParts, water: number, humidityPercent: number, knead: number): ClayState {
  const sum = parts.diger + parts.kaolin + parts.aged
  const d = sum > 0 ? parts.diger / sum : 0
  const k = sum > 0 ? parts.kaolin / sum : 0
  const a = sum > 0 ? parts.aged / sum : 0
  const w = clamp(water, 0, clayData.waterMax) / clayData.waterMax
  const h = humidityPercent / 100
  const fP = clayData.formula.P
  const fH = clayData.formula.H
  const fI = clayData.formula.I
  let P = fP.kaolin * k + fP.aged * a + fP.water * w + fP.bias
  const H = fH.diger * d + fH.water * w + fH.humidity * h
  const I = fI.diger * d + fI.water * w
  const C = parts.diger * priceOf.diger + parts.kaolin * priceOf.kaolin + parts.aged * priceOf.aged
  P += (clamp(knead, 0, 1) - 0.5) * clayData.kneadBonus
  const waterZero = water <= 0
  let quality = judgeQuality(P, H)
  if (waterZero) quality = 'poor'
  return {
    parts: { diger: parts.diger, kaolin: parts.kaolin, aged: parts.aged },
    water,
    P,
    H,
    I,
    C,
    quality,
    knead,
    waterZero,
  }
}

export function judgeQuality(P: number, H: number): Quality {
  const [p0, p1] = clayData.sweet.P
  const [h0, h1] = clayData.sweet.H
  const pOk = P >= p0 && P <= p1
  const hOk = H >= h0 && H <= h1
  if (pOk && hOk) return 'excellent'
  if (pOk || hOk) return 'good'
  return 'poor'
}

export function waterNormOf(water: number): number {
  return clamp(water, 0, clayData.waterMax) / clayData.waterMax
}
