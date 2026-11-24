import { useEffect, useRef, useState } from 'react'
import { f, t } from '../content/text'
import { store, useSession } from '../game/session'
import { createClayRig, SPLIT_SECONDS, type ClayRig } from '../render/clay'
import { useStudio } from '../render/StudioScene'
import { clampDivider, PARTS, toDividers, toSplit } from '../sim/split'

type Phase = 'idle' | 'playing' | 'done'

/** 拆泥阶段 ①：一团泥 + 四段滑杆 + 确认 → 拆分动画。 */
export function SplitStage() {
  const { session, canSave, discarded } = useSession()
  const [phase, setPhase] = useState<Phase>(session.s1_confirmed ? 'done' : 'idle')
  const rigRef = useRef<ClayRig | null>(null)
  const animRef = useRef({ running: false, t: 0 })
  const split = session.s1_split

  useStudio((studio) => {
    const rig = createClayRig({ label: (p) => t(`split.part.${p}`) })
    rig.group.position.copy(studio.tableTop)
    studio.scene.add(rig.group)
    rigRef.current = rig
    const snapshot = store.get().session
    rig.setSplit(snapshot.s1_split)
    if (snapshot.s1_confirmed) rig.showChunks()
    else rig.showWhole()

    studio.frame = (dt) => {
      if (!animRef.current.running) return
      animRef.current.t += dt
      const p = Math.min(1, animRef.current.t / SPLIT_SECONDS)
      rig.poseSplit(p)
      if (p >= 1) {
        animRef.current.running = false
        rig.showChunks()
        setPhase('done')
      }
    }

    return () => {
      studio.frame = null
      studio.scene.remove(rig.group)
      rig.dispose()
      rigRef.current = null
    }
  })

  // 分隔块拖动 → 四块体积实时跟着变
  useEffect(() => {
    rigRef.current?.setSplit(split)
  }, [split])

  function onDrag(i: 0 | 1 | 2, clientX: number, track: HTMLElement) {
    const r = track.getBoundingClientRect()
    if (r.width <= 0) return
    const next = clampDivider(toDividers(store.get().session.s1_split), i, (clientX - r.left) / r.width)
    store.preview(toSplit(next))
  }

  function reopen() {
    if (phase !== 'done') return
    // 重分：泥团合回一整坨，滑杆恢复可拖，比例保留
    store.reopen()
    animRef.current = { running: false, t: 0 }
    rigRef.current?.setSplit(store.get().session.s1_split)
    rigRef.current?.showWhole()
    setPhase('idle')
  }

  function confirm() {
    if (phase !== 'idle') return
    // 顺序：先取当前比例写进状态并落盘，再起动画；动画期间按钮替换为进行中，天然防连点
    store.confirm()
    const rig = rigRef.current
    if (!rig) return
    rig.setSplit(store.get().session.s1_split)
    animRef.current = { running: true, t: 0 }
    setPhase('playing')
  }

  const edges = [0, ...toDividers(split), 1]

  return (
    <div className="stage">
      <div className="stage-head">
        <h1>{t('split.title')}</h1>
        <p className="hint">{t('split.hint')}</p>
      </div>

      <div className="split-panel">
        <SplitSlider edges={edges} readout={split} disabled={phase !== 'idle'} onDrag={onDrag} />

        <ul className="split-readout" aria-live="polite">
          {PARTS.map((p) => (
            <li key={p} data-part={p}>
              {t(`split.part.${p}`)} <b>{f('split.pct', { n: Math.round(split[p] * 100) })}</b>
            </li>
          ))}
        </ul>

        <div className="actions">
          {phase === 'idle' && (
            <button type="button" onClick={confirm}>
              {t('split.confirm')}
            </button>
          )}
          {phase === 'playing' && (
            <button type="button" disabled>
              {t('split.splitting')}
            </button>
          )}
          {phase === 'done' && (
            <>
              <button type="button" className="ghost" onClick={reopen}>
                {t('split.redo')}
              </button>
              <button type="button" disabled>
                {t('split.next')}
              </button>
            </>
          )}
        </div>

        {(!canSave || discarded) && (
          <p className="save-note">{!canSave ? t('split.memoryOnly') : t('split.discarded')}</p>
        )}
      </div>
    </div>
  )
}

function SplitSlider({
  edges,
  readout,
  disabled,
  onDrag,
}: {
  edges: number[]
  readout: Record<string, number>
  disabled: boolean
  onDrag: (i: 0 | 1 | 2, clientX: number, track: HTMLElement) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<0 | 1 | 2 | null>(null)

  // 拖动跟手：指针离开分隔块也继续跟（setPointerCapture 在触摸上更稳，但 window 监听跨设备一致）
  useEffect(() => {
    if (active == null) return
    const move = (e: PointerEvent) => {
      if (trackRef.current) onDrag(active, e.clientX, trackRef.current)
    }
    const up = () => setActive(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [active, onDrag])

  return (
    <div
      ref={trackRef}
      className={`split-track${disabled ? ' is-disabled' : ''}`}
      role="group"
      aria-label={t('split.title')}
    >
      {PARTS.map((p, i) => (
        <div
          key={p}
          className="split-seg"
          data-part={p}
          data-narrow={(edges[i + 1] - edges[i]) < 0.12 ? '' : undefined}
          style={{ left: `${edges[i] * 100}%`, width: `${(edges[i + 1] - edges[i]) * 100}%` }}
        >
          <span>{f('split.pct', { n: Math.round(readout[p] * 100) })}</span>
        </div>
      ))}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="split-divider"
          style={{ left: `${edges[i + 1] * 100}%` }}
          role="slider"
          aria-orientation="horizontal"
          aria-label={`${t(`split.part.${PARTS[i]}`)} / ${t(`split.part.${PARTS[i + 1]}`)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(edges[i + 1] * 100)}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={(e) => {
            if (disabled) return
            e.preventDefault()
            setActive(i as 0 | 1 | 2)
            onDrag(i as 0 | 1 | 2, e.clientX, e.currentTarget.parentElement!)
          }}
          onKeyDown={(e) => {
            if (disabled) return
            const step = e.shiftKey ? 0.05 : 0.01
            const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0
            if (!dir) return
            e.preventDefault()
            const track = trackRef.current
            if (!track) return
            const r = track.getBoundingClientRect()
            onDrag(i as 0 | 1 | 2, r.left + (edges[i + 1] + dir * step) * r.width, track)
          }}
        />
      ))}
    </div>
  )
}
