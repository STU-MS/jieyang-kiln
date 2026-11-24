import { describe, expect, it } from 'vitest'
import { newSession } from '../game/types'
import { defaultSplit } from '../sim/split'
import { loadSession, writeSession, type StorageLike } from './storage'

function memoryStorage(initial?: Record<string, string>): StorageLike & { dump: Record<string, string> } {
  const dump: Record<string, string> = { ...(initial ?? {}) }
  return {
    dump,
    getItem: (k) => (k in dump ? dump[k] : null),
    setItem: (k, v) => {
      dump[k] = v
    },
  }
}

const throwingRead: StorageLike = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
const throwingWrite: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota') } }

describe('存档：每阶段保存 → 重载 → 数据逐字相同', () => {
  it('写入再读出，四段比例、确认标记、id 全部相同', () => {
    const store = memoryStorage()
    const s = newSession('run-1', { head: 0.4, body: 0.3, arms: 0.1, legs: 0.2 })
    expect(writeSession(s, store)).toBe(true)
    const back = loadSession(store)
    expect(back.session).toEqual(s)
    expect(back.discarded).toBe(false)
    expect(back.memoryOnly).toBe(false)
  })

  it('确认拆泥后再写一次，重载保留 confirmed=true', () => {
    const store = memoryStorage()
    const s = { ...newSession('run-2', defaultSplit()), s1_confirmed: true }
    writeSession(s, store)
    expect(loadSession(store).session?.s1_confirmed).toBe(true)
  })
})

describe('存档：空态', () => {
  it('没有存档 → session=null，不是错误', () => {
    const back = loadSession(memoryStorage())
    expect(back).toEqual({ session: null, discarded: false, memoryOnly: false })
  })
})

describe('存档：失败态', () => {
  it('旧 schemaVersion=1（v1.x 做杯子）的存档当没有存档，不崩溃', () => {
    const KEY = 'jieyang.taosu.save'
    const store = memoryStorage({ [KEY]: JSON.stringify({ schemaVersion: 1, profile: { cups: [] }, run: null }) })
    const back = loadSession(store)
    expect(back.session).toBeNull()
    expect(back.discarded).toBe(true)
  })

  it('JSON 坏了 / 结构不对 → 当没有存档', () => {
    const KEY = 'jieyang.taosu.save'
    const bad = memoryStorage({ [KEY]: '{not json' })
    expect(loadSession(bad).discarded).toBe(true)
    const wrongShape = memoryStorage({ [KEY]: JSON.stringify({ schemaVersion: 2, id: 'x', s1_confirmed: false, s1_split: { head: 'a' } }) })
    expect(loadSession(wrongShape).session).toBeNull()
  })

  it('s1_split 和不为 1 的存档拒收', () => {
    const KEY = 'jieyang.taosu.save'
    const store = memoryStorage({ [KEY]: JSON.stringify({ schemaVersion: 2, id: 'x', s1_confirmed: false, s1_split: { head: 0.5, body: 0.5, arms: 0.1, legs: 0.1 } }) })
    expect(loadSession(store).session).toBeNull()
  })

  it('localStorage 读抛错 → 内存态，不中断', () => {
    const back = loadSession(throwingRead)
    expect(back).toEqual({ session: null, discarded: false, memoryOnly: true })
  })

  it('localStorage 写抛错（隐私模式 / 配额满）→ 返回 false，不抛', () => {
    expect(writeSession(newSession('r', defaultSplit()), throwingWrite)).toBe(false)
  })
})
