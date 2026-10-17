export interface TextureParams {
  seed: number
  iron: number
  colors: [number, number, number][]
  hueShift: number
  pattern: string
  density: number
  gloss: number
  flow: number
  flawVisuals: string[]
}

function hash01(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v))
}

function rotate(r: number, g: number, b: number, deg: number): [number, number, number] {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [clamp255(r * cos - g * sin), clamp255(r * sin * 0.2 + g * cos + b * 0.05), clamp255(b * cos - r * sin * 0.15 + g * 0.1)]
}

export function generateTexture(
  params: TextureParams,
  size: number,
): { albedo: Uint8ClampedArray; roughness: Uint8ClampedArray; size: number } {
  const albedo = new Uint8ClampedArray(size * size * 4)
  const roughness = new Uint8ClampedArray(size * size * 4)
  const colors = params.colors.length > 0 ? params.colors : [[140, 90, 70]]
  const roughBase = Math.max(0.12, Math.min(0.95, 1 - params.gloss))
  const crack = params.flawVisuals.includes('crack') || params.flawVisuals.includes('crazing')
  const pin = params.flawVisuals.includes('pinhole')
  const stain = params.flawVisuals.includes('stain') || params.flawVisuals.includes('yellow')
  for (let y = 0; y < size; y++) {
    const v = y / size
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const n = hash01(x, y, params.seed)
      const n2 = hash01(x >> 2, y >> 2, params.seed ^ 0x9e3779b9) * 0.55 + hash01(x, y, params.seed ^ 0x85ebca6b) * 0.45
      const ci = Math.min(colors.length - 1, Math.floor(n2 * colors.length))
      let [r, g, b] = colors[ci]
      const shifted = rotate(r, g, b, params.hueShift)
      r = shifted[0]
      g = shifted[1]
      b = shifted[2]
      r = clamp255(r + params.iron * 46)
      const streak = Math.sin(y * 0.17 + x * params.flow * 0.03 + n2 * 5)
      if (params.pattern !== 'none' && n > 1 - params.density * 0.7 && streak > 0) {
        r = clamp255(r * 0.62)
        g = clamp255(g * 0.5)
        b = clamp255(b * 0.42)
      }
      if (v > 0.92 || v < 0.04) {
        r = clamp255(r * 0.72 + 40)
        g = clamp255(g * 0.7 + 28)
        b = clamp255(b * 0.66 + 22)
      }
      if (pin && n > 0.975) {
        r *= 0.25
        g *= 0.25
        b *= 0.25
      }
      if (crack && Math.abs((x * 3 + Math.floor(y * 1.4)) % 41) < 1) {
        r *= 0.35
        g *= 0.35
        b *= 0.35
      }
      if (stain && n2 > 0.72 && x % 17 < 4) {
        r = clamp255(r * 0.7 + 30)
        g = clamp255(g * 0.75)
        b = clamp255(b * 0.55)
      }
      albedo[i] = r
      albedo[i + 1] = g
      albedo[i + 2] = b
      albedo[i + 3] = 255
      const rv = Math.max(0, Math.min(1, roughBase + (n2 - 0.5) * 0.18))
      const byte = Math.round(rv * 255)
      roughness[i] = byte
      roughness[i + 1] = byte
      roughness[i + 2] = byte
      roughness[i + 3] = 255
    }
  }
  return { albedo, roughness, size }
}

export function textureHash(albedo: Uint8ClampedArray): string {
  let h = 2166136261
  const step = Math.max(1, Math.floor(albedo.length / 2048))
  for (let i = 0; i < albedo.length; i += step) {
    h ^= albedo[i]
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}
