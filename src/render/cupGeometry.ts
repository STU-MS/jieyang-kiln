import { BufferGeometry, Float32BufferAttribute, LatheGeometry, Vector2 } from 'three'
import cup from '../data/cup.json'

export function createCupGeometry(radii: number[], thickness: number[], heights?: number[]): LatheGeometry {
  const points: Vector2[] = []
  const n = Math.max(2, radii.length)
  const lip = cup.lip
  const yAt = (i: number) => {
    if (heights && heights.length === n) return heights[Math.min(i, n - 1)] ?? 0
    return i / (n - 1)
  }
  points.push(new Vector2(0.02, yAt(0)))
  for (let i = 0; i < n; i++) points.push(new Vector2(Math.max(0.04, radii[i] ?? 0.4), yAt(i)))
  const mouth = Math.max(0.05, (radii[n - 1] ?? 0.4) - lip)
  points.push(new Vector2(mouth, yAt(n - 1)))
  for (let i = n - 2; i >= 2; i--) {
    const wall = thickness[i] ?? cup.wall
    const inner = Math.max(0.004, (radii[i] ?? 0.4) - wall)
    points.push(new Vector2(inner, yAt(i)))
  }
  points.push(new Vector2(0.03, Math.max(0.04, yAt(2))))
  const geometry = new LatheGeometry(points, cup.segments)
  geometry.computeVertexNormals()
  return geometry
}

/** 拉坯用的分瓣杯壁。每一瓣有自己的母线，转到手指下才改那一瓣。 */
export function createWheelGeometry(outer: number[][], thickness: number[][], heights: number[][]): BufferGeometry {
  const count = outer.length
  const n = Math.max(2, outer[0]?.length ?? 0)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const meridians = count + 1
  const push = (radius: number, y: number, phi: number, u: number, v: number) => {
    positions.push(Math.sin(phi) * radius, y, Math.cos(phi) * radius)
    uvs.push(u, v)
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a <= count; a++) {
      const src = a % count
      const phi = (a / count) * Math.PI * 2
      const u = a / count
      for (let i = 0; i < n; i++) {
        const rawY = heights[src]?.[i] ?? i / (n - 1)
        const y = pass === 0 && i === 0 ? Math.max(rawY, 0.008) : rawY
        const radius = Math.max(0.04, outer[src]?.[i] ?? 0.4)
        const thick = thickness[src]?.[i] ?? cup.wall
        const r = pass === 0 ? radius : Math.max(0.004, radius - thick)
        push(r, y, phi, u, y)
      }
    }
  }
  const floorRing = Math.min(2, n - 1)
  let floorSum = 0
  for (let s = 0; s < count; s++) floorSum += heights[s]?.[floorRing] ?? 0.05
  const floorY = Math.max(0.05, floorSum / Math.max(1, count))
  const center = positions.length / 3
  positions.push(0, floorY, 0)
  uvs.push(0.5, floorY)
  const oi = (a: number, i: number) => a * n + i
  const ii = (a: number, i: number) => meridians * n + a * n + i
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, d, c, d, b)
  }
  for (let a = 0; a < count; a++) {
    for (let i = 0; i < n - 1; i++) {
      quad(oi(a, i), oi(a + 1, i), oi(a + 1, i + 1), oi(a, i + 1))
    }
  }
  for (let a = 0; a < count; a++) {
    for (let i = floorRing; i < n - 1; i++) {
      const a0 = ii(a, i)
      const a1 = ii(a + 1, i)
      const b0 = ii(a, i + 1)
      const b1 = ii(a + 1, i + 1)
      indices.push(a0, b0, a1, b1, a1, b0)
    }
    const top = n - 1
    quad(oi(a, top), oi(a + 1, top), ii(a + 1, top), ii(a, top))
    const o0 = oi(a, 0)
    const o1 = oi(a + 1, 0)
    const f0 = ii(a, floorRing)
    const f1 = ii(a + 1, floorRing)
    indices.push(o0, f0, o1, f1, o1, f0)
    indices.push(center, f0, f1)
  }
  const geometry = new BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}
