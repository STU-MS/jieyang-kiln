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
  /** 释放 GPU 资源 */
  dispose(): void
}

/** 相机默认位姿：从右前方略高处看向桌面，背景是靠墙工作台和窗。 */
export const CAMERA_POS = new THREE.Vector3(0.9, 1.7, 2.6)
export const CAMERA_LOOK = new THREE.Vector3(0.3, 0.85, -0.3)

/** 中央锯木架桌台面中心（从俯视截图量得，y 是台面高）。 */
export const TABLE_TOP = new THREE.Vector3(0.3, 0.78, -0.3)

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
