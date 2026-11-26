import { describe, expect, it } from 'vitest'
import { newSession, type Part, type ShapeValues } from '../game/types'
import { defaultSplit } from './split'
import {
  SHAPE_CENTER,
  SHAPE_PARTS,
  clampShapeValue,
  defaultShapeValues,
  morphWeights,
  poseUnlocked,
  shapeSliders,
} from './shape'

/** 该部位的滑杆值全部设为中性。 */
function neutral(part: Part): ShapeValues {
  const v: ShapeValues = {}
  for (const slider of shapeSliders(part)) v[slider.id] = SHAPE_CENTER
  return v
}

describe('捏：默认形状 = 权重全 0', () => {
  it('默认滑杆值让四个部位的每个 morph 通道权重都为 0', () => {
    const defaults = defaultShapeValues()
    for (const part of SHAPE_PARTS) {
      const w = morphWeights(part, defaults[part])
      expect(Object.keys(w).length).toBeGreaterThan(0)
      for (const value of Object.values(w)) expect(value).toBe(0)
    }
  })

  it('数据表里新增的滑杆自动拿到中性默认值（代码不写死 id 清单）', () => {
    const defaults = defaultShapeValues()
    for (const part of SHAPE_PARTS) {
      const ids = shapeSliders(part).map((s) => s.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(Object.keys(defaults[part]).sort()).toEqual([...ids].sort())
      for (const id of ids) expect(defaults[part][id]).toBe(SHAPE_CENTER)
    }
  })

  it('一张泥稿上所有通道的权重都落在 0–1', () => {
    for (const part of SHAPE_PARTS) {
      for (const slider of shapeSliders(part)) {
        for (const v of [-3, 0, 0.25, 0.5, 0.75, 1, 4, Number.NaN]) {
          const w = morphWeights(part, { ...neutral(part), [slider.id]: v })
          for (const value of Object.values(w)) {
            expect(Number.isFinite(value)).toBe(true)
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})

describe('捏：滑杆 → morph 权重（中心 0.5，两侧对称）', () => {
  it('0.5 全通道为 0，1 时正向通道为 1、反向为 0，0 时反向为 1、正向为 0', () => {
    for (const part of SHAPE_PARTS) {
      for (const slider of shapeSliders(part)) {
        const atCenter = morphWeights(part, { ...neutral(part), [slider.id]: 0.5 })
        const atMax = morphWeights(part, { ...neutral(part), [slider.id]: 1 })
        const atMin = morphWeights(part, { ...neutral(part), [slider.id]: 0 })
        for (const ch of slider.channels) {
          expect(atCenter[ch.morph]).toBe(0)
          expect(atMax[ch.morph]).toBe(ch.dir > 0 ? 1 : 0)
          expect(atMin[ch.morph]).toBe(ch.dir > 0 ? 0 : 1)
        }
      }
    }
  })

  it('中段线性：0.75 的正向通道 0.5、反向通道 0；0.25 反之', () => {
    for (const part of SHAPE_PARTS) {
      for (const slider of shapeSliders(part)) {
        const up = morphWeights(part, { ...neutral(part), [slider.id]: 0.75 })
        const down = morphWeights(part, { ...neutral(part), [slider.id]: 0.25 })
        for (const ch of slider.channels) {
          expect(up[ch.morph]).toBeCloseTo(ch.dir > 0 ? 0.5 : 0, 12)
          expect(down[ch.morph]).toBeCloseTo(ch.dir > 0 ? 0 : 0.5, 12)
        }
      }
    }
  })

  it('同一部位所有通道都在结果里（含生成式 gen_* 通道）', () => {
    const part: Part = 'head'
    const w = morphWeights(part, neutral(part))
    const expected = shapeSliders(part).flatMap((s) => s.channels.map((c) => c.morph))
    expect(Object.keys(w).sort()).toEqual([...new Set(expected)].sort())
  })
})

describe('捏：滑杆值夹取与降级', () => {
  it('越界夹到 0 / 1，非数字退回默认形状', () => {
    expect(clampShapeValue(-0.4)).toBe(0)
    expect(clampShapeValue(1.7)).toBe(1)
    expect(clampShapeValue(0.42)).toBe(0.42)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0.9', null, undefined]) {
      expect(clampShapeValue(bad)).toBe(SHAPE_CENTER)
    }
  })

  it('缺的滑杆 id 按默认形状处理（权重 0），不产生 NaN', () => {
    for (const part of SHAPE_PARTS) {
      const w = morphWeights(part, {})
      for (const value of Object.values(w)) expect(value).toBe(0)
    }
  })

  it('越界的滑杆值按夹取后的值算权重', () => {
    const part: Part = 'body'
    const slider = shapeSliders(part)[0]
    const over = morphWeights(part, { ...neutral(part), [slider.id]: 9 })
    const atOne = morphWeights(part, { ...neutral(part), [slider.id]: 1 })
    expect(over).toEqual(atOne)
  })
})

describe('捏：姿势解锁', () => {
  const parts: Part[] = ['head', 'body', 'arms', 'legs']

  function withAnimated(animated: Part[]) {
    const s = newSession('run-shape', defaultSplit())
    return { ...s, s2_shape: { ...s.s2_shape, animated: Object.fromEntries(parts.map((p) => [p, animated.includes(p)])) as Record<Part, boolean> } }
  }

  it('新局四个部位都没播过动画 → 未解锁', () => {
    expect(poseUnlocked(newSession('run-shape', defaultSplit()))).toBe(false)
  })

  it('四个部位都播过动画 → 解锁', () => {
    expect(poseUnlocked(withAnimated(parts))).toBe(true)
  })

  it('缺任何一个部位没播 → 未解锁', () => {
    for (const missing of parts) {
      expect(poseUnlocked(withAnimated(parts.filter((p) => p !== missing)))).toBe(false)
    }
  })
})
