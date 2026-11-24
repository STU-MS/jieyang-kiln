import { useEffect } from 'react'
import { StudioScene } from './render/StudioScene'
import { SplitStage } from './stages/SplitStage'
import { store } from './game/session'

export default function App() {
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
      <SplitStage />
    </StudioScene>
  )
}
