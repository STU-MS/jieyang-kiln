import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../content/text'
import { useSession } from '../game/session'
import { svgOf } from '../assets/registry'

const ORDER = ['mix', 'throw', 'dry', 'glaze', 'fire'] as const

export function Shell({
  stage,
  webgl,
  notice,
  onQuit,
  onSkip,
  welcome,
  children,
}: {
  stage?: string
  webgl: boolean
  notice?: string
  onQuit?: () => void
  onSkip?: () => void
  welcome?: boolean
  children: ReactNode
}) {
  const { run } = useSession()
  const current = ORDER.indexOf(stage as (typeof ORDER)[number])
  const playing = Boolean(stage)
  return (
    <div className={['app', playing ? 'play' : '', welcome ? 'welcome-app' : ''].filter(Boolean).join(' ')}>
      <header className={welcome ? 'top welcome-bar' : 'top'}>
        {welcome ? null : (
          <div>
            <p className="brand">{t('ui.appTitle')}</p>
            {stage ? null : <h1>{t('ui.appSub')}</h1>}
          </div>
        )}
        <div className="top-actions">
          {onSkip && run ? (
            <button type="button" className="ghost" onClick={onSkip}>
              {t('ui.skipStage')}
            </button>
          ) : null}
          {onQuit && run ? (
            <button type="button" onClick={onQuit}>
              {t('ui.quit')}
            </button>
          ) : null}
        </div>
      </header>
      {stage ? (
        <nav className="stage-bar" aria-label={t('ui.appTitle')}>
          {ORDER.map((id, index) => {
            const locked = index > current
            const state = index === current ? 'now' : index < current ? 'done' : 'locked'
            return (
              <button key={id} type="button" className={`stage-btn ${state}`} disabled={locked} aria-current={index === current ? 'step' : undefined}>
                <span>{t(`ui.stage.${id}`)}</span>
                {locked ? (
                  <span className="lock-mask" aria-hidden="true">
                    <Icon name="icon.lock" />
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
      ) : null}
      {!webgl ? <p className="banner">{t('ui.webgl')} {t('ui.browser')}</p> : null}
      {notice ? <p className="banner">{notice}</p> : null}
      {children}
    </div>
  )
}

export function Meters({ items }: { items: { id: string; label: string; value: string; note: string; pattern?: string; amount?: number; gauge?: { min: number; max: number; stops: number[]; tones?: string[] } }[] }) {
  return (
    <div className="meters">
      {items.map((item) => {
        const gauge = item.gauge
        const amount = item.amount
        if (!gauge || amount == null || !Number.isFinite(amount) || !(gauge.max > gauge.min)) {
          return (
            <div key={item.id} className={`meter ${item.pattern ?? ''}`}>
              <i />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{item.note}</em>
            </div>
          )
        }
        const edges = [gauge.min, ...gauge.stops.filter((stop) => stop > gauge.min && stop < gauge.max), gauge.max]
        const span = gauge.max - gauge.min
        const parts = edges.slice(0, -1).map((start, index) => ({
          grow: Math.max(0.001, (edges[index + 1] - start) / span),
          tone: gauge.tones?.[index] ?? (index === 1 ? 'mid' : index === 0 ? 'low' : 'high'),
        }))
        const pct = Math.min(100, Math.max(0, ((amount - gauge.min) / span) * 100))
        return (
          <div key={item.id} className={`meter gauge ${item.pattern ?? ''}`}>
            <span>{item.label}</span>
            <div className="gauge-bar" role="img" aria-label={`${item.label} ${item.note}`}>
              {parts.map((part, index) => (
                <i key={index} className={`tone-${part.tone}`} style={{ flexGrow: part.grow }} />
              ))}
              <b className="gauge-cursor" style={{ left: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  display,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  display?: string
}) {
  const set = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next / step) * step)))
  return (
    <label className="slider">
      <span>{label}</span>
      <strong>{display ?? String(value)}</strong>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => set(Number(event.target.value))} />
      <span className="stepper">
        <button type="button" onClick={() => set(value - step)} aria-label={`${label} -`}>
          −
        </button>
        <button type="button" onClick={() => set(value + step)} aria-label={`${label} +`}>
          +
        </button>
      </span>
    </label>
  )
}

export function Modal({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions: { id: string; label: string; onClick: () => void }[]
}) {
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="row">
          {actions.map((action) => (
            <button key={action.id} type="button" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const MASTER_MS = 14000

export function MasterLine({ id }: { id: string }) {
  const [open, setOpen] = useState(true)
  const [left, setLeft] = useState(1)
  const stopped = useRef(false)

  useEffect(() => {
    stopped.current = false
    setOpen(true)
    setLeft(1)
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      if (stopped.current) return
      const ratio = 1 - (now - start) / MASTER_MS
      if (ratio <= 0) {
        setLeft(0)
        setOpen(false)
        return
      }
      setLeft(ratio)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [id])

  if (!open) return null
  return (
    <aside className="master-pop" role="status">
      <button
        type="button"
        className="master-x"
        aria-label={t('ui.skipLine')}
        onClick={() => {
          stopped.current = true
          setOpen(false)
        }}
      >
        ×
      </button>
      <p><b>{t('ui.portraitName')}</b> {t(id)}</p>
      <div className="master-meter" aria-hidden="true">
        <i style={{ transform: `scaleX(${left})` }} />
      </div>
    </aside>
  )
}

export function Icon({ name }: { name: string }) {
  return <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgOf(name) }} />
}

export function Lesson({ cause, effect, avoid }: { cause: string; effect: string; avoid: string }) {
  return (
    <div className="lesson">
      <p><b>{t('ui.cause')}</b> {cause}</p>
      <p><b>{t('ui.effect')}</b> {effect}</p>
      <p><b>{t('ui.avoid')}</b> {avoid}</p>
    </div>
  )
}
