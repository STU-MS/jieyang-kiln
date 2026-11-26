import { useEffect, useState } from 'react'
import { StudioScene } from './render/StudioScene'
import { SplitStage } from './stages/SplitStage'
import { ShapeStage } from './stages/ShapeStage'
import { store } from './game/session'

export default function App() {
  // 阶段闸门：拆泥动画播完才切到捏；已确认的存档直接进捏
  const [stage, setStage] = useState<'split' | 'shape'>(() => (store.get().session.s1_confirmed ? 'shape' : 'split'))
  // 从捏退回拆泥时，先倒放合并；之后正常拆泥流程不再触发
  const [mergeOnEnter, setMergeOnEnter] = useState(false)

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
      {stage === 'split' ? (
        <SplitStage
          mergeOnEnter={mergeOnEnter}
          onSplitDone={() => {
            store.flush()
            setStage('shape')
          }}
        />
      ) : (
        <ShapeStage
          onBack={() => {
            setMergeOnEnter(true)
            setStage('split')
          }}
        />
      )}
    </StudioScene>
  )
}
