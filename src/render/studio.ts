import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assetId } from '../assets/manifest'
import shapeData from '../data/shape.json'

/** 默认聚焦俯角（弧度）：调用方没给时用 */
const FOCUS_PITCH = (shapeData.birth.pose.parts.body.focusPitch * Math.PI) / 180

/** 工作室场景：完整的室内房间，相机看向中央木桌。 */
export interface Studio {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly room: THREE.Group
  /** 中央木桌台面中心（世界坐标），道具放这里 */
  readonly tableTop: THREE.Vector3
  /** 每帧回调（在 render 之前），参数是本帧秒数 */
  frame: ((dt: number, now: number) => void) | null
  /** 右侧被 UI 面板占掉的宽度（CSS 像素）：相机把主体往画面左边让，抽屉不压住模型 */
  setSideInset(px: number): void
  /** 渲染画布（点选泥块时做射线投射用）；由 StudioScene 注入 */
  canvas: HTMLCanvasElement | null
  /** 把镜头对准某个部位（center 世界坐标，radius 部位半径），duration 秒内平滑过去 */
  focusOn(center: THREE.Vector3, radius: number, pitch?: number, duration?: number): void
  /** 回到拆泥 / 总览机位 */
  releaseFocus(duration?: number): void
  /** 是否已聚焦（拖动才旋转） */
  readonly focused: boolean
  /** 每帧推进镜头动画；由 StudioScene 的渲染循环调用 */
  updateCamera(dt: number): void
  /** 释放 GPU 资源 */
  dispose(): void
}

/**
 * 相机默认位姿：站在桌子右侧、正对长边。视线与长边垂直，
 * 桌面铺满画面下三分之二，泥团落在正中，背后保留工作台、门与置物架作环境。
 * 相比 v2.0 骨架往后拉约 20cm：拆泥阶段的泥团与四个工位要同时在画面里。
 */
export const CAMERA_POS = new THREE.Vector3(1.36, 1.34, 0.58)
export const CAMERA_LOOK = new THREE.Vector3(0.74, 0.94, 0.52)

/** 中央锯木架桌台面中心（从 GLB 顶点量得：台面高 0.94，长边沿 z）。 */
export const TABLE_TOP = new THREE.Vector3(0.75, 0.94, 0.53)

/** 设计基准画幅 16:10：更窄（竖屏）时相机沿视线后拉，保证泥团与四个工位都在画面里。 */
export const BASE_ASPECT = 1.6

/**
 * 按画幅摆相机：横屏用默认位姿；竖屏沿「目标点 → 相机」方向后拉，
 * 最多 1.6 倍（再远房间就空了）。只改位置，不改视角方向。
 */
export function frameCamera(camera: THREE.PerspectiveCamera, aspect: number): void {
  const pull = THREE.MathUtils.clamp(Math.sqrt(BASE_ASPECT / Math.max(aspect, 0.3)), 1, 1.6)
  camera.position.copy(CAMERA_LOOK).addScaledVector(CAMERA_POS.clone().sub(CAMERA_LOOK), pull)
  camera.lookAt(CAMERA_LOOK)
  camera.aspect = aspect
  camera.updateProjectionMatrix()
}

export async function createStudio(): Promise<Studio> {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0e0c0a')

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50)
  camera.position.copy(CAMERA_POS)
  const look = CAMERA_LOOK.clone()
  camera.lookAt(look)

  // 聚焦镜头：目标点 + 球坐标（绕部位转动）；anim 负责「转向 + 靠近」的补帧
  let orbit: { target: THREE.Vector3; yaw: number; pitch: number; distance: number } | null = null
  let anim: { fromPos: THREE.Vector3; fromLook: THREE.Vector3; toPos: THREE.Vector3; toLook: THREE.Vector3; t: number; duration: number } | null = null
  let focused = false

  // 三点布光：主光暖、补光冷、半球环境
  const key = new THREE.DirectionalLight('#fff2e0', 2.2)
  key.position.set(2, 4, 2)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 12
  key.shadow.camera.left = -3
  key.shadow.camera.right = 3
  key.shadow.camera.top = 3
  key.shadow.camera.bottom = -3
  key.shadow.bias = -0.0005
  scene.add(key)

  const fill = new THREE.DirectionalLight('#b8c4d8', 0.6)
  fill.position.set(-3, 2, -1)
  scene.add(fill)

  const hemi = new THREE.HemisphereLight('#d8cfc0', '#3a2e24', 0.8)
  scene.add(hemi)

  const room = await loadRoom()
  scene.add(room)

  const studio: Studio = {
    scene,
    camera,
    room,
    tableTop: TABLE_TOP.clone(),
    frame: null,
    // StudioScene 拿到 renderer 后会覆盖成真正实现
    setSideInset() {},
    canvas: null,
    focusOn(center, radius, pitch = FOCUS_PITCH, duration = 0.55) {
      // 保持当前视线方向（不跳变），只换目标点和距离：镜头先转向、再靠近
      const dir = camera.position.clone().sub(center).normalize()
      const yaw = Math.atan2(dir.x, dir.z)
      // 俯角：平躺的部件视角太浅只看得到侧边；由调用方按部位给（立着的头小、躺着的身体大）
      // 留一点桌面参照：不给下限的话小部位也会被怼满画面，看起来「偏大」
      const distance = radius * 2.6 + 0.14
      const to = new THREE.Vector3(
        center.x + Math.sin(yaw) * Math.cos(pitch) * distance,
        center.y + Math.sin(pitch) * distance,
        center.z + Math.cos(yaw) * Math.cos(pitch) * distance,
      )
      anim = { fromPos: camera.position.clone(), fromLook: look.clone(), toPos: to, toLook: center.clone(), t: 0, duration }
      orbit = { target: center.clone(), yaw, pitch, distance }
      focused = true
    },
    releaseFocus(duration = 0.5) {
      focused = false
      orbit = null
      anim = {
        fromPos: camera.position.clone(),
        fromLook: look.clone(),
        toPos: CAMERA_POS.clone(),
        toLook: CAMERA_LOOK.clone(),
        t: 0,
        duration,
      }
    },
    updateCamera(dt) {
      if (!anim) {
        if (orbit) {
          camera.position.set(
            orbit.target.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.distance,
            orbit.target.y + Math.sin(orbit.pitch) * orbit.distance,
            orbit.target.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.distance,
          )
          look.copy(orbit.target)
          camera.lookAt(look)
        }
        return
      }
      anim.t = Math.min(1, anim.t + dt / Math.max(anim.duration, 1e-3))
      const k = anim.t * anim.t * (3 - 2 * anim.t)
      camera.position.lerpVectors(anim.fromPos, anim.toPos, k)
      look.lerpVectors(anim.fromLook, anim.toLook, k)
      camera.lookAt(look)
      if (anim.t >= 1) anim = null
    },
    get focused() {
      return focused
    },
    dispose() {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry.dispose()
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) m.dispose()
        }
      })
    },
  }
  return studio
}

async function loadRoom(): Promise<THREE.Group> {
  const entry = assetId('studio.room')
  const gltf = await new GLTFLoader().loadAsync(entry.url)
  const root = gltf.scene
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
  const group = new THREE.Group()
  group.add(root)
  return group
}
