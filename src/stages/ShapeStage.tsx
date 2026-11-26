import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import shapeData from '../data/shape.json'
import { t } from '../content/text'
import { focusCamera } from '../render/studio'
import { useStudio } from '../render/StudioScene'
import { createFigure, type Figure, type ShapeParams } from '../render/figure'
import type { Part, Split } from '../game/types'

const BIRTH_SECONDS = 0.55

/** ② 捏：滑杆抽屉，拖了立刻改形状。参数由 App 持有（这样下一段还能接着用）。 */
export function ShapeStage({
  split,
  params,
  onChange,
  onDone,
}: {
  split: Split
  params: ShapeParams
  onChange: (next: ShapeParams) => void
  onDone: () => void
}) {
  const paramsRef = useRef(params)
  paramsRef.current = params
  const figureRef = useRef<Figure | null>(null)
  const bornRef = useRef(false)

  useStudio((studio) => {
    const figure = createFigure(split)
    figure.group.position.copy(studio.tableTop)
    figure.setShape(paramsRef.current)
    figure.setGrow(0.01)
    studio.scene.add(figure.group)
    figureRef.current = figure

    // 相机推近到小人身上（每帧压一次，防止 resize 把机位拉回全景）

    let elapsed = 0
    studio.frame = (dt) => {
      
      const top = figure.getTop()
      focusCamera(studio.camera, studio.tableTop.clone().add(new THREE.Vector3(0, top * 0.35, 0)), Math.max(0.5, top * 1.6))
      if (elapsed >= BIRTH_SECONDS) return
      elapsed += dt
      const p = Math.min(1, elapsed / BIRTH_SECONDS)
      // easeOutBack：先冲过头再回来，像泥被挤出来
      const c1 = 1.70158
      const c3 = c1 + 1
      const back = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
      figure.setGrow(0.01 + 0.99 * back)
      if (p >= 1) figure.setGrow(1)
    }
    bornRef.current = true

    return () => {
      studio.frame = null
      studio.scene.remove(figure.group)
      figure.dispose()
      figureRef.current = null
      bornRef.current = false
    }
  })

  useEffect(() => {
    figureRef.current?.setShape(params)
  }, [params])

  function set(id: string, value: number): void {
    onChange({ ...params, [id]: value })
  }

  const parts: Part[] = ['head', 'body', 'arms', 'legs']

  return (
    <div className="stage">
      <div className="stage-head">
        <h1>{t('shape.title')}</h1>
        <p className="hint">{t('shape.hint')}</p>
      </div>

      <div className="split-panel shape-panel">
        <div className="slider-groups">
          {parts.map((part) => {
            const rows = shapeData.sliders.filter((s) => s.part === part)
            if (!rows.length) return null
            return (
              <section key={part} className="slider-group">
                <h2>{t(`shape.part.${part}`)}</h2>
                {rows.map((s) => (
                  <label key={s.id} className="slider-row">
                    <span className="slider-name">{t(s.label)}</span>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={0.01}
                      value={params[s.id] ?? s.default}
                      onChange={(e) => set(s.id, Number(e.target.value))}
                    />
                    <b>{Math.round((params[s.id] ?? s.default) * 100)}%</b>
                  </label>
                ))}
              </section>
            )
          })}
        </div>

        <div className="actions">
          <button type="button" onClick={onDone}>
            {t('shape.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
