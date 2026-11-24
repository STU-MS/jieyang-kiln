import { useSyncExternalStore } from 'react'
import { newSession, type GameSession } from './types'
import { defaultSplit } from '../sim/split'
import { loadSession, writeSession } from '../persist/storage'

interface Snap {
  session: GameSession
  /** 存档可写；false = 隐私模式 / 配额满，本局只在内存 */
  canSave: boolean
  /** 读档时丢了坏档（v1.x / 结构不对） */
  discarded: boolean
}

function freshId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

let snap: Snap | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** 读一次存档决定起点；之后不再读（测试可 resetSession() 后再调）。 */
function boot(): Snap {
  if (snap) return snap
  const loaded = loadSession()
  snap = {
    session: loaded.session ?? newSession(freshId(), defaultSplit()),
    canSave: !loaded.memoryOnly,
    discarded: loaded.discarded,
  }
  return snap
}

function commit(next: GameSession): void {
  const s = boot()
  const ok = writeSession(next)
  snap = { ...s, session: next, canSave: ok }
  emit()
}

export const store = {
  get: (): Snap => boot(),
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  /** 拖分隔块：只改内存里的 s1_split，不落盘（拖一下写一次太密；确认 / 隐藏时落盘） */
  preview(split: GameSession['s1_split']): void {
    snap = { ...boot(), session: { ...boot().session, s1_split: split } }
    emit()
  },
  /** 确认拆泥：标记 confirmed 并落盘（幂等：重复确认不改变数据） */
  confirm(): void {
    const s = boot()
    if (s.session.s1_confirmed) return
    commit({ ...s.session, s1_confirmed: true })
  },
  /** 重分：取消「已拆」标记，回到可拖状态，比例保持不变。落盘（幂等） */
  reopen(): void {
    const s = boot()
    if (!s.session.s1_confirmed) return
    commit({ ...s.session, s1_confirmed: false })
  },
  /** 落盘当前内存态（页面隐藏时调用） */
  flush(): boolean {
    const s = boot()
    const ok = writeSession(s.session)
    if (ok !== s.canSave) {
      snap = { ...s, canSave: ok }
      emit()
    }
    return ok
  },
}

export function useSession(): Snap {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** 测试 / 重开用：清内存，下次 get 重新读档。 */
export function resetSession(): void {
  snap = null
}
