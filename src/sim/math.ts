export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function n2(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2)
}

export function n0(v: number): string {
  return String(Math.round(v))
}
