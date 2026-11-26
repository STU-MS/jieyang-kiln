import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { createStudio, frameCamera, type Studio } from './studio'

/** 调试用：URL 带 ?cam=x,y,z&look=x,y,z 时覆盖相机位姿。 */
function readCameraFromUrl(): { pos: THREE.Vector3; look: THREE.Vector3 } | null {
  const p = new URLSearchParams(window.location.search)
  const cam = p.get('cam')
  if (!cam) return null
  const parse = (s: string) => s.split(',').map(Number) as [number, number, number]
  return {
    pos: new THREE.Vector3(...parse(cam)),
    look: new THREE.Vector3(...parse(p.get('look') ?? '0,1,0')),
  }
}

/**
 * studio 句柄：场景就绪后通知订阅者；卸载时置 null。
 * 由 <StudioScene> 提供，子组件通过 useStudio() 挂道具。
 */
class StudioHandle {
  current: Studio | null = null
  private waiters = new Set<(s: Studio) => void>()

  ready(studio: Studio): void {
    this.current = studio
    const ws = [...this.waiters]
    this.waiters.clear()
    for (const w of ws) w(studio)
  }

  teardown(): void {
    this.current = null
  }

  /** 已就绪立即回调；否则等就绪。返回退订函数 */
  subscribe(l: (s: Studio) => void): () => void {
    if (this.current) {
      l(this.current)
      return () => {}
    }
    this.waiters.add(l)
    return () => {
      this.waiters.delete(l)
    }
  }
}

const StudioContext = createContext<StudioHandle | null>(null)

/**
 * React 壳：挂 canvas、管生命周期、resize 和帧循环。
 * 场景在 studio.ts；道具（泥团等）由子组件通过 useStudio 挂到 studio 上。
 */
export function StudioScene({ children }: { children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<StudioHandle | null>(null)
  if (!handleRef.current) handleRef.current = new StudioHandle()
  const handle = handleRef.current

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let studio: Studio | null = null
    let renderer: THREE.WebGLRenderer | null = null
    let raf = 0
    let disposed = false
    let last = performance.now()
    // URL 覆盖过相机位姿时不再按画幅自动摆位（调试用）
    let cameraPinned = false
    // 右侧抽屉占宽：>0 时用视口偏移把主体让到左边
    let sideInset = 0

    const resize = () => {
      if (!studio || !renderer) return
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w, h)
      if (cameraPinned || studio.focused) {
        // 聚焦时不动机位（正在绕着部位看），只更新画幅
        studio.camera.aspect = w / h
        studio.camera.updateProjectionMatrix()
      } else {
        frameCamera(studio.camera, w / h)
      }
      const inset = Math.min(sideInset, w * 0.55)
      if (inset > 0) {
        // 取画面右移一截的子窗口 → 主体看起来往左让开抽屉
        studio.camera.setViewOffset(w, h, inset / 2, 0, w, h)
      } else {
        studio.camera.clearViewOffset()
      }
    }

    const tick = (now: number) => {
      if (studio && renderer) {
        // 单帧最多 0.1 秒：切后台再回来不追帧（拆分动画不会一瞬间跳完）
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
        last = now
        studio.updateCamera(dt)
        studio.frame?.(dt, now / 1000)
        renderer.render(studio.scene, studio.camera)
      }
      raf = requestAnimationFrame(tick)
    }

    const run = async () => {
      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.outputColorSpace = THREE.SRGBColorSpace
      host.appendChild(renderer.domElement)

      const loaded = await createStudio()
      if (disposed) {
        loaded.dispose()
        return
      }
      studio = loaded
      studio.canvas = renderer.domElement
      studio.setSideInset = (px: number) => {
        sideInset = px
        resize()
      }
      const urlCam = readCameraFromUrl()
      if (urlCam) {
        cameraPinned = true
        studio.camera.position.copy(urlCam.pos)
        studio.camera.lookAt(urlCam.look)
      }
      resize()
      last = performance.now()
      raf = requestAnimationFrame(tick)
      handle.ready(loaded)
    }
    run().catch((err) => console.error('[studio] 初始化失败', err))

    const ro = new ResizeObserver(resize)
    ro.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      handle.teardown()
      studio?.dispose()
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [handle])

  return (
    <StudioContext.Provider value={handle}>
      <div ref={hostRef} style={{ position: 'fixed', inset: 0 }} />
      {children}
    </StudioContext.Provider>
  )
}

/** 在 studio 就绪后挂道具 / 帧回调；卸载时跑 cleanup。setup 始终用最新闭包（渲染循环里读 ref）。 */
export function useStudio(setup: (studio: Studio) => () => void): void {
  const handle = useContext(StudioContext)
  if (!handle) throw new Error('useStudio 必须在 <StudioScene> 内使用')
  const setupRef = useRef(setup)
  setupRef.current = setup
  useEffect(() => {
    let cleanup: (() => void) | null = null
    const off = handle.subscribe((s) => {
      cleanup = setupRef.current(s)
    })
    return () => {
      off()
      cleanup?.()
    }
  }, [handle])
}
