import { useEffect, useState } from 'react'
import { StudioScene } from './render/StudioScene'
import { SplitStage } from './stages/SplitStage'
import { ShapeStage } from './stages/ShapeStage'
import { PoseStage } from './stages/PoseStage'
import { GlazeStage } from './stages/GlazeStage'
import { DEFAULT_SHAPE, type PoseName, type ShapeParams } from './render/figure'
import { store } from './game/session'
import type { Split } from './game/types'

type Stage = 'split' | 'shape' | 'pose' | 'glaze'

export default function App() {
  // 原型阶段：段落与形状只存在内存里，刷新回到拆泥（存档仍只记 s1）
  const [stage, setStage] = useState<Stage>('split')
  const [split, setSplit] = useState<Split>(() => store.get().session.s1_split)
  const [shape, setShape] = useState<ShapeParams>(DEFAULT_SHAPE)
  const [pose, setPose] = useState<PoseName>('stand')

  // 页面隐藏时落盘（切标签 / 切后台）
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') store.flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  return (
    <StudioScene>
      {stage === 'split' && (
        <SplitStage
          onDone={(next) => {
            setSplit(next)
            setStage('shape')
          }}
        />
      )}
      {stage === 'shape' && (
        <ShapeStage
          split={split}
          params={shape}
          onChange={setShape}
          onDone={() => setStage('pose')}
        />
      )}
      {stage === 'pose' && (
        <PoseStage
          split={split}
          params={shape}
          pose={pose}
          onChange={setPose}
          onDone={() => setStage('glaze')}
        />
      )}
      {stage === 'glaze' && <GlazeStage split={split} params={shape} pose={pose} />}
    </StudioScene>
  )
}
