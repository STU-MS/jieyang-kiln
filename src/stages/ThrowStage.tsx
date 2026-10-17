import { useEffect, useRef, useState } from 'react'
import difficulty from '../data/difficulty.json'
import throwing from '../data/throwing.json'
import clayData from '../data/clay.json'
import { colorOf } from '../assets/registry'
import { playCue } from '../audio/bus'
import { t } from '../content/text'
import { session, useSession } from '../game/session'
import { mixHex } from '../render/color'
import { CupView, type CupHandle } from '../render/CupView'
import { skyColor, type SurfaceHit } from '../render/scene'
import { collapseToMix, finishThrow, needsDemo, retryStage } from '../sim/flow'
import { clamp } from '../sim/math'
import { contactPush, cylinderRadii, sectorShells, shapeWall, smoothWall, stepWall, touchFromOutside, wallFromRadii, wallShell, type ThrowTool, type WallState } from '../sim/throwing'
import { runDemo, useTicker } from '../ui/hooks'
import { MasterLine, Meters, Modal } from '../ui/widgets'

type PressLock = {
  t: number
  radial: number
  fromOutside: boolean
  ang: number
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
  inner: boolean
  snapped: boolean
  homeX: number
  homeY: number
  homeZ: number
  grabX: number
  grabY: number
  gapR: number
  gapT: number
  planeR: number
  planeT: number
  clayR: number
  clayT: number
}

export default function ThrowStage({ webgl, onDone, onRestart }: { webgl: boolean; onDone: () => void; onRestart: () => void }) {
  const { profile } = useSession()
  const cup = useRef<CupHandle>(null)
  const zone = useRef<HTMLDivElement>(null)
  const run = session.get().run!
  const clay = run.clay!
  const ctrl = useRef({ rpm: 360 })
  const point = useRef({ x: 0, y: 0, inside: false, left: false, right: false })
  const stroke = useRef({ dx: 0, dy: 0 })
  const warned = useRef(false)
  const opening = run.radii.length > 2 ? run.radii.slice() : cylinderRadii()
  const tool = useRef<ThrowTool>('column')
  const sim = useRef({
    radii: opening,
    wall: wallFromRadii(opening) as WallState,
    over: false,
    touch: null as number | null,
    press: null as null | PressLock,
  })
  const [hud, setHud] = useState({
    rpm: 360,
    foot: 0.7,
    belly: 0.7,
    mouth: 0.7,
    s: 0,
    dot: null as { x: number; y: number } | null,
    arrow: null as { x: number; y: number; dx: number; dy: number } | null,
  })
  const [modal, setModal] = useState<null | 'total'>(null)
  const [toolHud, setToolHud] = useState<ThrowTool>('column')
  const color = mixHex(clayData.clays.map((item) => ({ color: colorOf(item.card), weight: clay.parts[item.id as 'diger'] || 0.001 })))
  const novice = profile.clearCount < difficulty.noviceClears

  useEffect(() => {
    const el = zone.current
    if (!el) return
    const ui = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('.rpm-rail, .master-pop, .confirm-tick, .throw-tools'))
    const hideFinger = () => {
      cup.current?.placeFinger(null)
      el.classList.remove('finger-on')
      setHud((prev) => (prev.dot ? { ...prev, dot: null } : prev))
    }
    const down = (event: PointerEvent) => {
      if (ui(event.target)) return
      if (event.button !== 0 && event.button !== 2) return
      el.setPointerCapture?.(event.pointerId)
      point.current = {
        x: event.clientX,
        y: event.clientY,
        inside: true,
        left: event.button === 0 || point.current.left,
        right: event.button === 2 || point.current.right,
      }
      if (event.button === 2) {
        event.preventDefault()
        stroke.current.dx = 0
        stroke.current.dy = 0
        el.classList.add('orbiting')
        hideFinger()
        return
      }
      if (event.button === 0) {
        const hit = cup.current?.probe(event.clientX, event.clientY, true) ?? null
        const center = hit ? cup.current?.fingerCenter(hit) : null
        const under = hit && center ? cup.current?.cursorOnPlane(event.clientX, event.clientY, center.x, center.y, center.z) ?? center : null
        const placed = under ? cup.current?.pointOnCup(under.x, under.y, under.z) : null
        sim.current.press = hit && center && under && placed
          ? {
              t: hit.t,
              radial: hit.radial,
              fromOutside: !hit.inner,
              ang: placed.ang,
              x: under.x,
              y: under.y,
              z: under.z,
              nx: hit.nx,
              ny: hit.ny,
              nz: hit.nz,
              inner: hit.inner,
              snapped: hit.snapped,
              homeX: center.x,
              homeY: center.y,
              homeZ: center.z,
              grabX: event.clientX,
              grabY: event.clientY,
              gapR: placed.radial - hit.radial,
              gapT: placed.t - hit.t,
              planeR: placed.radial,
              planeT: placed.t,
              clayR: hit.radial,
              clayT: hit.t,
            }
          : null
        if (hit && under) cup.current?.placeFinger({ ...hit, x: under.x, y: under.y, z: under.z, center: true })
      }
    }
    const move = (event: PointerEvent) => {
      const prev = point.current
      const right = (event.buttons & 2) !== 0
      const left = (event.buttons & 1) !== 0
      const overUi = ui(event.target)
      point.current = { x: event.clientX, y: event.clientY, inside: !overUi, left, right }
      if (right) {
        stroke.current.dx = 0
        stroke.current.dy = 0
        if (prev.right) cup.current?.orbitThrow(event.clientX - prev.x, event.clientY - prev.y)
        el.classList.add('orbiting')
        hideFinger()
        return
      }
      el.classList.remove('orbiting')
      if (overUi) {
        hideFinger()
        return
      }
      const stepX = event.clientX - prev.x
      const stepY = event.clientY - prev.y
      if (webgl) {
        if (left && sim.current.press) {
          if (prev.left) {
            stroke.current.dx += stepX
            stroke.current.dy += stepY
          }
          cup.current?.placeFinger(fingerFromPress(sim.current.press))
          el.classList.add('finger-on')
          return
        }
        const hit = cup.current?.probe(event.clientX, event.clientY, true) ?? null
        cup.current?.placeFinger(hit)
        el.classList.toggle('finger-on', Boolean(hit))
        return
      }
      const hit = svgHit(el, sim.current.radii, event.clientX, event.clientY)
      if (left && prev.left && hit) {
        stroke.current.dx += stepX
        stroke.current.dy += stepY
      }
      const dot = hit ? toLocal(el, hit.px, hit.py) : null
      setHud((prevHud) => ({ ...prevHud, dot }))
      el.classList.toggle('finger-on', Boolean(hit))
    }
    const up = (event: PointerEvent) => {
      if (event.button === 2) {
        point.current.right = false
        el.classList.remove('orbiting')
      }
      if (event.button === 0) {
        point.current.left = false
        sim.current.press = null
      }
    }
    const leave = (event: PointerEvent) => {
      if (event.buttons !== 0) return
      point.current.inside = false
      point.current.left = false
      point.current.right = false
      hideFinger()
    }
    const menu = (event: Event) => event.preventDefault()
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      ctrl.current.rpm = clamp(ctrl.current.rpm - event.deltaY * 0.35, throwing.rpmMin, throwing.rpmMax)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('contextmenu', menu)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('contextmenu', menu)
      el.removeEventListener('wheel', wheel)
    }
  }, [webgl])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowLeft') ctrl.current.rpm = clamp(ctrl.current.rpm - 20, throwing.rpmMin, throwing.rpmMax)
      if (event.key === 'ArrowRight') ctrl.current.rpm = clamp(ctrl.current.rpm + 20, throwing.rpmMin, throwing.rpmMax)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!modal) return
    point.current.inside = false
    point.current.left = false
    sim.current.press = null
    cup.current?.placeFinger(null)
    zone.current?.classList.remove('finger-on', 'orbiting')
  }, [modal])

  useTicker(!modal, (dt) => {
    const live = sim.current
    const stepDt = Math.min(dt, 0.1)
    if (live.over || stepDt <= 0) return
    const cursor = point.current
    const zoneEl = zone.current
    const tracking = Boolean(cursor.inside && !cursor.right && zoneEl)
    const contact = tracking && zoneEl ? feelWall(zoneEl, cursor.x, cursor.y, webgl, live.radii, cup.current, !cursor.left) : null
    const spin = throwing.rpmMax > 0 ? ctrl.current.rpm / throwing.rpmMax : 0
    const dragX = stroke.current.dx
    const dragY = stroke.current.dy
    stroke.current.dx = 0
    stroke.current.dy = 0
    const step = stepWall(live.wall, {
      dt: stepDt,
      rpm: ctrl.current.rpm,
      waterNorm: clay.water / clayData.waterMax,
      P: clay.P,
      poor: clay.quality === 'poor',
      waterZero: clay.waterZero,
    })
    let arrow: { x: number; y: number; dx: number; dy: number } | null = null
    if (!cursor.left || cursor.right) live.press = null
    const press = cursor.left && !cursor.right ? live.press : null
    if (press && webgl && zoneEl) {
      const now = cup.current?.cursorOnPlane(cursor.x, cursor.y, press.homeX, press.homeY, press.homeZ) ?? null
      if (now) {
        const ball = cup.current?.pointOnCup(now.x, now.y, now.z) ?? null
        if (ball) {
          const local = ball.ang - (cup.current?.wheelAngle() ?? 0)
          const handT = ball.t - press.gapT
          if (tool.current === 'smooth') {
            const top = live.wall.y[live.wall.y.length - 1] ?? 1
            const yNow = Math.min(top, Math.max(0, handT))
            smoothWall(live.wall, press.clayT, yNow)
            let near = 0
            let best = Infinity
            for (let i = 0; i < live.wall.y.length; i++) {
              const dist = Math.abs((live.wall.y[i] ?? 0) - yNow)
              if (dist < best) {
                best = dist
                near = i
              }
            }
            const surface = Math.max(0.04, live.wall.r[near] ?? 0.7)
            press.clayT = yNow
            press.t = yNow
            press.radial = surface
            press.clayR = surface
            press.x = now.x
            press.y = now.y
            press.z = now.z
            press.ang = ball.ang
            live.touch = local
          } else if (tool.current === 'radial') {
            const face = Math.max(0.04, ball.radial - press.gapR)
            let dr = face - press.clayR
            const cap = 0.4
            if (Math.abs(dr) > cap) dr = Math.sign(dr) * cap
            if (dr !== 0) {
              shapeWall(live.wall, press.clayT, dr, 0, 'column')
              press.clayR = Math.max(0.04, press.clayR + dr)
            }
            press.t = press.clayT
            press.radial = face
            press.x = now.x
            press.y = now.y
            press.z = now.z
            press.ang = ball.ang
            live.touch = local
          } else {
          const outside = touchFromOutside(live.wall, local, handT, ball.radial - press.gapR)
          press.fromOutside = outside
          const face = ball.radial - press.gapR
          const frameR = ball.radial - press.planeR
          const frameH = ball.t - press.planeT
          const frame = contactPush(outside, frameR, frameH)
          const moved = Math.hypot(frameR, frameH) > 1e-4
          const retreat = moved && frame.dr === 0 && frame.dy === 0
          if (retreat) {
            press.clayR = Math.max(0.04, face)
            press.clayT = Math.max(0, handT)
          } else {
            const into = outside ? press.clayR - face : face - press.clayR
            let dr = into > 0 ? (outside ? -into : into) : 0
            let dy = handT - press.clayT
            const mag = Math.hypot(dr, dy)
            const cap = 0.4
            if (mag > cap) {
              dr *= cap / mag
              dy *= cap / mag
            }
            if (dr !== 0 || dy !== 0) {
              shapeWall(live.wall, press.clayT, dr, dy, tool.current)
              press.clayR = Math.max(0.04, press.clayR + dr)
              press.clayT = Math.max(0, press.clayT + dy)
            }
            if (into <= 0) press.clayR = Math.max(0.04, face)
          }
          press.x = now.x
          press.y = now.y
          press.z = now.z
          press.planeR = ball.radial
          press.planeT = ball.t
          press.radial = Math.max(0.04, face)
          press.t = Math.max(0, handT)
          press.ang = ball.ang
          live.touch = local
          }
        }
      }
      if (dragX !== 0 || dragY !== 0) {
        const pix = Math.hypot(dragX, dragY)
        const draw = Math.min(64, Math.max(22, pix * 0.85))
        const at = toLocal(zoneEl, cursor.x, cursor.y)
        arrow = { x: at.x, y: at.y, dx: (dragX / pix) * draw, dy: (dragY / pix) * draw }
      }
    } else if (contact && zoneEl && !cursor.right && (dragX !== 0 || dragY !== 0)) {
      const gain = 0.55 + 0.45 * spin
      const moved = dragOnWall(zoneEl, cursor.x, cursor.y, dragX, dragY, webgl, live.radii, cup.current, !cursor.left)
      if (moved) {
        let dr = moved.dr * gain
        let dy = moved.dy * gain
        const mag = Math.hypot(dr, dy)
        const cap = 0.16
        if (mag > cap) {
          dr *= cap / mag
          dy *= cap / mag
        }
        if (tool.current === 'smooth') smoothWall(live.wall, moved.t, moved.t + dy)
        else if (tool.current === 'radial') shapeWall(live.wall, moved.t, dr, 0, 'column')
        else shapeWall(live.wall, moved.t, dr, dy, tool.current)
        const pix = Math.hypot(dragX, dragY)
        const draw = Math.min(64, Math.max(22, pix * 0.85))
        const origin = toLocal(zoneEl, cursor.x, cursor.y)
        arrow = { x: origin.x, y: origin.y, dx: (dragX / pix) * draw, dy: (dragY / pix) * draw }
      }
      live.touch = null
    } else if (webgl && contact?.ang != null) {
      live.touch = contact.ang - (cup.current?.wheelAngle() ?? 0)
    } else live.touch = null
    live.radii = live.wall.r
    const shell = wallShell(live.wall)
    const turned = sectorShells(live.wall)
    if (step.margin < 0.05 && !warned.current) {
      warned.current = true
      playCue('warn')
    } else if (step.margin > 0.25) warned.current = false
    if (step.collapsed) {
      live.over = true
      setModal('total')
    }
    cup.current?.update({
      mode: 'throw',
      radii: shell.outer,
      heights: live.wall.y,
      thickness: shell.thickness,
      sectors: turned,
      color,
      rpm: ctrl.current.rpm,
      sky: skyColor(run.weather),
      wet: clay.water / clayData.waterMax,
    })
    let dot: { x: number; y: number } | null = null
    if (tracking && zoneEl) {
      if (webgl) {
        if (live.press && cursor.left) {
          cup.current?.placeFinger(fingerFromPress(live.press))
          zoneEl.classList.add('finger-on')
        } else {
          const hit = cup.current?.probe(cursor.x, cursor.y, true) ?? null
          cup.current?.placeFinger(hit)
          zoneEl.classList.toggle('finger-on', Boolean(hit))
        }
      } else if (contact) {
        const hit = svgHit(zoneEl, live.radii, cursor.x, cursor.y)
        dot = hit ? toLocal(zoneEl, hit.px, hit.py) : null
        zoneEl.classList.toggle('finger-on', Boolean(hit))
      } else {
        zoneEl.classList.remove('finger-on')
      }
    }
    setHud({
      rpm: Math.round(ctrl.current.rpm),
      foot: band(live.radii, 0, 0.14),
      belly: band(live.radii, 0.36, 0.56),
      mouth: band(live.radii, 0.88, 1),
      s: step.margin,
      dot,
      arrow,
    })
  })

  function redoThrow() {
    setModal(null)
    warned.current = false
    point.current.left = false
    point.current.right = false
    stroke.current.dx = 0
    stroke.current.dy = 0
    session.setRun(retryStage({ ...session.get().run!, radii: sim.current.radii }, true, novice, run.practice))
    sim.current.over = false
    sim.current.touch = null
    sim.current.press = null
    sim.current.radii = cylinderRadii()
    sim.current.wall = wallFromRadii(sim.current.radii)
  }

  function pickTool(next: ThrowTool) {
    tool.current = next
    setToolHud(next)
  }

  function commitShape() {
    const shell = wallShell(sim.current.wall)
    const next = finishThrow(session.get().run!, shell.outer, shell.thickness, novice, run.practice)
    session.setRun(next)
  }

  function setRpm(next: number) {
    ctrl.current.rpm = clamp(next, throwing.rpmMin, throwing.rpmMax)
    setHud((prev) => ({ ...prev, rpm: Math.round(ctrl.current.rpm) }))
  }

  const demo = needsDemo(run.retries + 1)

  return (
    <div className="layout">
      <div className="stage-view gesture" ref={zone}>
        <CupView ref={cup} webgl={webgl} mode="throw" radii={sim.current.radii} color={color} />
        {hud.dot ? <i className="finger-ball" style={{ left: hud.dot.x, top: hud.dot.y }} /> : null}
        {hud.arrow ? (
          <svg className="stroke-arrow" style={{ left: hud.arrow.x, top: hud.arrow.y }} aria-hidden="true">
            <line x1="0" y1="0" x2={hud.arrow.dx} y2={hud.arrow.dy} />
            <polygon points={arrowHead(hud.arrow.dx, hud.arrow.dy)} />
          </svg>
        ) : null}
        <div className="pop-stack">
          <MasterLine id="lines.throw" />
        </div>
        <label className="rpm-rail">
          <span>{t('ui.meter.rpm')}</span>
          <input
            type="range"
            min={throwing.rpmMin}
            max={throwing.rpmMax}
            step={1}
            value={hud.rpm}
            aria-label={t('ui.meter.rpm')}
            onChange={(event) => setRpm(Number(event.target.value))}
          />
        </label>
        <div className="throw-tools" role="group" aria-label={t('ui.throwTool.group')}>
          <button type="button" className={toolHud === 'column' ? '' : 'ghost'} aria-pressed={toolHud === 'column'} aria-label={t('ui.throwTool.column')} onClick={() => pickTool('column')}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <ellipse cx="18" cy="9.5" rx="10" ry="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <ellipse cx="18" cy="9.5" rx="5.2" ry="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 9.5v16.2M28 9.5v16.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M8 25.7a10 3.1 0 0 0 20 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
          <button type="button" className={toolHud === 'radial' ? '' : 'ghost'} aria-pressed={toolHud === 'radial'} aria-label={t('ui.throwTool.radial')} onClick={() => pickTool('radial')}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <ellipse cx="18" cy="18" rx="6.2" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M6.2 18h6.2M23.6 18h6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M9.2 15.1 6.2 18l3 2.9M26.8 15.1 29.8 18l-3 2.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className={toolHud === 'smooth' ? '' : 'ghost'} aria-pressed={toolHud === 'smooth'} aria-label={t('ui.throwTool.smooth')} onClick={() => pickTool('smooth')}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <path d="M8 7c2.4 3.4-2.4 5.4 0 8.6s2.4 5.2 0 8.6-2.4 5.2 0 8.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M15.2 18h4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M17.6 15.7 20.4 18l-2.8 2.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M26.2 7c.7 5.4-.7 10.6.3 16 .5 2.6.1 5.2 0 6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <button type="button" className="confirm-tick" aria-label={t('ui.doneThrow')} onClick={commitShape}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="panel bare">
        <Meters
          items={[
            { id: 's', label: t('ui.meter.s'), value: '', note: '', amount: hud.s, gauge: { min: -2.6, max: 1.4, stops: [-2, 0], tones: ['high', 'high', 'mid'] } },
            { id: 'foot', label: t('ui.foot'), value: '', note: '', amount: hud.foot, gauge: { min: throwing.handleMin, max: throwing.handleMax, stops: [] } },
            { id: 'belly', label: t('ui.belly'), value: '', note: '', amount: hud.belly, gauge: { min: throwing.handleMin, max: throwing.handleMax, stops: [] } },
            { id: 'mouth', label: t('ui.mouth'), value: '', note: '', amount: hud.mouth, gauge: { min: throwing.handleMin, max: throwing.handleMax, stops: [] } },
          ]}
        />
      </div>
      {modal === 'total' ? (
        <Modal
          title={t('ui.totalTitle')}
          actions={demo ? [{ id: 'demo', label: t('ui.demo'), onClick: () => runDemo(onDone) }] : [
            { id: 'retry', label: t('ui.retryStage'), onClick: redoThrow },
            { id: 'back', label: t('ui.backMix'), onClick: () => session.setRun(collapseToMix(session.get().run!)) },
            { id: 'new', label: t('ui.retryRun'), onClick: onRestart },
          ]}
        >
          <p><b>{t('ui.cause')}</b> {t('ui.totalCause')}</p>
          <p><b>{t('ui.effect')}</b> {t('ui.totalEffect')}</p>
          <p><b>{t('ui.avoid')}</b> {t('ui.totalAvoid')}</p>
        </Modal>
      ) : null}
    </div>
  )
}

function fingerFromPress(press: PressLock): SurfaceHit {
  return {
    x: press.x,
    y: press.y,
    z: press.z,
    nx: press.nx,
    ny: press.ny,
    nz: press.nz,
    t: press.t,
    radial: press.radial,
    inner: press.inner,
    ang: press.ang,
    snapped: press.snapped,
    center: true,
  }
}

function dragOnWall(
  el: HTMLElement,
  x: number,
  y: number,
  dx: number,
  dy: number,
  webgl: boolean,
  radii: number[],
  view: CupHandle | null,
  snap = true,
): { t: number; dr: number; dy: number; ang?: number } | null {
  if (webgl) return view?.stroke(x, y, dx, dy, snap) ?? null
  const hit = svgHit(el, radii, x, y)
  const svg = el.querySelector('svg')
  if (!hit || !svg) return null
  const rect = svg.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const vx = (dx / rect.width) * 320
  const vy = (dy / rect.height) * 240
  const side = hit.px >= hit.cx ? 1 : -1
  return { t: hit.t, dr: (side * vx) / 78, dy: -vy / 180 }
}

function arrowHead(dx: number, dy: number): string {
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = dx - ux * 11
  const by = dy - uy * 11
  const px = -uy * 5
  const py = ux * 5
  return `${dx},${dy} ${bx + px},${by + py} ${bx - px},${by - py}`
}

function feelWall(el: HTMLElement, x: number, y: number, webgl: boolean, radii: number[], view: CupHandle | null, snap = true): { t: number; inner: boolean; ang?: number; radial?: number } | null {
  if (webgl) {
    const hit = view?.probe(x, y, snap)
    return hit ? { t: hit.t, inner: hit.inner, ang: hit.ang, radial: hit.radial } : null
  }
  const hit = svgHit(el, radii, x, y)
  return hit ? { t: hit.t, inner: hit.inner } : null
}

function band(radii: number[], a: number, b: number): number {
  const n = radii.length
  if (n === 0) return 0
  const i0 = Math.max(0, Math.round(a * (n - 1)))
  const i1 = Math.min(n - 1, Math.round(b * (n - 1)))
  let sum = 0
  for (let i = i0; i <= i1; i++) sum += radii[i]
  return sum / (i1 - i0 + 1)
}

function svgHit(el: HTMLElement, radii: number[], clientX: number, clientY: number) {
  const svg = el.querySelector('svg')
  if (!svg || radii.length < 2) return null
  const rect = svg.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const vx = ((clientX - rect.left) / rect.width) * 320
  const vy = ((clientY - rect.top) / rect.height) * 240
  const t = (210 - vy) / 180
  if (t < -0.04 || t > 1.04) return null
  const tt = clamp(t, 0, 1)
  const index = Math.round(tt * (radii.length - 1))
  const radius = (radii[index] ?? 0.4) * 78
  const dist = Math.abs(vx - 160)
  if (dist > radius + 14) return null
  const inner = dist < radius - 8
  const side = vx >= 160 ? 1 : -1
  const sx = 160 + side * radius
  return {
    t: tt,
    px: rect.left + (sx / 320) * rect.width,
    py: rect.top + (clamp(vy, 30, 210) / 240) * rect.height,
    cx: rect.left + (160 / 320) * rect.width,
    cy: rect.top + (clamp(vy, 30, 210) / 240) * rect.height,
    inner,
  }
}

function toLocal(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}
