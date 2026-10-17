export interface Tick {
  dt: number
  resumed: boolean
}

export interface Clock {
  delta: () => Tick
  sync: () => void
}

/**
 * 可见时用 performance.now 的差值推进。
 * 切到后台再回来时丢掉这段间隔，不追帧。
 * 单帧最多记 0.1 秒，避免断点把泥一下子判塌。
 */
export function createClock(opts?: { now?: () => number; hidden?: () => boolean }): Clock {
  const now = opts?.now ?? (() => performance.now())
  const hidden = opts?.hidden ?? (() => (typeof document !== 'undefined' ? document.hidden : false))
  let last = now()
  let wasHidden = hidden()
  let resumeLatch = false
  return {
    sync() {
      const h = hidden()
      if (wasHidden && !h) resumeLatch = true
      wasHidden = h
      last = now()
    },
    delta() {
      const t = now()
      const h = hidden()
      if (h) {
        wasHidden = true
        last = t
        return { dt: 0, resumed: false }
      }
      if (wasHidden || resumeLatch) {
        wasHidden = false
        resumeLatch = false
        last = t
        return { dt: 0, resumed: true }
      }
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000))
      last = t
      return { dt, resumed: false }
    },
  }
}

export function registerFrame(
  streak: number,
  frameMs: number,
  quality: 'high' | 'low',
  budget: number,
  limit: number,
): { streak: number; quality: 'high' | 'low' } {
  if (quality === 'low') return { streak: 0, quality }
  if (frameMs > budget) {
    const next = streak + 1
    if (next >= limit) return { streak: 0, quality: 'low' }
    return { streak: next, quality }
  }
  return { streak: 0, quality }
}
