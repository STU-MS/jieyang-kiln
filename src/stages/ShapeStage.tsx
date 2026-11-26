import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { t } from '../content/text'
import { store, useSession } from '../game/session'
import type { Part } from '../game/types'
import { createClayRig, type ClayRig } from '../render/clay'
import { BIRTH_SECONDS, createPartRig, type PartRig } from '../render/parts'
import { useStudio } from '../render/StudioScene'
import type { Studio } from '../render/studio'
import { PARTS } from '../sim/split'
import { defaultShapeState, morphWeights, shapeSliders } from '../sim/shape'

/**
 * ② 捏：点工位上的泥块 → 播「泥块 → 默认部位」的出生动画 → 右侧抽屉滑出、滑杆可用。
 * 动画期间不接受新的点选；已出生过的部位再点直接开抽屉（形状保持）。
 */
export function ShapeStage({ onBack }: { onBack: () => void }) {
  const { session, canSave, discarded } = useSession()
  const [openPart, setOpenPart] = useState<Part | null>(null)
  const [busy, setBusy] = useState<Part | null>(null)
  const [studioReady, setStudioReady] = useState(false)

  const studioRef = useRef<Studio | null>(null)
  const clayRef = useRef<ClayRig | null>(null)
  const partsRef = useRef<PartRig | null>(null)
  const birthRef = useRef<{ part: Part; t: number } | null>(null)
  /** 镜头当前盯着的部位：拖动时转的是它 */
  const focusRef = useRef<Part | null>(null)

  useStudio((studio) => {
    const snap = store.get().session

    const clay = createClayRig({ label: (p) => t(`split.part.${p}`) })
    clay.group.position.copy(studio.tableTop)
    clay.setSplit(snap.s1_split)
    clay.showChunks()
    studio.scene.add(clay.group)

    const parts = createPartRig({ tableTop: studio.tableTop })
    studio.scene.add(parts.group)

    studioRef.current = studio
    clayRef.current = clay
    partsRef.current = parts
    setStudioReady(true)

    parts.ready
      .then(() => {
        const s = store.get().session
        parts.setSplit(s.s1_split)
        // 读档恢复：出生过的部位直接成形，对应的泥块让位
        for (const part of PARTS) {
          if (!s.s2_shape.animated[part]) continue
          parts.showPart(part)
          parts.setWeights(part, morphWeights(part, s.s2_shape[part]))
          clay.setChunkVisible(part, false)
        }
      })
      .catch((err) => {
        // 资产缺失 / 解析失败：泥块继续留在桌上，点选不启动出生动画，不白屏
        console.error('[parts] 人物网格加载失败', err)
      })

    // 每帧推进出生动画（与拆泥共用同一个 frame 回调位）
    studio.frame = (dt) => {
      const birth = birthRef.current
      if (!birth) return
      birth.t += dt
      const p = Math.min(1, birth.t / BIRTH_SECONDS)
      try {
        parts.poseBirth(birth.part, p)
      } catch (err) {
        console.error('[parts] 出生动画失败', err)
        birthRef.current = null
        setBusy(null)
        return
      }
      if (p < 1) return

      const part = birth.part
      birthRef.current = null
      clay.setChunkVisible(part, false)
      parts.showPart(part)
      parts.setWeights(part, morphWeights(part, store.get().session.s2_shape[part]))
      store.markAnimated(part)
      setBusy(null)
      setOpenPart(part)
    }

    // 点泥块：按下与抬起位移很小才算点击；聚焦后拖动 = 绕部位转镜头
    const canvas = studio.canvas
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    let last = { x: 0, y: 0 }

    const pick = (clientX: number, clientY: number): Part | null => {
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, studio.camera)
      const targets = PARTS.map((p) => clay.chunks[p]).filter((m) => m.visible)
      const hit = targets.length > 0 ? raycaster.intersectObjects(targets, false)[0] : undefined
      if (hit) return PARTS.find((p) => clay.chunks[p] === hit.object) ?? null
      // 已经出生过的部位也能再点开（泥块已经让位）
      return parts.hitTest(raycaster)
    }

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      last = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (!down) return
      const part = focusRef.current
      if (!part) return
      // 拖动 = 转部位本身（镜头不动）；只改朝向，不碰数据。点击判定用起始点
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) parts.spin(part, dx, dy)
    }
    const onUp = (e: PointerEvent) => {
      const start = down
      down = null
      if (!start) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return
      if (birthRef.current) return
      const part = pick(e.clientX, e.clientY)
      if (!part) return
      focusRef.current = part
      const frame = parts.frameOf(part)
      if (frame) studio.focusOn(frame.center, frame.radius)
      const s = store.get().session
      if (s.s2_shape.animated[part]) {
        parts.showPart(part)
        parts.setWeights(part, morphWeights(part, s.s2_shape[part]))
        clay.setChunkVisible(part, false)
        setOpenPart(part)
        return
      }
      // 出生：泥块让位给势场球，第一帧就是泥块那颗球（半径 = 泥块半径），接得上
      clay.setChunkVisible(part, false)
      birthRef.current = { part, t: 0 }
      setBusy(part)
      try {
        parts.poseBirth(part, 0)
      } catch (err) {
        console.error('[parts] 出生动画起不来', err)
        birthRef.current = null
        setBusy(null)
        clay.setChunkVisible(part, true)
      }
    }

    canvas?.addEventListener('pointerdown', onDown)
    canvas?.addEventListener('pointermove', onMove)
    canvas?.addEventListener('pointerup', onUp)

    return () => {
      studio.frame = null
      canvas?.removeEventListener('pointerdown', onDown)
      canvas?.removeEventListener('pointermove', onMove)
      canvas?.removeEventListener('pointerup', onUp)
      studio.setSideInset(0)
      studio.scene.remove(clay.group)
      studio.scene.remove(parts.group)
      clay.dispose()
      parts.dispose()
      studioRef.current = null
      clayRef.current = null
      partsRef.current = null
      birthRef.current = null
      setStudioReady(false)
    }
  })

  // 抽屉开着时把 3D 主体往左让，别被面板压住（窄屏改成底部抽屉，不让位）
  useEffect(() => {
    const studio = studioRef.current
    if (!studio) return
    const side = openPart && window.innerWidth >= 700 ? 320 : 0
    studio.setSideInset(side)
  }, [openPart, studioReady])

  // 上一步：退回分泥。后面捏出来的东西一律归零——比例保留，但出生动画要能再看一遍
  function backToSplit() {
    store.resetShape()
    store.reopen()
    store.flush()
    onBack()
  }

  // 从头再来：四块泥都回到桌上、滑杆回中性、抽屉收起、镜头退回总览
  function restart() {
    if (!window.confirm(t('shape.reset'))) return
    store.resetShape()
    setOpenPart(null)
    setBusy(null)
    birthRef.current = null
    focusRef.current = null
    const parts = partsRef.current
    const clay = clayRef.current
    if (parts && clay) {
      const fresh = defaultShapeState()
      for (const part of PARTS) {
        parts.hidePart(part)
        parts.setWeights(part, morphWeights(part, fresh[part]))
        clay.setChunkVisible(part, true)
      }
    }
    studioRef.current?.releaseFocus()
    store.flush()
  }

  function closeDrawer() {
    setOpenPart(null)
    focusRef.current = null
    studioRef.current?.releaseFocus()
    store.flush()
  }

  const values = openPart ? session.s2_shape[openPart] : null

  return (
    <>
      <div className="stage">
        <div className="stage-head">
          <h1>{t('shape.title')}</h1>
          <p className="hint">{busy ? t('shape.growing') : t('shape.hint')}</p>
          <div className="stage-actions">
            <button type="button" className="ghost" onClick={backToSplit}>
              {t('shape.back.split')}
            </button>
            <button type="button" className="ghost" onClick={restart}>
              {t('shape.reset')}
            </button>
          </div>
        </div>
        {(!canSave || discarded) && <p className="save-note">{!canSave ? t('split.memoryOnly') : t('split.discarded')}</p>}
      </div>

      <aside className={`shape-drawer${openPart ? ' is-open' : ''}`} aria-hidden={openPart === null}>
        {openPart && values && (
          <>
            <header className="shape-drawer-head">
              <h2>{t(`split.part.${openPart}`)}</h2>
              <button type="button" className="ghost" onClick={closeDrawer}>
                {t('shape.back')}
              </button>
            </header>
            <p className="shape-drawer-hint">{t('shape.hint.slider')}</p>
            <ul className="shape-sliders">
              {shapeSliders(openPart).map((slider) => (
                <li key={slider.id}>
                  <label>
                    <span>{t(slider.text)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={values[slider.id] ?? 0.5}
                      aria-label={t(slider.text)}
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        store.setShape(openPart, slider.id, value)
                        const next = { ...store.get().session.s2_shape[openPart], [slider.id]: value }
                        partsRef.current?.setWeights(openPart, morphWeights(openPart, next))
                      }}
                      onPointerUp={() => store.flush()}
                      onKeyUp={() => store.flush()}
                      onBlur={() => store.flush()}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </>
  )
}
