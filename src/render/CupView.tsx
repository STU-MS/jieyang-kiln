import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { registerFrame } from '../sim/clock'
import difficulty from '../data/difficulty.json'
import { swayOffset, WorkshopScene, type ScenePatch, type SurfaceHit } from './scene'

export interface CupHandle {
  update: (patch: ScenePatch) => void
  capture: () => string
  pick: (x: number, y: number) => string | null
  probe: (x: number, y: number, snap?: boolean) => SurfaceHit | null
  placeFinger: (hit: SurfaceHit | null) => void
  stroke: (x: number, y: number, dx: number, dy: number, snap?: boolean) => { t: number; dr: number; dy: number; ang: number } | null
  dragAt: (x: number, y: number, z: number, dx: number, dy: number) => { dr: number; dy: number } | null
  fingerCenter: (hit: SurfaceHit) => { x: number; y: number; z: number }
  pointOnCup: (x: number, y: number, z: number) => { radial: number; t: number; ang: number }
  cursorOnPlane: (x: number, y: number, ax: number, ay: number, az: number) => { x: number; y: number; z: number } | null
  orbitThrow: (dx: number, dy: number) => void
  wheelAngle: () => number
}

interface Props extends ScenePatch {
  webgl: boolean
  onDowngrade?: () => void
}

export const CupView = forwardRef<CupHandle, Props>(function CupView(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<WorkshopScene | null>(null)
  const patchRef = useRef<ScenePatch>(props)
  const [svg, setSvg] = useState<ScenePatch>(props)
  const svgTimer = useRef(0)

  useImperativeHandle(ref, () => ({
    update(patch) {
      patchRef.current = { ...patchRef.current, ...patch }
      sceneRef.current?.apply(patch)
      if (!props.webgl) {
        const now = performance.now()
        if (now - svgTimer.current > 80) {
          svgTimer.current = now
          setSvg({ ...patchRef.current })
        }
      }
    },
    capture() {
      return sceneRef.current?.capture() ?? ''
    },
    pick(x, y) {
      return sceneRef.current?.pick(x, y) ?? null
    },
    probe(x, y, snap = true) {
      return sceneRef.current?.probeCup(x, y, snap) ?? null
    },
    placeFinger(hit) {
      sceneRef.current?.placeFinger(hit)
    },
    stroke(x, y, dx, dy, snap = true) {
      return sceneRef.current?.strokeCup(x, y, dx, dy, snap) ?? null
    },
    dragAt(x, y, z, dx, dy) {
      return sceneRef.current?.dragAt(x, y, z, dx, dy) ?? null
    },
    fingerCenter(hit) {
      return sceneRef.current?.fingerCenter(hit) ?? { x: hit.x, y: hit.y, z: hit.z }
    },
    pointOnCup(x, y, z) {
      return sceneRef.current?.pointOnCup(x, y, z) ?? { radial: 0, t: 0, ang: 0 }
    },
    cursorOnPlane(x, y, ax, ay, az) {
      return sceneRef.current?.cursorOnPlane(x, y, ax, ay, az) ?? null
    },
    orbitThrow(dx, dy) {
      sceneRef.current?.orbitThrow(dx, dy)
    },
    wheelAngle() {
      return sceneRef.current?.wheelAngle() ?? 0
    },
  }))

  useEffect(() => {
    if (!props.webgl || !canvasRef.current) return
    const scene = new WorkshopScene(canvasRef.current)
    sceneRef.current = scene
    scene.apply(patchRef.current)
    scene.resize()
    let raf = 0
    let last = performance.now()
    let streak = 0
    let quality: 'high' | 'low' = 'high'
    let downgraded = false
    const loop = () => {
      const now = performance.now()
      const frameMs = now - last
      last = now
      if (!document.hidden) {
        const next = registerFrame(streak, frameMs, quality, difficulty.frameBudgetMs, difficulty.badFramesBeforeDowngrade)
        streak = next.streak
        if (next.quality !== quality) {
          quality = next.quality
          scene.apply({ quality })
          if (!downgraded) {
            downgraded = true
            props.onDowngrade?.()
          }
        }
        scene.frame(Math.min(0.1, frameMs / 1000))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const target = canvasRef.current.parentElement ?? canvasRef.current
    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(target)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [props.webgl])

  if (!props.webgl) return <CupSvg patch={svg.radii ? svg : props} />
  return <canvas ref={canvasRef} className="cup-canvas" />
})

function CupSvg({ patch }: { patch: ScenePatch }) {
  const radii = patch.radii && patch.radii.length > 2 ? patch.radii : [0.38, 0.5, 0.72, 0.8, 1]
  const color = patch.color ?? '#8C4030'
  const glaze = patch.glaze ?? color
  const phase = performance.now() / 1000 * 2.8
  const sway = patch.sway ?? 0
  const left: string[] = []
  const right: string[] = []
  const heights = patch.heights && patch.heights.length === radii.length ? patch.heights : null
  radii.forEach((radius, index) => {
    const h = heights ? heights[index] : index / (radii.length - 1)
    const y = 210 - h * 180
    const lean = swayOffset(h, sway, phase).x * 78
    const x = radius * 78
    left.push(`${index === 0 ? 'M' : 'L'} ${160 - x + lean} ${y}`)
    right.push(`L ${160 + x + lean} ${y}`)
  })
  const d = `${left.join(' ')} L 160 30 ${right.reverse().join(' ')} Z`
  return (
    <svg className="cup-svg" viewBox="0 0 320 240" role="img">
      <rect width="320" height="240" fill={patch.sky ?? '#E7D3B0'} />
      <path d={d} fill={patch.glazeMix ? glaze : color} stroke="#3A332C" strokeWidth="2" />
      {patch.crack ? <path d="M150 70 L168 120 L150 160" fill="none" stroke="#3A332C" strokeDasharray="4 3" /> : null}
      {patch.pinhole ? <circle cx="180" cy="110" r="4" fill="#3A332C" /> : null}
      {patch.crazing ? <path d="M120 90 H200 M140 130 H190 M130 150 H210" stroke="#3A332C" strokeWidth="1" /> : null}
    </svg>
  )
}
