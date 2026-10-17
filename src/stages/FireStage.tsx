import { useRef, useState } from 'react'
import difficulty from '../data/difficulty.json'
import firing from '../data/firing.json'
import { colorOf } from '../assets/registry'
import { playCue } from '../audio/bus'
import { eventById, f, t } from '../content/text'
import { session, useSession } from '../game/session'
import { clayBodyColor, hexToRgb, mixHex } from '../render/color'
import { CupView, type CupHandle } from '../render/CupView'
import { skyColor } from '../render/scene'
import { bakeCupTexture, textureSeed } from '../render/textureJob'
import { applyEvent } from '../sim/events'
import { finishFire, needsDemo, retryStage, retuneFire } from '../sim/flow'
import { glazeById } from '../sim/glaze'
import { runDemo, useTicker } from '../ui/hooks'
import { Lesson, MasterLine, Meters, Modal } from '../ui/widgets'

type Phase = 'setup' | 'burn' | 'omen' | 'act' | 'told' | 'reveal' | 'fail'

export default function FireStage({ webgl, onDone }: { webgl: boolean; onDone: () => void }) {
  const { profile } = useSession()
  const opened = session.get().run!
  const cup = useRef<CupHandle>(null)
  const novice = profile.clearCount < difficulty.noviceClears
  const glaze = opened.glaze
  const body = clayBodyColor(opened.clay?.parts ?? { diger: 1, kaolin: 1, aged: 1 })
  const glazeColor = mixHex(
    (glaze?.picks ?? []).map((pick) => ({
      color: colorOf(glazeById(pick.id)?.card ?? 'ui.glaze.qinghui'),
      weight: pick.layers || 1,
    })),
  )
  const sim = useRef({
    phase: 'setup' as Phase,
    elapsed: 0,
    reveal: 0,
    cursor: 0,
    extra: false,
    eventId: '',
    omenLeft: 0,
    actLeft: 0,
    eventOk: false,
    temp: 40,
    fail: 'stuck' as 'stuck' | 'shatter',
    done: false,
  })
  const [hud, setHud] = useState({
    phase: 'setup' as Phase,
    temp: 40,
    left: firing.burnSeconds,
    eventId: '',
    omenLeft: 0,
    actLeft: 0,
    eventOk: false,
    fail: 'stuck' as 'stuck' | 'shatter',
    cotton: 1,
    orbit: 0,
  })
  const [peak, setPeak] = useState(opened.fire?.peakTemp ?? 1120)
  const [hold, setHold] = useState(opened.fire?.holdHours ?? 2)
  const run = session.get().run ?? opened

  function publish() {
    const s = sim.current
    const live = session.get().run
    setHud({
      phase: s.phase,
      temp: Math.round(s.temp),
      left: Math.max(0, firing.burnSeconds - s.elapsed),
      eventId: s.eventId,
      omenLeft: Math.max(0, s.omenLeft),
      actLeft: Math.max(0, s.actLeft),
      eventOk: s.eventOk,
      fail: s.fail,
      cotton: s.phase === 'reveal' ? Math.max(0, 1 - s.reveal / 2) : 1,
      orbit: s.phase === 'reveal' ? Math.max(0, (s.reveal - 2) / 4) : 0,
    })
    cup.current?.update({
      mode: s.phase === 'reveal' ? 'reveal' : 'fire',
      radii: live?.radii,
      color: body,
      glaze: glazeColor,
      glazeMix: 0.8,
      sky: skyColor(live?.weather ?? 'cloudy'),
      kilnOpen: s.phase === 'reveal' ? Math.min(1, s.reveal / 2) : 0.15,
      cotton: s.phase === 'reveal' ? Math.max(0, 1 - s.reveal / 2) : 1,
      orbit: s.phase === 'reveal' ? Math.max(0, s.reveal - 2) * 0.6 : 0,
      lean: live?.lean ?? 0,
      crack: live?.flaws.some((flaw) => flaw.visual === 'crack' || flaw.visual === 'crazing'),
      pinhole: live?.flaws.some((flaw) => flaw.visual === 'pinhole'),
      crazing: live?.flaws.some((flaw) => flaw.visual === 'crazing'),
    })
  }

  function beginEvent(id: string, extra: boolean) {
    const s = sim.current
    s.extra = extra
    s.eventId = id
    s.omenLeft = novice ? difficulty.noviceOmenSeconds : difficulty.omenSeconds
    s.phase = 'omen'
    playCue('warn')
  }

  function resolve(ok: boolean) {
    const s = sim.current
    const event = eventById(s.eventId)
    const live = session.get().run
    if (!event || !live) return
    const next = applyEvent(live, event, ok, s.temp)
    session.setRun(next)
    s.eventOk = ok
    if (!s.extra) s.cursor += 1
    s.extra = false
    if (next.fire?.exploded) {
      const ended = finishFire(next, false)
      session.setRun(ended.state)
      s.phase = 'fail'
      s.fail = 'shatter'
    } else s.phase = 'told'
    publish()
  }

  function bake(uniqueId: string) {
    const live = session.get().run
    if (!live?.result || !live.clay) return
    const colors = (live.glaze?.picks ?? []).map((pick) => hexToRgb(colorOf(glazeById(pick.id)?.card ?? 'ui.glaze.qinghui')))
    void bakeCupTexture(uniqueId, {
      seed: textureSeed(uniqueId),
      iron: live.clay.I,
      colors,
      hueShift: live.result.hueShift,
      pattern: live.result.pattern,
      density: live.result.density,
      gloss: live.result.gloss,
      flow: live.result.flow,
      flawVisuals: live.result.flaws.map((flaw) => flaw.visual),
    }).then((tex) => {
      cup.current?.update({ map: tex.albedo, mode: 'reveal' })
    })
  }

  function finishBurn() {
    const s = sim.current
    if (s.done) return
    const ended = finishFire(session.get().run!, false)
    session.setRun(ended.state)
    if (ended.fail) {
      s.phase = 'fail'
      s.fail = ended.fail
      publish()
      return
    }
    s.phase = 'reveal'
    s.reveal = 0
    playCue('open')
    bake(ended.state.result?.uniqueId ?? '')
    publish()
  }

  useTicker(hud.phase === 'burn' || hud.phase === 'omen' || hud.phase === 'act' || hud.phase === 'reveal', (dt) => {
    if (dt <= 0) return
    const s = sim.current
    const live = session.get().run
    if (!live) return
    if (s.phase === 'reveal') {
      s.reveal += dt
      if (s.reveal >= difficulty.kilnRevealSeconds && !s.done) {
        s.done = true
        onDone()
      }
      publish()
      return
    }
    if (s.phase === 'omen') {
      s.omenLeft -= dt
      if (s.omenLeft <= 0) {
        s.phase = 'act'
        s.actLeft = difficulty.responseSeconds
      }
    } else if (s.phase === 'act') {
      s.actLeft -= dt
      if (s.actLeft <= 0) {
        resolve(false)
        return
      }
    } else if (s.phase === 'burn') {
      s.elapsed += dt
      const peakNow = live.fire?.peakTemp ?? peak
      s.temp = 40 + (peakNow - 40) * Math.min(1, s.elapsed / firing.burnSeconds)
      const ids = live.fire?.scheduled ?? []
      const at = firing.burnSeconds * (0.45 + s.cursor * 0.25)
      if (!s.extra && s.cursor < ids.length && s.elapsed >= at) beginEvent(ids[s.cursor], false)
      else if (s.elapsed >= firing.burnSeconds) {
        finishBurn()
        return
      }
    }
    publish()
  })

  function ignite() {
    const tuned = retuneFire(session.get().run!, peak, hold, novice, run.practice)
    session.setRun(tuned)
    sim.current.phase = 'burn'
    sim.current.elapsed = 0
    sim.current.cursor = 0
    sim.current.temp = 40
    playCue('kiln')
    publish()
  }

  const event = eventById(hud.eventId)
  const locked = needsDemo(run.retries)
  const inEvent = hud.phase === 'omen' || hud.phase === 'act' || hud.phase === 'told'
  const brittle = Boolean(run.bisque?.brittle)

  return (
    <div className="layout">
      <div className="stage-view">
        <CupView ref={cup} webgl={webgl} mode="fire" radii={run.radii} color={body} glaze={glazeColor} glazeMix={0.75} sky={skyColor(run.weather)} />
        <MasterLine id="lines.fire" />
      </div>
      <div className="panel">
        <p className="hint">{t('ui.conduction.fire')}</p>
        {brittle ? <p className="warn">{t('ui.brittle')}</p> : null}
        <Meters
          items={[
            { id: 'temp', label: t('ui.meter.temperature'), value: f('ui.tempNow', { n: hud.phase === 'setup' ? peak : hud.temp }), note: f('ui.holdHours', { n: hold }) },
            { id: 'time', label: t('ui.stage.fire'), value: hud.phase === 'reveal' ? t('ui.revealCup') : f('ui.countdown', { n: Math.ceil(hud.left) }), note: hud.phase === 'reveal' ? t('ui.orbit') : t('ui.atmosphere') },
          ]}
        />
        {hud.phase === 'reveal' ? (
          <p>{hud.cotton > 0.15 ? t('ui.revealCotton') : hud.orbit < 0.35 ? t('ui.revealCup') : t('ui.revealOrbit')}</p>
        ) : null}
        {hud.phase === 'setup' ? (
          <>
            <p>{t('ui.peak')}</p>
            <div className="row">
              {firing.peaks.map((value) => (
                <button key={value} type="button" className={peak === value ? '' : 'ghost'} onClick={() => setPeak(value)}>
                  {value}
                </button>
              ))}
            </div>
            <p>{t('ui.hold')}</p>
            <div className="row">
              {[0, 1, 2, 3, 4].map((value) => (
                <button key={value} type="button" className={hold === value ? '' : 'ghost'} onClick={() => setHold(value)}>
                  {f('ui.holdHours', { n: value })}
                </button>
              ))}
            </div>
            {(glaze?.picks ?? []).map((pick) => {
              const spec = glazeById(pick.id)
              const outside = spec ? peak < spec.tempMin || peak > spec.tempMax : false
              return (
                <p key={pick.id} className={outside ? 'warn' : 'fine'}>
                  {spec?.name} {spec?.tempMin}–{spec?.tempMax}℃
                </p>
              )
            })}
            <div className="row">
              <button type="button" onClick={locked ? () => runDemo(onDone) : ignite}>{locked ? t('ui.demo') : t('ui.startFire')}</button>
              {brittle ? (
                <button type="button" className="ghost" onClick={() => session.setRun(retryStage({ ...session.get().run!, stage: 'dry' }, false, novice, run.practice))}>
                  {t('ui.backDry')}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        {hud.phase === 'burn' ? (
            <button type="button" className="ghost" onClick={() => { beginEvent('e12', true); publish() }}>
            {t('ui.openDoor')}
          </button>
        ) : null}
        {hud.phase === 'burn' ? <p className="fine">{t('ui.doorHint')}</p> : null}
        {inEvent && event ? (
          <div className="card">
            <h2>{event.title}</h2>
            {hud.phase === 'omen' ? <p>{event.omen}</p> : null}
            {hud.phase === 'omen' ? <p className="fine">{f('ui.countdown', { n: Math.ceil(hud.omenLeft) })}</p> : null}
            {hud.phase === 'act' ? (
              <button type="button" onClick={() => resolve(true)}>
                {event.actionLabel} · {f('ui.countdown', { n: Math.ceil(hud.actLeft) })}
              </button>
            ) : null}
            {hud.phase === 'told' ? (
              <>
                <p>{hud.eventOk ? t('ui.eventSuccess') : t('ui.eventMiss')}</p>
                <Lesson cause={event.cause} effect={hud.eventOk ? event.successEffect : event.failEffect} avoid={event.avoid} />
                <button
                  type="button"
                  onClick={() => {
                    const s = sim.current
                    if (s.elapsed >= firing.burnSeconds) finishBurn()
                    else {
                      s.phase = 'burn'
                      publish()
                    }
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
          title={hud.fail === 'stuck' ? t('ui.kilnFailStuck') : t('ui.kilnFailShatter')}
          actions={
            needsDemo(run.retries + 1)
              ? [{ id: 'demo', label: t('ui.demo'), onClick: () => runDemo(onDone) }]
              : hud.fail === 'stuck'
                ? [{ id: 'glaze', label: t('ui.backGlaze'), onClick: () => {
                    const live = session.get().run!
                    session.setRun({ ...live, stage: 'glaze', result: null, failReason: null, fire: null, retries: live.retries + 1 })
                  } }]
                : brittle
                  ? [{ id: 'dry', label: t('ui.backDry'), onClick: () => session.setRun(retryStage({ ...session.get().run!, stage: 'dry' }, true, novice, run.practice)) }]
                  : [{ id: 'fire', label: t('ui.retryStage'), onClick: () => {
                      session.setRun(retryStage(session.get().run!, true, novice, run.practice))
                      sim.current.phase = 'setup'
                      sim.current.elapsed = 0
                      sim.current.done = false
                      publish()
                    } }]
          }
        >
          <Lesson
            cause={hud.fail === 'stuck' ? t('ui.kilnFailStuck') : t('ui.kilnFailShatter')}
            effect={hud.fail === 'stuck' ? t('ui.kilnFailStuckEffect') : t('ui.kilnFailShatterEffect')}
            avoid={hud.fail === 'stuck' ? t('ui.kilnFailStuckAvoid') : t('ui.kilnFailShatterAvoid')}
          />
        </Modal>
      ) : null}
    </div>
  )
}
