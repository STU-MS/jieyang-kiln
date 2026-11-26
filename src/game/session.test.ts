import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHAPE_CENTER, SHAPE_PARTS, poseUnlocked, shapeSliders } from '../sim/shape'

/**
 * 会话 store 的行为测试。localStorage 用内存替身（外部边界才用替身，testing.md）。
 * 断言的是「玩家可见的行为」：拖分隔块改比例、确认后落盘、重复确认不改数据。
 */

function installStorage(opts: { failWrite?: boolean; initial?: string } = {}) {
  const map = new Map<string, string>()
  if (opts.initial) map.set('jieyang.taosu.save', opts.initial)
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failWrite) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  vi.stubGlobal('localStorage', storage)
  return map
}

async function freshModule() {
  vi.resetModules()
  return import('./session')
}

describe('会话：拆泥阶段', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('首局无存档：默认比例，未确认', async () => {
    installStorage()
    const { store } = await freshModule()
    const s = store.get().session
    expect(s.s1_confirmed).toBe(false)
    expect(s.s1_split).toEqual({ head: 0.2, body: 0.4, arms: 0.15, legs: 0.25 })
    expect(store.get().canSave).toBe(true)
  })

  it('拖分隔块只改内存、不落盘；确认后落盘且重载数据逐字相同', async () => {
    const map = installStorage()
    const a = await freshModule()
    a.store.preview({ head: 0.35, body: 0.25, arms: 0.15, legs: 0.25 })
    expect(a.store.get().session.s1_split.head).toBeCloseTo(0.35, 12)
    expect(map.has('jieyang.taosu.save')).toBe(false)
    a.store.confirm()
    expect(map.has('jieyang.taosu.save')).toBe(true)

    const b = await freshModule()
    const s = b.store.get().session
    expect(s.s1_confirmed).toBe(true)
    expect(s.s1_split.head).toBeCloseTo(0.35, 12)
  })

  it('重复确认幂等：数据不变', async () => {
    installStorage()
    const { store } = await freshModule()
    store.confirm()
    const first = store.get().session
    store.confirm()
    expect(store.get().session).toEqual(first)
  })

  it('重分：取消已拆标记回到可拖状态，比例保留并落盘', async () => {
    const map = installStorage()
    const a = await freshModule()
    a.store.preview({ head: 0.45, body: 0.2, arms: 0.1, legs: 0.25 })
    a.store.confirm()
    expect(a.store.get().session.s1_confirmed).toBe(true)

    a.store.reopen()
    expect(a.store.get().session.s1_confirmed).toBe(false)
    expect(a.store.get().session.s1_split.head).toBeCloseTo(0.45, 12)

    const b = await freshModule()
    expect(b.store.get().session.s1_confirmed).toBe(false)
    expect(b.store.get().session.s1_split.head).toBeCloseTo(0.45, 12)
    expect(map.get('jieyang.taosu.save')).toContain('"s1_confirmed":false')
  })

  it('写档失败（隐私模式 / 配额满）：canSave=false，内存态照常推进不抛', async () => {
    installStorage({ failWrite: true })
    const { store } = await freshModule()
    expect(() => store.confirm()).not.toThrow()
    expect(store.get().canSave).toBe(false)
    expect(store.get().session.s1_confirmed).toBe(true)
  })

  it('v1.x 旧存档：当新局，并标记 discarded 让 UI 说明', async () => {
    installStorage({ initial: JSON.stringify({ schemaVersion: 1, profile: {}, run: null }) })
    const { store } = await freshModule()
    expect(store.get().session.s1_confirmed).toBe(false)
    expect(store.get().discarded).toBe(true)
  })
})

describe('会话：② 捏（形态滑杆 + 出生动画）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  /** 上一版存档：只有 s1 的内容，没有 s2_shape。 */
  function legacySave(): string {
    return JSON.stringify({
      schemaVersion: 2,
      id: 'old-run',
      s1_confirmed: true,
      s1_split: { head: 0.3, body: 0.3, arms: 0.15, legs: 0.25 },
    })
  }

  it('旧存档（无 s2_shape）加载后不算坏档，滑杆全是中性、动画未播', async () => {
    installStorage({ initial: legacySave() })
    const { store } = await freshModule()
    const snap = store.get()
    expect(snap.discarded).toBe(false)
    expect(snap.session.id).toBe('old-run')
    for (const part of SHAPE_PARTS) {
      const ids = shapeSliders(part).map((s) => s.id)
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) expect(snap.session.s2_shape[part][id]).toBe(SHAPE_CENTER)
      expect(snap.session.s2_shape.animated[part]).toBe(false)
    }
  })

  it('拖滑杆只改内存不落盘；flush 后落盘，重载数据逐字相同', async () => {
    const map = installStorage()
    const a = await freshModule()
    a.store.confirm()
    const saveBefore = map.get('jieyang.taosu.save')
    const headId = shapeSliders('head')[0].id
    a.store.setShape('head', headId, 0.83)
    expect(a.store.get().session.s2_shape.head[headId]).toBeCloseTo(0.83, 12)
    // 只改内存：存档内容没动
    expect(map.get('jieyang.taosu.save')).toBe(saveBefore)

    expect(a.store.flush()).toBe(true)
    const b = await freshModule()
    expect(b.store.get().session.s2_shape.head[headId]).toBeCloseTo(0.83, 12)
    expect(b.store.get().session).toEqual(a.store.get().session)
  })

  it('拖出界被夹到 [0,1]', async () => {
    installStorage()
    const { store } = await freshModule()
    const headId = shapeSliders('head')[0].id
    store.setShape('head', headId, 3)
    expect(store.get().session.s2_shape.head[headId]).toBe(1)
    store.setShape('head', headId, -3)
    expect(store.get().session.s2_shape.head[headId]).toBe(0)
  })

  it('出生动画播完即落盘，重复标记幂等', async () => {
    const map = installStorage()
    const a = await freshModule()
    a.store.confirm()
    a.store.markAnimated('head')
    expect(map.has('jieyang.taosu.save')).toBe(true)
    const first = a.store.get().session
    expect(first.s2_shape.animated.head).toBe(true)
    a.store.markAnimated('head')
    expect(a.store.get().session).toEqual(first)

    const b = await freshModule()
    expect(b.store.get().session.s2_shape.animated.head).toBe(true)
  })

  it('标记动画会把内存里未落盘的滑杆值一并写下去', async () => {
    installStorage()
    const a = await freshModule()
    a.store.confirm()
    const bodyId = shapeSliders('body')[0].id
    a.store.setShape('body', bodyId, 0.7)
    a.store.markAnimated('body')
    const b = await freshModule()
    expect(b.store.get().session.s2_shape.body[bodyId]).toBeCloseTo(0.7, 12)
  })

  it('四个部位都播过动画才解锁姿势，缺一个不解锁；重启后仍解锁', async () => {
    installStorage()
    const a = await freshModule()
    expect(poseUnlocked(a.store.get().session)).toBe(false)
    for (const part of ['head', 'body', 'arms'] as const) a.store.markAnimated(part)
    expect(poseUnlocked(a.store.get().session)).toBe(false)
    a.store.markAnimated('legs')
    expect(poseUnlocked(a.store.get().session)).toBe(true)

    const b = await freshModule()
    expect(poseUnlocked(b.store.get().session)).toBe(true)
  })

  it('写档失败时滑杆与动画标记仍推进内存态，不抛错', async () => {
    installStorage({ failWrite: true })
    const { store } = await freshModule()
    const headId = shapeSliders('head')[0].id
    expect(() => {
      store.setShape('head', headId, 0.6)
      store.markAnimated('head')
    }).not.toThrow()
    expect(store.get().session.s2_shape.animated.head).toBe(true)
    expect(store.get().canSave).toBe(false)
  })
})
