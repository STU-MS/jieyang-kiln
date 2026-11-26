import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { t } from '../content/text'
import { useStudio } from '../render/StudioScene'
import { focusCamera } from '../render/studio'
import { createFigure, POSE_NAMES, type Figure, type PoseName, type ShapeParams } from '../render/figure'
import type { Split } from '../game/types'

/** ③ 姿势：五个预设，点了算目标，画面里 1 秒补间过去。 */
export function PoseStage({
  split,
  params,
  pose,
  onChange,
  onDone,
}: {
  split: Split
  params: ShapeParams
  pose: PoseName
  onChange: (next: PoseName) => void
  onDone: () => void
}) {
  const figureRef = useRef<Figure | null>(null)
  const poseRef = useRef(pose)
  poseRef.current = pose

  useStudio((studio) => {
    const figure = createFigure(split)
    figure.group.position.copy(studio.tableTop)
    figure.setShape(params)
    figure.setPose(poseRef.current)
    studio.scene.add(figure.group)
    figureRef.current = figure

    // 相机推近到小人身上（每帧压一次，防止 resize 把机位拉回全景）

    studio.frame = (dt) => {
      
      const top = figure.getTop()
      focusCamera(studio.camera, studio.tableTop.clone().add(new THREE.Vector3(0, top * 0.46, 0)), Math.max(0.52, top * 1.75))
      figure.update(dt)
    }

    return () => {
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

  return (
    <>
      <div className="stage-head">
        <h1>{t('pose.title')}</h1>
        <p className="hint">{t('pose.hint')}</p>
      </div>

      {/* 右侧竖排工具栏：底部留给小人，坐 / 跪 / 盘腿的腿不会被面板挡 */}
      <aside className="pose-dock">
        <div className="pose-options" role="group" aria-label={t('pose.title')}>
          {POSE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className={pose === name ? 'is-active' : 'ghost'}
              aria-pressed={pose === name}
              onClick={() => onChange(name)}
            >
              {t(`pose.preset.${name}`)}
            </button>
          ))}
        </div>

        <button type="button" onClick={onDone}>
          {t('pose.next')}
        </button>
      </aside>
    </>
  )
}
