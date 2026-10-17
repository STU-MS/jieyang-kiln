import clayData from '../data/clay.json'
import { colorOf } from '../assets/registry'
import type { ClayParts } from '../sim/types'

export function clayBodyColor(parts: ClayParts): string {
  return mixHex(
    clayData.clays.map((clay) => ({
      color: colorOf(clay.card),
      weight: parts[clay.id as keyof ClayParts] || 0.001,
    })),
  )
}

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  return [parseInt(raw.slice(0, 2), 16) || 0, parseInt(raw.slice(2, 4), 16) || 0, parseInt(raw.slice(4, 6), 16) || 0]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const byte = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

export function mixHex(stops: { color: string; weight: number }[]): string {
  const total = stops.reduce((sum, stop) => sum + Math.max(0, stop.weight), 0) || 1
  let r = 0
  let g = 0
  let b = 0
  for (const stop of stops) {
    const [cr, cg, cb] = hexToRgb(stop.color)
    const w = Math.max(0, stop.weight) / total
    r += cr * w
    g += cg * w
    b += cb * w
  }
  return rgbToHex(r, g, b)
}
