import { useRef, useState, type PointerEvent } from 'react'
import climate from '../data/climate.json'
import difficulty from '../data/difficulty.json'
import drying from '../data/drying.json'
import { playCue } from '../audio/bus'
import { eventById, f, t } from '../content/text'
import { session, useSession } from '../game/session'
import { clayBodyColor } from '../render/color'
import { CupView, type CupHandle } from '../render/CupView'
import { skyColor } from '../render/scene'
import { bisqueDuration, bisqueTarget } from '../sim/bisque'
import { applyEvent } from '../sim/events'
import { armBisque, currentBand, finishBisque, needsDemo, retryStage, setPlacement } from '../sim/flow'
import { clamp } from '../sim/math'
import { hashString, mulberry32 } from '../sim/rng'
import { runDemo, useTicker } from '../ui/hooks'
import { Icon, Lesson, MasterLine, Meters, Modal } from '../ui/widgets'
import type { PlacementId } from '../sim/types'

type Phase = 'pick' | 'dry' | 'omen' | 'act' | 'told' | 'ready' | 'bisque' | 'bomen' | 'bact' | 'btold' | 'fail'

interface Hud {
  phase: Phase
  left: number
  humidity: number
  temp: number
  band: string
  deviation: number
  eventId: string
  omenLeft: number
  actLeft: number
  eventOk: boolean
  fail: 'crack' | 'wet'
}

export default function DryStage({ webgl, onDone }: { webgl: boolean; onDone: () => void }) {
  const { profile } = useSession()
  const opened = session.get().run!
  const cup = useRef<CupHandle>(null)
  const color = clayBodyColor(opened.clay?.parts ?? { diger: 1, kaolin: 1, aged: 1 })
  const novice = profile.clearCount < difficulty.noviceClears
  const omenSec = novice ? difficulty.noviceOmenSeconds : difficulty.omenSeconds
  const sim = useRef({
    phase: 'pick' as Phase,
    elapsed: 0,
    cursor: 0,
    bcursor: 0,
    extra: false,
    eventId: '',
    omenLeft: 0,
    actLeft: 0,
    eventOk: false,
    temp: 40,
    deviation: 0,
    maxTemp: 40,
    fail: 'crack' as 'crack' | 'wet',
    bisque: false,
    finished: false,
  })
  const [hud, setHud] = useState<Hud>({
    phase: 'pick',
    left: opened.dry?.duration ?? 20,
    humidity: opened.humidity,
    temp: 40,
    band: '',
    deviation: 0,
    eventId: '',
    omenLeft: 0,
    actLeft: 0,
    eventOk: false,
    fail: 'crack',
  })
  const [rev, setRev] = useState(0)
  const run = session.get().run ?? opened
  const dry = run.dry

  function publish() {
    const s = sim.current
    const live = session.get().run
    const duration = s.bisque ? bisqueDuration(live?.bisque?.wetExtra ?? 0) : live?.dry?.duration ?? 1
    const curve = live?.dry?.humidityCurve ?? [live?.humidity ?? 60]
    const idx = Math.min(curve.length - 1, Math.floor((s.elapsed / Math.max(0.001, duration)) * curve.length))
    const band = live ? currentBand(live) : 40
    const target = bisqueTarget(s.elapsed, duration, band)
    setHud({
      phase: s.phase,
      left: Math.max(0, duration - s.elapsed),
      humidity: s.bisque ? curve[curve.length - 1] : curve[idx],
      temp: Math.round(s.temp),
      band: s.bisque ? f('ui.targetBand', { a: Math.round(target.min), b: Math.round(target.max) }) : '',
      deviation: s.deviation,
      eventId: s.eventId,
      omenLeft: Math.max(0, s.omenLeft),
      actLeft: Math.max(0, s.actLeft),
      eventOk: s.eventOk,
      fail: s.fail,
    })
    cup.current?.update({
      mode: s.bisque ? 'fire' : 'dry',
      radii: live?.radii,
      color,
      sky: skyColor(live?.weather ?? 'cloudy'),
      wet: s.bisque ? 0.05 : 0.35,
      kilnOpen: s.bisque ? 0.2 : 0,
      crack: Boolean(live?.dry?.crackOpen || live?.dry?.sunCrack),
    })
  }

  function beginEvent(id: string, extra: boolean) {
    const s = sim.current
    s.extra = extra
    s.eventId = id
    s.omenLeft = omenSec
    s.phase = s.bisque ? 'bomen' : 'omen'
    playCue('warn')
    publish()
  }

  function resolve(ok: boolean) {
    const s = sim.current
    const event = eventById(s.eventId)
    const live = session.get().run
    if (!event || !live) return
    const next = applyEvent(live, event, ok, s.temp)
    session.setRun(next)
    s.eventOk = ok
    if (!s.extra) {
      if (s.bisque) s.bcursor += 1
      else s.cursor += 1
    }
    s.extra = false
    if (next.bisque?.exploded) {
      s.phase = 'fail'
      s.fail = 'wet'
    } else s.phase = s.bisque ? 'btold' : 'told'
    publish()
  }

  function settleClimate() {
    const live = session.get().run
    if (!live?.dry || live.dry.sunCrack || live.dry.winterCrack) return
    const rng = mulberry32(hashString(`climate|${live.seed}|${live.dry.placement}`))
    const season = climate.seasons.find((item) => item.id === live.season)
    let dry = live.dry
    const flaws = live.flaws.slice()
    if (dry.placement === 'sun' && rng() < drying.sunCrackChance) {
      dry = { ...dry, sunCrack: true }
      flaws.push({ id: 'sun-crack', visual: 'crack', from: 'sun' })
    }
    if ((season?.crackBonus ?? 0) > 0 && rng() < (season?.crackBonus ?? 0)) {
      dry = { ...dry, winterCrack: true }
      flaws.push({ id: 'winter-crack', visual: 'crack', from: 'winter' })
    }
    if (dry !== live.dry) session.setRun({ ...live, dry, flaws })
  }

  useTicker(hud.phase === 'dry' || hud.phase === 'omen' || hud.phase === 'act' || hud.phase === 'bisque' || hud.phase === 'bomen' || hud.phase === 'bact', (dt) => {
    if (dt <= 0 || sim.current.finished) return
    const s = sim.current
    const live = session.get().run
    if (!live?.dry) return
    if (s.phase === 'omen' || s.phase === 'bomen') {
      s.omenLeft -= dt
      if (s.omenLeft <= 0) {
        s.phase = s.bisque ? 'bact' : 'act'
        s.actLeft = difficulty.responseSeconds
      }
    } else if (s.phase === 'act' || s.phase === 'bact') {
      s.actLeft -= dt
      if (s.actLeft <= 0) {
        resolve(false)
        return
      }
    } else if (s.phase === 'dry') {
      s.elapsed += dt
      const ids = live.dry.scheduled
      const at = live.dry.duration * (0.34 + s.cursor * 0.28)
      if (s.cursor < ids.length && s.elapsed >= at) beginEvent(ids[s.cursor], false)
      else if (s.elapsed >= live.dry.duration) {
        s.phase = 'ready'
        settleClimate()
      }
    } else if (s.phase === 'bisque') {
      s.elapsed += dt
      const total = bisqueDuration(live.bisque?.wetExtra ?? 0)
      const width = currentBand(live)
      const target = bisqueTarget(s.elapsed, total, width)
      if (s.temp < target.min || s.temp > target.max) s.deviation += dt
      s.maxTemp = Math.max(s.maxTemp, s.temp)
      const ids = live.bisque?.scheduled ?? []
      const at = total * (0.42 + s.bcursor * 0.3)
      if (s.bcursor < ids.length && s.elapsed >= at) beginEvent(ids[s.bcursor], false)
      else if (s.elapsed >= total) {
        if (live.bisque?.exploded) {
          s.phase = 'fail'
          s.fail = 'wet'
        } else {
          s.finished = true
          session.setRun(finishBisque(live, s.deviation, s.maxTemp))
          return
        }
      }
    }
    publish()
  })

  function startBisque() {
    const armed = armBisque(session.get().run!, novice, run.practice)
    session.setRun(armed.state)
    if (armed.blocked) {
      sim.current.phase = 'fail'
      sim.current.fail = 'crack'
      publish()
      return
    }
    sim.current.bisque = true
    sim.current.phase = 'bisque'
    sim.current.elapsed = 0
    sim.current.bcursor = 0
    sim.current.deviation = 0
    sim.current.temp = 40
    sim.current.maxTemp = 40
    playCue('kiln')
    publish()
  }

  function goDryAgain() {
    const live = session.get().run
    if (!live) return
    session.setRun(retryStage({ ...live, stage: 'dry' }, true, novice, live.practice))
    sim.current = { ...sim.current, phase: 'pick', elapsed: 0, cursor: 0, bisque: false, extra: false, finished: false }
    publish()
    setRev((value) => value + 1)
  }

  const tempDrag = useRef<{ y: number; origin: number } | null>(null)

  function onDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('.master-pop')) return
    if (sim.current.phase !== 'bisque') return
    if (cup.current?.pick(event.clientX, event.clientY) !== 'kiln') return
    tempDrag.current = { y: event.clientY, origin: sim.current.temp }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const dragging = tempDrag.current
    if (!dragging || sim.current.phase !== 'bisque') return
    sim.current.temp = clamp(dragging.origin + (dragging.y - event.clientY) * 2.4, 0, 950)
    publish()
  }

  const event = eventById(hud.eventId)
  const fanLocked = profile.clearCount < difficulty.fanUnlockClears
  const locked = needsDemo(run.retries)
  const activeEvent = hud.phase === 'omen' || hud.phase === 'act' || hud.phase === 'told' || hud.phase === 'bomen' || hud.phase === 'bact' || hud.phase === 'btold'

  return (
    <div className="layout" data-rev={rev}>
      <div className="stage-view gesture" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { tempDrag.current = null }}>
        <CupView ref={cup} webgl={webgl} mode="dry" radii={run.radii} color={color} sky={skyColor(run.weather)} />
        <MasterLine id="lines.dry" />
      </div>
      <div className="panel">
        <p className="hint">{t('ui.conduction.dry')}</p>
        <p>
          {t(`ui.season.${run.season}`)} · {t(`ui.weather.${run.weather}`)} · {f('ui.humidityNow', { n: Math.round(hud.humidity) })}
        </p>
        <Meters
          items={[
            { id: 'h', label: t('ui.meter.humidity'), value: `${Math.round(hud.humidity)}%`, note: f('ui.placementNow', { name: t(`ui.place.${dry?.placement ?? 'shade'}`) }) },
            {
              id: 't',
              label: t('ui.meter.temperature'),
              value:
                hud.phase === 'bisque' || hud.phase === 'bomen' || hud.phase === 'bact' || hud.phase === 'btold'
                  ? f('ui.tempNow', { n: hud.temp })
                  : f('ui.dryLeft', { n: Math.ceil(hud.left) }),
              note: hud.band || t('ui.bisqueHint'),
            },
            { id: 'd', label: t('ui.meter.h'), value: f('ui.deviation', { n: hud.deviation.toFixed(1) }), note: hud.deviation > difficulty.bisqueDeviationLimit ? t('ui.pinFuture') : t('ui.note.ok') },
          ]}
        />
        {hud.phase === 'pick' || hud.phase === 'dry' ? (
          <div className="row">
            {(['vent', 'shade', 'sun'] as PlacementId[]).map((id) => (
              <button key={id} type="button" className={dry?.placement === id ? '' : 'ghost'} onClick={() => dry && session.setRun(setPlacement(session.get().run!, id))}>
                <Icon name={`icon.place.${id}`} /> {t(`ui.place.${id}`)}
              </button>
            ))}
          </div>
        ) : null}
        {hud.phase === 'pick' ? (
          <button
            type="button"
            onClick={() => {
              if (locked) {
                runDemo(onDone)
                return
              }
              sim.current.phase = 'dry'
              sim.current.elapsed = 0
              publish()
            }}
          >
            {locked ? t('ui.demo') : t('ui.startDry')}
          </button>
        ) : null}
        {hud.phase === 'dry' || hud.phase === 'pick' ? (
          <div className="row">
            <button
              type="button"
              className="ghost"
              disabled={!dry || dry.flipped || hud.phase === 'pick'}
              onClick={() => {
                const live = session.get().run
                if (!live?.dry) return
                session.setRun({ ...live, dry: { ...live.dry, flipped: true } })
                setRev((value) => value + 1)
              }}
            >
              <Icon name="icon.action.flip" /> {dry?.flipped ? t('ui.flipped') : t('ui.flip')}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={!dry || dry.covered || hud.phase === 'pick'}
              onClick={() => {
                const live = session.get().run
                if (!live?.dry) return
                session.setRun({ ...live, dry: { ...live.dry, covered: true } })
                setRev((value) => value + 1)
              }}
            >
              <Icon name="icon.action.cover" /> {dry?.covered ? t('ui.covered') : t('ui.cover')}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={fanLocked || hud.phase !== 'dry'}
              onClick={() => beginEvent('e5', true)}
            >
              <Icon name="icon.action.fan" /> {t('ui.fan')}
            </button>
          </div>
        ) : null}
        {fanLocked && (hud.phase === 'pick' || hud.phase === 'dry') ? <p className="fine">{t('ui.fanLocked')}</p> : null}
        {hud.phase === 'ready' ? (
          <>
            {(dry?.sunCrack || dry?.winterCrack) ? <p className="warn">{t('ui.flaw.crack')}</p> : null}
            <button type="button" onClick={startBisque}>{t('ui.startBisque')}</button>
          </>
        ) : null}
        {hud.phase === 'bisque' ? (
          <>
            <p className="fine">{t('ui.bisqueDrag')} {f('ui.yourTemp', { n: hud.temp })} · {hud.band}</p>
            {!webgl ? (
              <span className="stepper">
                <button type="button" onClick={() => { sim.current.temp = clamp(sim.current.temp - 10, 0, 950); publish() }}>−</button>
                <button type="button" onClick={() => { sim.current.temp = clamp(sim.current.temp + 10, 0, 950); publish() }}>+</button>
              </span>
            ) : null}
          </>
        ) : null}
        {sim.current.temp > difficulty.bisqueCeiling && hud.phase === 'bisque' ? <p className="warn">{t('ui.brittle')}</p> : null}
        {activeEvent && event ? (
          <div className="card">
            <h2>{event.title}</h2>
            {(hud.phase === 'omen' || hud.phase === 'bomen') ? <p>{event.omen}</p> : null}
            {(hud.phase === 'act' || hud.phase === 'bact') ? (
              <button type="button" onClick={() => resolve(true)}>
                {event.actionLabel} · {f('ui.countdown', { n: Math.ceil(hud.actLeft) })}
              </button>
            ) : null}
            {(hud.phase === 'omen' || hud.phase === 'bomen') ? <p className="fine">{f('ui.countdown', { n: Math.ceil(hud.omenLeft) })}</p> : null}
            {(hud.phase === 'told' || hud.phase === 'btold') ? (
              <>
                <p>{hud.eventOk ? t('ui.eventSuccess') : t('ui.eventMiss')}</p>
                <Lesson cause={event.cause} effect={hud.eventOk ? event.successEffect : event.failEffect} avoid={event.avoid} />
                <button
                  type="button"
                  onClick={() => {
                    const s = sim.current
                    const live = session.get().run
                    if (s.bisque) {
                      const total = bisqueDuration(live?.bisque?.wetExtra ?? 0)
                      if (s.elapsed >= total && live) {
                        s.finished = true
                        session.setRun(finishBisque(live, s.deviation, s.maxTemp))
                      } else s.phase = 'bisque'
                    } else {
                      const duration = live?.dry?.duration ?? 1
                      s.phase = s.elapsed >= duration ? 'ready' : 'dry'
                      if (s.phase === 'ready') settleClimate()
                    }
                    publish()
                  }}
                >
                  {t('ui.continueAction')}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {hud.phase === 'fail' ? (
        <Modal
          title={hud.fail === 'wet' ? t('ui.wetFail') : t('ui.bisqueFail')}
          actions={
            locked || needsDemo(run.retries + 1)
              ? [{ id: 'demo', label: t('ui.demo'), onClick: () => runDemo(onDone) }]
              : [{ id: 'dry', label: t('ui.backDry'), onClick: goDryAgain }]
          }
        >
          <Lesson
            cause={hud.fail === 'wet' ? t('ui.wetFail') : t('ui.bisqueFail')}
            effect={hud.fail === 'wet' ? t('ui.wetFailEffect') : t('ui.bisqueFailEffect')}
            avoid={hud.fail === 'wet' ? t('ui.wetFailAvoid') : t('ui.bisqueFailAvoid')}
          />
        </Modal>
      ) : null}
    </div>
  )
}
