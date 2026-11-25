import { describe, expect, it } from 'vitest'
import { newSession } from '../game/types'
import { defaultSplit } from './split'
import { OUTFITS, OUTFIT_NONE, isValidOutfitId, outfitById, wearOutfit, wornOutfit } from './outfit'

const session = () => newSession('run-1', defaultSplit())

describe('衣服：数据表自洽', () => {
  it('MVP 恰好三件，id 从 1 连续编号', () => {
    expect(OUTFITS).toHaveLength(3)
    expect(OUTFITS.map((o) => o.id)).toEqual([1, 2, 3])
  })

  it('每件都有文案 key 和来源', () => {
    for (const o of OUTFITS) {
      expect(o.key).not.toBe('')
      expect(o.source).not.toBe('')
    }
  })

  it('没穿（0）永远合法，且查不到定义', () => {
    expect(isValidOutfitId(0)).toBe(true)
    expect(outfitById(0)).toBeNull()
  })
})

describe('衣服：穿上 / 脱 / 覆盖', () => {
  it('新局没穿衣服', () => {
    expect(wornOutfit(session())).toBe(OUTFIT_NONE)
  })

  it('穿一件 → 记这件', () => {
    const s = wearOutfit(session(), 1)
    expect(wornOutfit(s)).toBe(1)
    expect(s.s4_outfit).toEqual({ id: 1 })
  })

  it('换穿另一件 = 覆盖，不是叠穿（状态里只有最后一件）', () => {
    const s = wearOutfit(wearOutfit(session(), 1), 3)
    expect(wornOutfit(s)).toBe(3)
    expect(s.s4_outfit).toEqual({ id: 3 })
  })

  it('重复点同一件是幂等的，状态不变', () => {
    const once = wearOutfit(session(), 2)
    const twice = wearOutfit(once, 2)
    expect(wornOutfit(twice)).toBe(2)
    expect(twice).toEqual(once)
  })

  it('传 0 = 脱掉，字段移除（不落 0 进存档）', () => {
    const s = wearOutfit(wearOutfit(session(), 1), OUTFIT_NONE)
    expect(s.s4_outfit).toBeUndefined()
    expect(wornOutfit(s)).toBe(OUTFIT_NONE)
  })

  it('纯函数：入参对象不被改动', () => {
    const s = session()
    wearOutfit(s, 3)
    expect(s.s4_outfit).toBeUndefined()
  })

  it('未注册的衣服 id 抛错，不写进状态', () => {
    expect(() => wearOutfit(session(), 4)).toThrow('未注册的衣服：4')
    expect(() => wearOutfit(session(), -1)).toThrow()
    const s = session()
    try {
      wearOutfit(s, 99)
    } catch {
      // 抛错路径
    }
    expect(s.s4_outfit).toBeUndefined()
  })
})
