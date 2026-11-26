import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assetId } from '../assets/manifest'

/** 工作室场景：完整的室内房间，相机看向中央木桌。 */
export interface Studio {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly room: THREE.Group
  /** 中央木桌台面中心（世界坐标），道具放这里 */
  readonly tableTop: THREE.Vector3
  /** 每帧回调（在 render 之前），参数是本帧秒数 */
  frame: ((dt: number, now: number) => void) | null
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

/** 视线方向（从目标点指向相机），复用默认位姿，保证换了焦距也不换机位角度。 */
export const VIEW_DIR = CAMERA_POS.clone().sub(CAMERA_LOOK).normalize()

/**
 * 把相机推近到某个点，用于「捏 / 姿势」这类要看清小人的段落。
 * 只改位置和朝向，不动 aspect。
 */
export function focusCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, distance = 0.62): void {
  camera.position.copy(target).addScaledVector(VIEW_DIR, distance)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
}

export async function createStudio(): Promise<Studio> {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0e0c0a')

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50)
  camera.position.copy(CAMERA_POS)
  camera.lookAt(CAMERA_LOOK)

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

  return {
    scene,
    camera,
    room,
    tableTop: TABLE_TOP.clone(),
    frame: null,
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
