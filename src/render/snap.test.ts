import { describe, expect, it } from 'vitest'
import { snapCorner } from './scene'

describe('尖缘吸附', () => {
  const n = 64
  const y = Array.from({ length: n }, (_, i) => i / (n - 1))
  const r = Array.from({ length: n }, () => 0.7)
  r[40] = 0.95

  it('斜面上靠近陡尖时吸到尖端，而不是停在半坡', () => {
    const y0 = y[39]
    const y1 = y[40]
    const at = 0.4
    const hit = snapCorner(0.7 + (0.95 - 0.7) * at, y0 + (y1 - y0) * at, r, y)
    expect(hit).toEqual({ r: 0.95, y: y[40] })
    const low = snapCorner(0.7 + (0.95 - 0.7) * 0.05, y0 + (y1 - y0) * 0.05, r, y)
    expect(low?.r).not.toBe(0.95)
  })

  it('离尖端远的直壁不吸过去', () => {
    expect(snapCorner(0.7, y[20], r, y)).toBeNull()
  })

  it('口沿附近吸到口沿', () => {
    const hit = snapCorner(0.7, y[n - 2] + (y[n - 1] - y[n - 2]) * 0.4, r, y)
    expect(hit).toEqual({ r: 0.7, y: y[n - 1] })
  })
})
