import { describe, expect, it } from 'vitest'
import type { Part, Split } from '../game/types'
import { clampDivider, defaultSplit, isValidSplit, MIN_PART, PARTS, toDividers, toSplit } from './split'

function sum(s: Split): number {
  return PARTS.reduce((t, p) => t + s[p], 0)
}

function allAtLeastMin(s: Split): boolean {
  return PARTS.every((p) => s[p] >= MIN_PART[p] - 1e-9)
}

describe('拆泥：四段和恒为 1', () => {
  it('默认比例和为 1，且每段不小于最小值', () => {
    const s = defaultSplit()
    expect(sum(s)).toBeCloseTo(1, 12)
    expect(allAtLeastMin(s)).toBe(true)
  })

  it('三个分隔块任意拖，比例和始终为 1，每段不小于最小值', () => {
    // 一组「暴力」拖法：每个分隔块依次拖到 -1、0、0.3、0.5、0.7、1、2
    let d: [number, number, number] = toDividers(defaultSplit())
    const stops = [-1, 0, 0.3, 0.5, 0.7, 1, 2]
    for (const i of [0, 1, 2, 1, 0, 2, 1] as const) {
      for (const w of stops) {
        d = clampDivider(d, i, w)
        const s = toSplit(d)
        expect(sum(s)).toBeCloseTo(1, 12)
        expect(allAtLeastMin(s)).toBe(true)
        expect(d[0]).toBeLessThanOrEqual(d[1])
        expect(d[1]).toBeLessThanOrEqual(d[2])
      }
    }
  })
})

describe('拆泥：最小值生效', () => {
  it('头拖到 0 被卡在 5%，其余三段分剩下的', () => {
    const d = clampDivider([0.2, 0.6, 0.75], 0, 0)
    const s = toSplit(d)
    expect(s.head).toBeCloseTo(0.05, 12)
    expect(s.body).toBeCloseTo(0.55, 12)
    expect(sum(s)).toBeCloseTo(1, 12)
  })

  it('头拖到极限 = 1 −（身 + 臂 + 腿最小值）= 70%，其余三段全压到最小值', () => {
    let d = clampDivider(toDividers(defaultSplit()), 2, 1)
    d = clampDivider(d, 1, 1)
    d = clampDivider(d, 0, 1)
    const s = toSplit(d)
    for (const p of ['body', 'arms', 'legs'] as const) expect(s[p]).toBeCloseTo(0.1, 12)
    expect(s.head).toBeCloseTo(0.7, 12)
    expect(isValidSplit(s)).toBe(true)
  })

  it('分隔块 2 往右拖到极限：腿压到 10%，多出来的全给臂，头 / 身不动', () => {
    const s = toSplit(clampDivider(toDividers(defaultSplit()), 2, 1))
    expect(s.legs).toBeCloseTo(0.1, 12)
    expect(s.head).toBeCloseTo(0.2, 12)
    expect(s.body).toBeCloseTo(0.4, 12)
    expect(s.arms).toBeCloseTo(0.3, 12)
  })

  it('分隔块不互穿：前一个推不过后一个', () => {
    const d0 = toDividers(defaultSplit())
    const d = clampDivider(d0, 0, 0.99)
    expect(d[0]).toBeLessThanOrEqual(d[1] - 0.1 + 1e-12)
  })
})

describe('拆泥：比例 ↔ 分隔块往返', () => {
  it('toDividers 再 toSplit 回到原值', () => {
    const s: Split = { head: 0.3, body: 0.3, arms: 0.15, legs: 0.25 }
    const back = toSplit(toDividers(s))
    for (const p of PARTS) expect(back[p]).toBeCloseTo(s[p], 12)
  })
})

describe('拆泥：读档校验', () => {
  it('合法比例通过', () => {
    expect(isValidSplit({ head: 0.25, body: 0.35, arms: 0.15, legs: 0.25 })).toBe(true)
  })

  it('低于最小值 / 和不为 1 / 缺部位 / NaN 都不通过', () => {
    expect(isValidSplit({ head: 0.04, body: 0.41, arms: 0.15, legs: 0.4 })).toBe(false)
    expect(isValidSplit({ head: 0.5, body: 0.5, arms: 0.1, legs: 0.1 })).toBe(false)
    expect(isValidSplit({ head: 0.2, body: 0.4, arms: 0.4 })).toBe(false)
    expect(isValidSplit({ head: NaN, body: 0.4, arms: 0.15, legs: 0.25 })).toBe(false)
    expect(isValidSplit(null)).toBe(false)
  })
})

describe('部位枚举', () => {
  it('顺序固定：头 / 身 / 臂 / 腿（设计文档 §2.1）', () => {
    expect(PARTS).toEqual(['head', 'body', 'arms', 'legs'])
    const parts: Part[] = ['head', 'body', 'arms', 'legs']
    expect(parts.every((p) => (PARTS as readonly string[]).includes(p))).toBe(true)
  })
})
