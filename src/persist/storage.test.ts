import { describe, expect, it } from 'vitest'
import { newSession, type GameSession } from '../game/types'
import { defaultSplit } from '../sim/split'
import { SHAPE_CENTER, SHAPE_PARTS, shapeSliders } from '../sim/shape'
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

  it('结构完全合法但版本是 1 的存档也拒收（版本闸门本身生效）', () => {
    const KEY = 'jieyang.taosu.save'
    const v1 = {
      schemaVersion: 1,
      id: 'old-run',
      s1_confirmed: true,
      s1_split: { head: 0.3, body: 0.3, arms: 0.15, legs: 0.25 },
    }
    const back = loadSession(memoryStorage({ [KEY]: JSON.stringify(v1) }))
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

describe('存档：② 捏（s2_shape）兼容与夹取', () => {
  const KEY = 'jieyang.taosu.save'
  const SPLIT = { head: 0.3, body: 0.3, arms: 0.15, legs: 0.25 }
  /** 上一个版本写下的存档：只有 s1 的内容，没有 s2_shape。 */
  const legacyV2 = () => JSON.stringify({ schemaVersion: 2, id: 'old-run', s1_confirmed: true, s1_split: SPLIT })

  function expectAllNeutral(shape: GameSession['s2_shape']) {
    for (const part of SHAPE_PARTS) {
      const ids = shapeSliders(part).map((s) => s.id)
      expect(Object.keys(shape[part]).sort()).toEqual([...ids].sort())
      for (const id of ids) expect(shape[part][id]).toBe(SHAPE_CENTER)
      expect(shape.animated[part]).toBe(false)
    }
  }

  function loadRaw(raw: unknown) {
    return loadSession(memoryStorage({ [KEY]: JSON.stringify(raw) }))
  }

  function withShape(s2_shape: unknown) {
    return { schemaVersion: 2, id: 'run-shape', s1_confirmed: false, s1_split: SPLIT, s2_shape }
  }

  it('旧存档没有 s2_shape：补默认值（滑杆中性、动画未播），不判坏档', () => {
    const back = loadSession(memoryStorage({ [KEY]: legacyV2() }))
    expect(back.discarded).toBe(false)
    expect(back.session?.id).toBe('old-run')
    expect(back.session?.s1_confirmed).toBe(true)
    expectAllNeutral(back.session!.s2_shape)
  })

  it('越界的滑杆值夹到 [0,1]，不判坏档', () => {
    const part = 'legs'
    const [a, b] = shapeSliders(part)
    const raw = withShape({ [part]: { [a.id]: 1.8, [b.id]: -0.2 } })
    const back = loadRaw(raw)
    expect(back.discarded).toBe(false)
    expect(back.session?.s2_shape[part][a.id]).toBe(1)
    expect(back.session?.s2_shape[part][b.id]).toBe(0)
    // 其他部位没给 → 默认值
    expect(back.session?.s2_shape.head[shapeSliders('head')[0].id]).toBe(SHAPE_CENTER)
  })

  it('滑杆值是字符串 / 缺 id → 该滑杆退回中性，其他滑杆保留', () => {
    const part = 'arms'
    const [a, b] = shapeSliders(part)
    const raw = withShape({ [part]: { [a.id]: '0.9' } })
    const back = loadRaw(raw)
    expect(back.discarded).toBe(false)
    expect(back.session?.s2_shape[part][a.id]).toBe(SHAPE_CENTER)
    expect(back.session?.s2_shape[part][b.id]).toBe(SHAPE_CENTER)
    expect(back.session?.s2_shape[part]).not.toBeUndefined()
  })

  it('animated 缺失 / 非布尔 → 该部位按未播放；true 保留', () => {
    const shape = withShape({ animated: { head: true, body: 'true', arms: 1 } })
    const back = loadRaw(shape)
    expect(back.discarded).toBe(false)
    expect(back.session?.s2_shape.animated).toEqual({ head: true, body: false, arms: false, legs: false })
  })

  it('s2_shape 整体不是对象（字符串 / 数组 / 数字）→ 全默认，不判坏档', () => {
    for (const bad of ['nope', [1, 2, 3], 42, null]) {
      const back = loadRaw(withShape(bad))
      expect(back.discarded).toBe(false)
      expectAllNeutral(back.session!.s2_shape)
    }
  })

  it('s2_shape 坏不影响 s1 的严格校验：s1_split 不合法仍拒收', () => {
    const back = loadRaw({ schemaVersion: 2, id: 'x', s1_confirmed: false, s1_split: { head: 'a' }, s2_shape: 'nope' })
    expect(back.session).toBeNull()
    expect(back.discarded).toBe(true)
  })

  it('改过滑杆值与 animated 后写入再读出：数据逐字相同', () => {
    const store = memoryStorage()
    const headId = shapeSliders('head')[0].id
    const legsId = shapeSliders('legs')[1].id
    const base = newSession('run-shape', SPLIT)
    const s: GameSession = {
      ...base,
      s2_shape: {
        ...base.s2_shape,
        head: { ...base.s2_shape.head, [headId]: 0.87 },
        legs: { ...base.s2_shape.legs, [legsId]: 0 },
        animated: { head: true, body: true, arms: true, legs: true },
      },
    }
    expect(writeSession(s, store)).toBe(true)
    const back = loadSession(store)
    expect(back.discarded).toBe(false)
    expect(back.session).toEqual(s)
  })
})
