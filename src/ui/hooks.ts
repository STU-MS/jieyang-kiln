import { useEffect, useRef } from 'react'
import difficulty from '../data/difficulty.json'
import { applyDemo } from '../sim/flow'
import { createClock } from '../sim/clock'
import { session } from '../game/session'

export function useTicker(active: boolean, onFrame: (dt: number) => void): void {
  const frame = useRef(onFrame)
  frame.current = onFrame
  useEffect(() => {
    if (!active) return
    const clock = createClock()
    const sync = () => clock.sync()
    document.addEventListener('visibilitychange', sync)
    let raf = 0
    let alive = true
    const loop = () => {
      if (!alive) return
      const { dt } = clock.delta()
      frame.current(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [active])
}

export function runDemo(onDone: () => void): void {
  const snap = session.get()
  if (!snap.run) return
  const counted = { ...snap.run, retries: Math.max(snap.run.retries + 1, difficulty.maxRetriesBeforeDemo) }
  const novice = snap.profile.clearCount < difficulty.noviceClears
  const next = applyDemo(counted, novice, counted.practice)
  session.setRun(next)
  if (next.result && !next.result.stuck && !next.result.shattered) onDone()
}

export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes <= 0) return `${rest} 秒`
  return `${minutes} 分 ${rest} 秒`
}
