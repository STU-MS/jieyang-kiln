import { describe, expect, it } from 'vitest'
import { collectProblems } from '../assets/check'
import { allCards, allEvents, visibleCards } from './text'
import { EVENT_ACTIONS, catalogEvents } from '../sim/events'

describe('文案与资产', () => {
  it('清单、名称和禁用词都对齐', () => {
    expect(collectProblems()).toEqual([])
  })

  it('事件是闭集，可见知识卡不少于八张', () => {
    expect(allEvents()).toHaveLength(16)
    expect(visibleCards().length).toBeGreaterThanOrEqual(8)
    expect(allCards().some((card) => card.hidden)).toBe(true)
    const actions = new Set(catalogEvents().map((event) => event.action))
    expect([...actions].sort()).toEqual([...EVENT_ACTIONS].sort())
  })
})
