import drying from '../data/drying.json'
import { clamp, lerp } from './math'

const RISES: [number, number][] = [
  [40, 280],
  [320, 580],
  [640, 880],
]

export function bisqueDuration(wetExtra: number): number {
  return drying.segmentSeconds * 3 * (1 + Math.max(0, wetExtra))
}

export function bisqueTarget(
  elapsed: number,
  total: number,
  width: number,
): { center: number; min: number; max: number; segment: number } {
  const segLen = Math.max(0.001, total / 3)
  const segment = clamp(Math.floor(elapsed / segLen), 0, 2)
  const u = clamp((elapsed - segment * segLen) / segLen, 0, 1)
  const [a, b] = RISES[segment]
  const center = lerp(a, b, u)
  return { center, min: center - width / 2, max: center + width / 2, segment }
}
