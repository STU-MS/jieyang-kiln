import { useEffect, useRef, useState, type PointerEvent } from 'react'
import clayData from '../data/clay.json'
import { colorOf } from '../assets/registry'
import { playCue } from '../audio/bus'
import { f, t } from '../content/text'
import { session, useSession } from '../game/session'
import { clayBodyColor } from '../render/color'
import { CupView, type CupHandle } from '../render/CupView'
import { skyColor } from '../render/scene'
import { mixClay } from '../sim/clay'
import { beginThrow, withClay } from '../sim/flow'
import { n2 } from '../sim/math'
import { useTicker } from '../ui/hooks'
import { MasterLine, Meters } from '../ui/widgets'
import type { ClayParts } from '../sim/types'

const CLAY_STEP = 5
const WATER_STEP = 2

function isClayId(id: string): id is keyof ClayParts {
  return id === 'diger' || id === 'kaolin' || id === 'aged'
}

interface Pending {
  key: number
  id: keyof ClayParts
  color: string
  amount: number
  fly: number
  absorb: number
  slot: number
}

function blendedParts(parts: ClayParts, deposits: Pending[]): ClayParts {
  const next = { ...parts }
  for (const deposit of deposits) next[deposit.id] += deposit.amount * deposit.absorb
  return next
}

function depositPatch(deposits: Pending[]) {
  return deposits.map((deposit) => ({
    key: deposit.key,
    id: deposit.id,
    color: deposit.color,
    fly: deposit.fly,
    absorb: deposit.absorb,
    slot: deposit.slot,
  }))
}

export default function MixStage({ webgl }: { webgl: boolean }) {
  const { run } = useSession()
  const state = run!
  const initial = state.clay?.parts ?? clayData.initial
  const [parts, setParts] = useState<ClayParts>({ diger: initial.diger, kaolin: initial.kaolin, aged: initial.aged })
  const [water, setWater] = useState(state.clay?.water ?? clayData.initial.water)
  const [phase, setPhase] = useState<'tune' | 'knead' | 'ready'>(state.clay && state.clay.knead > 0 ? 'ready' : 'tune')
  const [knead, setKnead] = useState(state.clay?.knead ?? 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [holding, setHolding] = useState(false)
  const elapsed = useRef(0)
  const cueMark = useRef(0)
  const scored = useRef((state.clay?.knead ?? 0) > 0)
  const cup = useRef<CupHandle>(null)
  const live = useRef({ parts, water })
  live.current = { parts, water }
  const holdingRef = useRef(false)
  const phaseRef = useRef(phase)
  holdingRef.current = holding
  phaseRef.current = phase
  const pending = useRef<Pending[]>([])
  const depositKey = useRef(1)
  const [depositOn, setDepositOn] = useState(false)
  const pours = useRef<{ key: number; fly: number }[]>([])
  const [pourOn, setPourOn] = useState(false)
  const [floaters, setFloaters] = useState<{ kind: 'iron'; value: number; pulse: number; leaving?: boolean }[]>([])
  const popGen = useRef(0)
  const motion = useRef<'rest' | 'toss' | 'rise'>('rest')
  const motionT = useRef(0)
  const [motionOn, setMotionOn] = useState(false)
  const preview = mixClay(parts, water, state.humidity, phase === 'ready' ? knead : 0.5)
  const color = clayBodyColor(blendedParts(parts, pending.current))

  useEffect(() => {
    if ((state.clay?.knead ?? 0) === 0 && phase === 'ready') {
      elapsed.current = 0
      cueMark.current = 0
      scored.current = false
      setKnead(0)
      setHolding(false)
      setPhase('tune')
    }
  }, [state.clay?.knead, phase])

  useTicker(holding && phase === 'knead', (dt) => {
    if (dt <= 0) return
    cup.current?.update({ kneading: true })
    elapsed.current += dt
    const mark = Math.floor(elapsed.current / 1.6)
    if (mark > cueMark.current) {
      cueMark.current = mark
      playCue('knead')
    }
    if (elapsed.current >= clayData.kneadSeconds && !scored.current) {
      scored.current = true
      const nextClay = mixClay(live.current.parts, live.current.water, state.humidity, 1)
      setKnead(1)
      setPhase('ready')
      session.setRun(withClay(session.get().run!, nextClay))
    }
  })

  useEffect(() => {
    cup.current?.update({
      mode: 'mix',
      color,
      sky: skyColor(state.weather),
      wet: water / clayData.waterMax,
      bench: {
        water,
        parts,
        colors: {
          diger: colorOf('ui.clay.diger'),
          kaolin: colorOf('ui.clay.kaolin'),
          aged: colorOf('ui.clay.aged'),
        },
        selected: selected ?? undefined,
      },
      deposits: depositPatch(pending.current),
      kneading: holding,
    })
  })

  useTicker(depositOn, (dt) => {
    if (dt <= 0 || pending.current.length === 0) return
    const finished: Pending[] = []
    let moved = false
    for (const deposit of pending.current) {
      if (deposit.fly < 1) {
        deposit.fly = Math.min(1, deposit.fly + dt / 0.55)
        moved = true
      } else if (holdingRef.current && deposit.absorb < 1) {
        deposit.absorb = Math.min(1, deposit.absorb + dt / 1.7)
        moved = true
        if (deposit.absorb >= 1) finished.push(deposit)
      }
    }
    if (finished.length > 0) {
      const done = new Set(finished.map((deposit) => deposit.key))
      pending.current = pending.current.filter((deposit) => !done.has(deposit.key))
      for (const deposit of finished) commitDeposit(deposit)
      if (pending.current.length === 0) setDepositOn(false)
    }
    if (moved || finished.length > 0) {
      cup.current?.update({
        deposits: depositPatch(pending.current),
        color: clayBodyColor(blendedParts(live.current.parts, pending.current)),
      })
    }
  })

  useTicker(pourOn, (dt) => {
    if (dt <= 0 || pours.current.length === 0) return
    const finished: number[] = []
    for (const pour of pours.current) {
      pour.fly += dt / 0.55
      if (pour.fly >= 1.5) finished.push(pour.key)
    }
    if (finished.length > 0) {
      const done = new Set(finished)
      pours.current = pours.current.filter((pour) => !done.has(pour.key))
      for (let i = 0; i < finished.length; i++) commitPour()
      if (pours.current.length === 0) setPourOn(false)
    }
    cup.current?.update({ pours: pours.current.map((pour) => ({ ...pour })) })
  })

  useTicker(motionOn, (dt) => {
    if (dt <= 0 || motion.current === 'rest') return
    if (motion.current === 'toss') {
      motionT.current = Math.min(1, motionT.current + dt / 0.74)
      cup.current?.update({ ballAct: { kind: 'toss', t: motionT.current } })
      if (motionT.current >= 1) {
        const freshParts = resetMix()
        motion.current = 'rise'
        motionT.current = 0
        cup.current?.update({
          ballAct: { kind: 'rise', t: 0 },
          color: clayBodyColor(freshParts),
          deposits: [],
          pours: [],
          kneading: false,
        })
      }
      return
    }
    motionT.current = Math.min(1, motionT.current + dt / 0.86)
    cup.current?.update({ ballAct: { kind: 'rise', t: motionT.current } })
    if (motionT.current >= 1) {
      motion.current = 'rest'
      setMotionOn(false)
      cup.current?.update({ ballAct: { kind: 'rest', t: 1 } })
    }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selected || motion.current !== 'rest' || event.target instanceof HTMLInputElement) return
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (selected !== 'water' && event.key === 'ArrowDown') return
      if (selected !== 'water') {
        spawnDeposit(selected)
        return
      }
      if (event.key === 'ArrowUp') spawnPour()
      else writeAmount(selected, readAmount(selected) - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function readAmount(id: string): number {
    if (id === 'water') return live.current.water
    return live.current.parts[id as keyof ClayParts] ?? 0
  }

  function writeAmount(id: string, value: number) {
    if (!Number.isFinite(value)) return
    if (id === 'water') setWater(Math.max(0, Math.round(value)))
    else if (isClayId(id)) setParts((prev) => ({ ...prev, [id]: Math.max(0, Math.round(value)) }))
  }

  function beginHold() {
    if (phase === 'tune') {
      elapsed.current = 0
      cueMark.current = 0
      scored.current = false
      setPhase('knead')
    }
    setHolding(true)
    cup.current?.update({ kneading: true, mode: 'mix' })
    playCue('knead')
  }

  function endHold() {
    setHolding(false)
    cup.current?.update({ kneading: false, mode: 'mix' })
  }

  function resetMix() {
    const fresh = clayData.initial
    const nextParts = { diger: fresh.diger, kaolin: fresh.kaolin, aged: fresh.aged }
    setParts(nextParts)
    setWater(fresh.water)
    setKnead(0)
    setHolding(false)
    holdingRef.current = false
    setSelected(null)
    setPhase('tune')
    elapsed.current = 0
    cueMark.current = 0
    scored.current = false
    pending.current = []
    pours.current = []
    setDepositOn(false)
    setPourOn(false)
    popGen.current += 1
    setFloaters([])
    live.current = { parts: nextParts, water: fresh.water }
    const runNow = session.get().run
    if (runNow) session.setRun(withClay(runNow, mixClay(nextParts, fresh.water, runNow.humidity, 0)))
    return nextParts
  }

  function discard() {
    if (motion.current !== 'rest') return
    setHolding(false)
    holdingRef.current = false
    pending.current = []
    pours.current = []
    setDepositOn(false)
    setPourOn(false)
    if (!webgl) {
      resetMix()
      cup.current?.update({ kneading: false, mode: 'mix', deposits: [], pours: [], ballAct: { kind: 'rest', t: 1 } })
      return
    }
    motion.current = 'toss'
    motionT.current = 0
    setMotionOn(true)
    cup.current?.update({
      kneading: false,
      mode: 'mix',
      deposits: [],
      pours: [],
      ballAct: { kind: 'toss', t: 0 },
    })
  }

  function spawnPour() {
    if (motion.current !== 'rest' || !Number.isFinite(WATER_STEP) || WATER_STEP <= 0) return
    const key = depositKey.current++
    pours.current.push({ key, fly: 0 })
    setPourOn(true)
    cup.current?.update({ pours: pours.current.map((pour) => ({ ...pour })) })
  }

  function commitPour() {
    const next = Math.max(0, Math.round(live.current.water + WATER_STEP))
    live.current = { ...live.current, water: next }
    setWater(next)
  }

  function spawnDeposit(id: string) {
    if (motion.current !== 'rest' || !isClayId(id) || !Number.isFinite(CLAY_STEP) || CLAY_STEP <= 0) return
    const clay = clayData.clays.find((item) => item.id === id)
    if (!clay) return
    const key = depositKey.current++
    pending.current.push({
      key,
      id,
      color: colorOf(clay.card),
      amount: CLAY_STEP,
      fly: 0,
      absorb: 0,
      slot: key,
    })
    setDepositOn(true)
    cup.current?.update({ deposits: depositPatch(pending.current) })
  }

  function commitDeposit(deposit: Pending) {
    if (!isClayId(deposit.id) || !Number.isFinite(deposit.amount) || deposit.amount <= 0) return
    const prev = live.current.parts
    const waterNow = live.current.water
    const before = mixClay(prev, waterNow, state.humidity, 0)
    const next = { ...prev, [deposit.id]: Math.max(0, Math.round(prev[deposit.id] + deposit.amount)) }
    const after = mixClay(next, waterNow, state.humidity, 0)
    live.current = { parts: next, water: waterNow }
    setParts(next)
    const runNow = session.get().run
    if (runNow?.clay) session.setRun(withClay(runNow, mixClay(next, waterNow, runNow.humidity, runNow.clay.knead)))
    const delta = Math.round((after.I - before.I) * 100) / 100
    if (delta !== 0) pushIron(delta)
  }

  function pushIron(delta: number) {
    const gen = ++popGen.current
    setFloaters((list) => {
      const hit = list.find((item) => item.kind === 'iron')
      if (!hit) return [{ kind: 'iron', value: delta, pulse: 1 }]
      return [{ kind: 'iron', value: Math.round((hit.value + delta) * 100) / 100, pulse: hit.pulse + 1 }]
    })
    window.setTimeout(() => {
      if (popGen.current !== gen) return
      setFloaters((list) => list.map((item) => item.kind === 'iron' ? { ...item, leaving: true } : item))
    }, 1100)
    window.setTimeout(() => {
      if (popGen.current !== gen) return
      setFloaters((list) => list.filter((item) => item.kind !== 'iron'))
    }, 1400)
  }

  function onDown(event: PointerEvent<HTMLDivElement>) {
    if (motion.current !== 'rest') return
    if (event.target instanceof Element && event.target.closest('.master-pop, .bench-ui, .confirm-tick')) return
    const id = cup.current?.pick(event.clientX, event.clientY)
    if (id === 'bin') {
      discard()
      return
    }
    if (id === 'ball' || (!webgl && !id)) {
      beginHold()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      return
    }
    if (!id || (id !== 'water' && !(id in live.current.parts))) return
    setSelected(id)
    if (id === 'water') spawnPour()
    else spawnDeposit(id)
  }

  const noteP = preview.P < clayData.sweet.P[0] ? t('ui.note.hard') : preview.P > clayData.sweet.P[1] ? t('ui.note.soft') : t('ui.note.ok')
  const noteH = preview.H < clayData.sweet.H[0] ? t('ui.note.damp') : preview.H > clayData.sweet.H[1] ? t('ui.note.hard') : t('ui.note.ok')
  const cost = preview.C < 180 ? t('ui.cost.low') : preview.C > 280 ? t('ui.cost.high') : t('ui.cost.mid')

  return (
    <div className="layout">
      <div className="stage-view gesture" onPointerDown={onDown} onPointerUp={endHold} onPointerCancel={endHold}>
        <CupView ref={cup} webgl={webgl} mode="mix" color={color} sky={skyColor(state.weather)} />
        {floaters.map((item) => {
          const n = `${item.value >= 0 ? '+' : ''}${item.value.toFixed(2)}`
          return (
            <p key={item.kind} className={item.leaving ? 'iron-pop leaving' : 'iron-pop'}>
              <span key={item.pulse}>{f('ui.ironPop', { n })}</span>
            </p>
          )
        })}
        <MasterLine id="lines.mix" />
        {phase === 'ready' ? (
          <button
            type="button"
            className="confirm-tick"
            aria-label={t('ui.toThrow')}
            onClick={() => {
              const clay = mixClay(parts, water, state.humidity, knead)
              session.setRun(beginThrow(withClay(session.get().run!, clay)))
              playCue('wheel')
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        {!webgl ? (
          <div className="bench-ui">
            <button type="button" className={selected === 'water' ? '' : 'ghost'} onClick={() => { setSelected('water'); spawnPour() }}>{t('ui.water')}</button>
            {clayData.clays.map((clay) => (
              <button key={clay.id} type="button" className={selected === clay.id ? '' : 'ghost'} onClick={() => { setSelected(clay.id); spawnDeposit(clay.id) }}>
                {clay.name}
              </button>
            ))}
            <button type="button" className="ghost" onClick={discard}>{t('ui.discard')}</button>
            {selected ? (
              <span className="stepper">
                <button type="button" onClick={() => writeAmount(selected, readAmount(selected) - (selected === 'water' ? 1 : 2))} aria-label={`${selected} -`}>−</button>
                <button type="button" onClick={() => selected === 'water' ? spawnPour() : spawnDeposit(selected)} aria-label={`${selected} +`}>+</button>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="panel">
        <Meters
          items={[
            { id: 'p', label: t('ui.meter.p'), value: n2(preview.P), note: noteP, amount: preview.P, gauge: { min: -0.05, max: 0.62, stops: [...clayData.sweet.P] } },
            { id: 'h', label: t('ui.meter.h'), value: n2(preview.H), note: noteH, amount: preview.H, gauge: { min: -0.25, max: 0.75, stops: [...clayData.sweet.H] } },
            { id: 'i', label: t('ui.meter.i'), value: n2(preview.I), note: t('ui.note.ok'), amount: preview.I, gauge: { min: 0, max: 0.75, stops: [0.25, 0.5], tones: ['low', 'mid', 'high'] } },
            { id: 'c', label: t('ui.meter.c'), value: String(Math.round(preview.C)), note: cost, amount: preview.C, gauge: { min: 0, max: 420, stops: [180, 280] } },
          ]}
        />
      </div>
    </div>
  )
}
