import { describe, expect, it } from 'vitest'
import { newSession } from '../game/types'
import { defaultSplit } from './split'
import { TRANSITION_MS, dryColorAt, isDried, markDried } from './dry'

const session = () => newSession('run-1', defaultSplit())

function brightness(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + (((n >> 8) & 255) * 0.587) + ((n & 255) * 0.114)
}

describe('阴干：数据表自洽', () => {
  it('过场时长 2 秒（设计文档 §2.5）', () => {
    expect(TRANSITION_MS).toBe(2000)
  })

  it('干坯比湿泥浅（亮度更高）、更哑光（粗糙度更高）', () => {
    expect(brightness(dryColorAt(1).color)).toBeGreaterThan(brightness(dryColorAt(0).color))
    expect(dryColorAt(1).roughness).toBeGreaterThan(dryColorAt(0).roughness)
  })
})

describe('阴干：颜色插值', () => {
  it('t=0 是湿泥色，t=1 是干坯色（端点 = 数据表原值）', () => {
    expect(dryColorAt(0).color.toUpperCase()).toBe('#7A5232')
    expect(dryColorAt(1).color.toUpperCase()).toBe('#B08A5C')
    expect(dryColorAt(0).roughness).toBeCloseTo(0.35)
    expect(dryColorAt(1).roughness).toBeCloseTo(0.85)
  })

  it('中间点是两端之间，且亮度随 t 单调不减', () => {
    const mid = dryColorAt(0.5)
    expect(brightness(mid.color)).toBeGreaterThan(brightness(dryColorAt(0).color))
    expect(brightness(mid.color)).toBeLessThan(brightness(dryColorAt(1).color))
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const b = brightness(dryColorAt(t).color)
      expect(b).toBeGreaterThanOrEqual(prev)
      prev = b
    }
  })

  it('t 越界夹取到 [0,1]，不抛错也不出界外色', () => {
    expect(dryColorAt(-2).color).toBe(dryColorAt(0).color)
    expect(dryColorAt(3).color).toBe(dryColorAt(1).color)
  })
})

describe('阴干：单向门', () => {
  it('新局没阴干', () => {
    expect(isDried(session())).toBe(false)
  })

  it('阴干一次 → dried=true', () => {
    expect(isDried(markDried(session()))).toBe(true)
  })

  it('重复阴干是无操作，状态不变', () => {
    const once = markDried(session())
    expect(markDried(once)).toBe(once)
  })

  it('不变量：阴干只加 s5_dried，其余字段原样带过（设计文档：纯视觉过场不改任何数据）', () => {
    const s = { ...session(), s1_confirmed: true, s4_outfit: { id: 2 } }
    const { s5_dried, ...rest } = markDried(s)
    expect(s5_dried).toBe(true)
    // 逐字段比对整局：不列字段名清单，后面加阶段（s2_shape、s6_glaze…）时这条仍守得住
    expect(rest).toEqual(s)
  })

  it('纯函数：入参对象不被改动', () => {
    const s = session()
    markDried(s)
    expect(s.s5_dried).toBeUndefined()
  })
})
