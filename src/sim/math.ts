export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}
