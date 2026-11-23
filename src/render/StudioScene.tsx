import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createStudio, type Studio } from './studio'

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

/** React 壳：挂 canvas、管生命周期和 resize。场景逻辑在 studio.ts。 */
export function StudioScene() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let studio: Studio | null = null
    let renderer: THREE.WebGLRenderer | null = null
    let raf = 0
    let disposed = false

    const resize = () => {
      if (!studio || !renderer) return
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setSize(w, h, false)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      studio.camera.aspect = w / h
      studio.camera.updateProjectionMatrix()
    }

    const tick = () => {
      if (studio && renderer) renderer.render(studio.scene, studio.camera)
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
      const urlCam = readCameraFromUrl()
      if (urlCam) {
        studio.camera.position.copy(urlCam.pos)
        studio.camera.lookAt(urlCam.look)
      }
      resize()
      tick()
    }
    run().catch((err) => console.error('[studio] 初始化失败', err))

    const ro = new ResizeObserver(resize)
    ro.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      studio?.dispose()
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} style={{ position: 'fixed', inset: 0 }} />
}
