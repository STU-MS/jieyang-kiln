import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import glazeData from '../data/glaze.json'
import difficulty from '../data/difficulty.json'
import { colorOf } from '../assets/registry'
import { t, f } from '../content/text'
import { session, useSession } from '../game/session'
import { clayBodyColor, mixHex } from '../render/color'
import { skyColor } from '../render/scene'
import { beginFire, needsDemo, retryStage } from '../sim/flow'
import { buildGlaze, glazeCost, glazeStock } from '../sim/glaze'
import { clamp } from '../sim/math'
import { runDemo } from '../ui/hooks'
import { MasterLine, Meters } from '../ui/widgets'
import { CupView, type CupHandle } from '../render/CupView'
import type { GlazePick, GlazeStamp } from '../sim/types'
import cup from '../data/cup.json'

export default function GlazeStage({ webgl, onDone }: { webgl: boolean; onDone: () => void }) {
  const { profile } = useSession()
  const run = session.get().run!
  const clay = run.clay!
  const stock = glazeStock(profile.knowledgeCardIds.length, clay.quality)
  const [picks, setPicks] = useState<GlazePick[]>(run.glaze?.picks.map((pick) => ({ ...pick })) ?? [])
  const [stamps, setStamps] = useState<GlazeStamp[]>(run.glaze?.stamps.map((stamp) => ({ ...stamp })) ?? [])
  const [ring, setRing] = useState(0.55)
  const novice = profile.clearCount < difficulty.noviceClears
  const locked = needsDemo(run.retries)
  const preview = useMemo(() => (picks.length ? buildGlaze(picks, stamps, stock) : null), [picks, stamps, stock])
  const body = clayBodyColor(clay.parts)
  const glazeColor = picks.length
    ? mixHex(picks.map((pick) => ({ color: colorOf(glazeData.glazes.find((item) => item.id === pick.id)?.card ?? 'ui.glaze.qinghui'), weight: pick.layers })))
    : body
  const cost = glazeCost(picks, stamps)
  const short = cost > stock
  const view = useRef<CupHandle>(null)
  const drag = useRef<{ kind: 'glaze' | 'cup'; id: string; y: number; origin: number; moved: boolean } | null>(null)

  useEffect(() => {
    view.current?.update({
      mode: 'glaze',
      radii: run.radii,
      color: body,
      glaze: glazeColor,
      glazeMix: preview ? Math.min(1, preview.totalLayers * 0.22) : 0,
      sky: skyColor(run.weather),
      crazing: Boolean(preview?.rimCovered),
      crack: run.flaws.some((flaw) => flaw.visual === 'crack'),
      pinhole: run.flaws.some((flaw) => flaw.visual === 'pinhole'),
      glazeBrush: ring,
      jars: glazeData.glazes.map((glaze) => {
        const picked = picks.find((pick) => pick.id === glaze.id)
        return {
          id: glaze.id,
          color: colorOf(glaze.card),
          on: Boolean(picked),
          concentration: picked?.concentration ?? 0.35,
        }
      }),
    })
  })

  function onDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('.master-pop')) return
    const hit = view.current?.pick(event.clientX, event.clientY)
    if (!hit) return
    if (hit.startsWith('glaze:')) {
      const id = hit.slice('glaze:'.length)
      const found = picks.find((pick) => pick.id === id)
      drag.current = { kind: 'glaze', id, y: event.clientY, origin: found?.concentration ?? 0.65, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    } else if (hit === 'cup') {
      drag.current = { kind: 'cup', id: 'cup', y: event.clientY, origin: ring, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const dragging = drag.current
    if (!dragging) return
    if (Math.abs(event.clientY - dragging.y) > 4) dragging.moved = true
    if (dragging.kind === 'cup') {
      setRing(clamp(dragging.origin + (dragging.y - event.clientY) / 220, 0, 1))
      return
    }
    const next = clamp(dragging.origin + (dragging.y - event.clientY) / 180, 0.3, 1)
    setPicks((current) => {
      if (!current.some((pick) => pick.id === dragging.id)) {
        if (!dragging.moved || current.length >= 2) return current
        return [...current, { id: dragging.id, layers: 1, concentration: next }]
      }
      return current.map((pick) => (pick.id === dragging.id ? { ...pick, concentration: next } : pick))
    })
  }

  function onUp() {
    const dragging = drag.current
    drag.current = null
    if (!dragging || dragging.kind !== 'glaze' || dragging.moved) return
    toggle(dragging.id)
  }

  function toggle(id: string) {
    setPicks((current) => {
      if (current.some((pick) => pick.id === id)) return current.filter((pick) => pick.id !== id)
      if (current.length >= 2) return current
      return [...current, { id, layers: 1, concentration: 0.65 }]
    })
  }

  function setLayers(id: string, layers: number) {
    setPicks((current) => current.map((pick) => (pick.id === id ? { ...pick, layers } : pick)))
  }

  function setConcentration(id: string, concentration: number) {
    setPicks((current) => current.map((pick) => (pick.id === id ? { ...pick, concentration } : pick)))
  }

  function brush() {
    if (stock - glazeCost(picks, stamps) < glazeData.brushCost) return
    setStamps((current) => [...current, { ring: Math.round(ring * (cup.rings - 1)), amount: 0.55 }])
  }

  function enterKiln() {
    if (locked) {
      runDemo(onDone)
      return
    }
    if (picks.length !== 2 || short) return
    session.setRun(beginFire(session.get().run!, picks, stamps, profile.knowledgeCardIds.length, novice, run.practice))
  }

  return (
    <div className="layout">
      <div className="stage-view gesture" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <CupView
          ref={view}
          webgl={webgl}
          mode="glaze"
          radii={run.radii}
          color={body}
          glaze={glazeColor}
          glazeMix={preview ? Math.min(1, preview.totalLayers * 0.22) : 0}
          sky={skyColor(run.weather)}
          crazing={Boolean(preview?.rimCovered)}
          crack={run.flaws.some((flaw) => flaw.visual === 'crack')}
          pinhole={run.flaws.some((flaw) => flaw.visual === 'pinhole')}
        />
        <MasterLine id="lines.glaze" />
      </div>
      <div className="panel">
        <p className="hint">{t('ui.conduction.glaze')}</p>
        <p className="fine">{t('ui.glazeDrag')}</p>
        {run.bisque?.brittle ? <p className="warn">{t('ui.brittle')}</p> : null}
        <Meters
          items={[
            { id: 'stock', label: t('ui.glazePick'), value: f('ui.stock', { n: Math.max(0, stock - cost) }), note: short ? t('ui.stockShort') : t('ui.note.ok') },
            { id: 'even', label: t('ui.stage.glaze'), value: f('ui.uniform', { n: Math.round((preview?.uniformity ?? 1) * 100) }), note: preview?.warned ? t('ui.glazeWarn') : t('ui.note.ok') },
            { id: 'layers', label: t('ui.layers'), value: String(preview?.totalLayers ?? 0), note: preview?.footRisk ? t('ui.footWarn') : t('ui.layerUnit') },
          ]}
        />
        <div className="swatches">
          {glazeData.glazes.map((glaze) => (
            webgl ? (
              <span key={glaze.id} className={picks.some((pick) => pick.id === glaze.id) ? 'on' : ''}>
                <i style={{ background: colorOf(glaze.card) }} />
                {glaze.name}
              </span>
            ) : (
              <button key={glaze.id} type="button" className={picks.some((pick) => pick.id === glaze.id) ? '' : 'ghost'} onClick={() => toggle(glaze.id)}>
                {glaze.name}
              </button>
            )
          ))}
        </div>
        {picks.map((pick) => {
          const glaze = glazeData.glazes.find((item) => item.id === pick.id)
          if (!glaze) return null
          return (
            <div key={pick.id} className="card" style={{ borderColor: colorOf(glaze.card) }}>
              <header>
                <b>{glaze.name}</b>
                <small>{glaze.tempMin}–{glaze.tempMax}℃ · {t('ui.concentration')} {pick.concentration.toFixed(2)}</small>
              </header>
              <p>{glaze.kiln}</p>
              <div className="row">
                {[1, 2, 3].map((layers) => (
                  <button key={layers} type="button" className={pick.layers === layers ? '' : 'ghost'} onClick={() => setLayers(glaze.id, layers)}>
                    {layers} {t('ui.layerUnit')}
                  </button>
                ))}
              </div>
              {!webgl ? (
                <span className="stepper">
                  <button type="button" onClick={() => setConcentration(glaze.id, clamp(pick.concentration - 0.05, 0.3, 1))}>−</button>
                  <button type="button" onClick={() => setConcentration(glaze.id, clamp(pick.concentration + 0.05, 0.3, 1))}>+</button>
                </span>
              ) : null}
            </div>
          )
        })}
        {preview?.rimCovered ? <p className="warn">{t('ui.rimWarn')}</p> : null}
        {preview?.warned ? <p className="warn">{t('ui.glazeWarn')}</p> : null}
        {preview?.footRisk ? <p className="warn">{t('ui.footWarn')}</p> : null}
        <p className="fine">{t('ui.brush')} {Math.round(ring * 100)}% · {t('ui.wipeRim')}</p>
        {!webgl ? (
          <span className="stepper">
            <button type="button" onClick={() => setRing((value) => clamp(value - 0.05, 0, 1))}>−</button>
            <button type="button" onClick={() => setRing((value) => clamp(value + 0.05, 0, 1))}>+</button>
          </span>
        ) : null}
        <div className="row">
          <button type="button" className="ghost" onClick={brush} disabled={short || stock - cost < glazeData.brushCost}>
            {t('ui.brush')}
          </button>
          <button type="button" disabled={!locked && (picks.length !== 2 || short)} onClick={enterKiln}>
            {locked ? t('ui.demo') : t('ui.toFire')}
          </button>
          {run.bisque?.brittle ? (
            <button type="button" className="ghost" onClick={() => session.setRun(retryStage({ ...session.get().run!, stage: 'dry' }, false, novice, run.practice))}>
              {t('ui.backDry')}
            </button>
          ) : null}
          {!locked ? (
            <button type="button" className="ghost" onClick={() => session.setRun(retryStage(session.get().run!, false, novice, run.practice))}>
              {t('ui.retryStage')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
