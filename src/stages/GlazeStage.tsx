import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import glazeData from '../data/glaze.json'
import { t } from '../content/text'
import { useStudio } from '../render/StudioScene'
import { focusCamera } from '../render/studio'
import { createFigure, type Figure, type GlazeState, type PoseName, type ShapeParams } from '../render/figure'
import type { Part, Split } from '../game/types'

const EMPTY: GlazeState = { head: 'none', body: 'none', arms: 'none', legs: 'none' }

/** ⑥ 上釉：选一种釉，点身体 → 涂上去。看到的是生釉色，入窑后才知道成品色。 */
export function GlazeStage({
  split,
  params,
  pose,
}: {
  split: Split
  params: ShapeParams
  pose: PoseName
}) {
  const figureRef = useRef<Figure | null>(null)
  const glazeRef = useRef('ash')
  const [glaze, setGlaze] = useState('ash')
  const [painted, setPainted] = useState<GlazeState>({ ...EMPTY })
  const [fired, setFired] = useState(false)
  glazeRef.current = glaze

  useStudio((studio) => {
    const figure = createFigure(split)
    figure.group.position.copy(studio.tableTop)
    figure.setShape(params)
    figure.setPose(pose)
    studio.scene.add(figure.group)
    figureRef.current = figure

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null

    const paint = (e: PointerEvent) => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, studio.camera)
      const hit = raycaster.intersectObject(figure.group, true)[0]
      const part = hit?.object.userData.part as Part | undefined
      if (!part) return
      figure.setGlaze(part, glazeRef.current)
      setPainted((prev) => ({ ...prev, [part]: glazeRef.current }))
      setFired(false)
    }
    canvas?.addEventListener('pointerdown', paint)

    studio.frame = (dt) => {
      const top = figure.getTop()
      focusCamera(studio.camera, studio.tableTop.clone().add(new THREE.Vector3(0, top * 0.46, 0)), Math.max(0.52, top * 1.75))
      figure.update(dt)
    }

    return () => {
      canvas?.removeEventListener('pointerdown', paint)
      studio.frame = null
      studio.scene.remove(figure.group)
      figure.dispose()
      figureRef.current = null
    }
  })

  useEffect(() => {
    figureRef.current?.setShape(params)
  }, [params])

  useEffect(() => {
    figureRef.current?.setPose(pose)
  }, [pose])

  function enterKiln(): void {
    figureRef.current?.fire()
    setFired(true)
  }

  const usedIds = [...new Set(Object.values(painted))].filter((id) => id !== 'none')
  const used = usedIds.map((id) => glazeData.glazes.find((g) => g.id === id)!).filter(Boolean)

  return (
    <>
      <div className="stage-head">
        <h1>{t('glaze.title')}</h1>
        <p className="hint">{t('glaze.hint')}</p>
      </div>

      <div className="stage glaze-dock">
        <div className="split-panel glaze-panel">
          <div className="glaze-swatches" role="group" aria-label={t('glaze.title')}>
            {glazeData.glazes.map((g) => (
              <button
                key={g.id}
                type="button"
                className={glaze === g.id ? 'glaze-chip is-active' : 'glaze-chip'}
                aria-pressed={glaze === g.id}
                onClick={() => setGlaze(g.id)}
              >
                <span className="glaze-dot" style={{ background: g.raw ?? '#8a5f43' }} />
                {t(g.label)}
              </button>
            ))}
          </div>

          <div className="actions">
            <button type="button" onClick={enterKiln} disabled={fired || usedIds.length === 0}>
              {fired ? t('glaze.fired') : t('glaze.fire')}
            </button>
          </div>

          {fired && used.length > 0 && (
            <ul className="glaze-result" aria-live="polite">
              <li className="glaze-result-head">{t('glaze.resultTitle')}</li>
              {used.map((g) => (
                <li key={g.id}>
                  <span className="glaze-pair">
                    <span className="glaze-dot" style={{ background: g.raw ?? '#8a5f43' }} />
                    <span className="glaze-arrow">→</span>
                    <span className="glaze-dot" style={{ background: g.fired ?? '#8a5a38' }} />
                  </span>
                  {t(g.label)}
                </li>
              ))}
            </ul>
          )}
          {!fired && <p className="save-note">{t('glaze.note')}</p>}
        </div>
      </div>
    </>
  )
}
