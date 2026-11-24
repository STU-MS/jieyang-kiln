import { beforeEach, describe, expect, it, vi } from 'vitest'

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
