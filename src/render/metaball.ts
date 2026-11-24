import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'

/**
 * 拆分动画的「流体」近似（设计文档 §2.1）：
 * 用 metaball 势场（marching cubes）代替在四个椭球之间做补帧——
 * 四颗势场球挤在一起时表面平滑融合成一整团，拉开时中间自动变细、断裂成四块。
 * 只在拆分那 1.6 秒里存在；静置、捏、上釉全走普通网格（见 clay.ts）。
 */

/** 一颗势场球：世界球心 + x/z 方向的世界半径（竖直方向自动乘 squash）。 */
export interface BlobBall {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly radius: number
}

export interface BlobConfig {
  /** 势场分辨率（立方体边长上的格数），越大越细腻也越慢 */
  readonly resolution: number
  /** 势场方块在 x/z 方向的世界半边长 */
  readonly extent: number
  /** 竖直压扁比例，与整团 / 泥块的 squash 一致 */
  readonly squash: number
  /**
   * share = 1 的球在势场局部空间（0..1）里的半径。
   * 世界半径 = 2 · extent · fieldRadius · share^(1/3)，体积随占比线性。
   */
  readonly fieldRadius: number
}

export interface ClayBlob {
  readonly mesh: MarchingCubes
  /** 重算势场并重建网格（每帧调用） */
  update(balls: readonly BlobBall[]): void
  /** 0 = 完全透明且不渲染，1 = 不透明；拆分末段的交叉淡出用 */
  setOpacity(alpha: number): void
  dispose(): void
}

/** 势场球的势场常数：只要求 isolation 与 subtract 相等，合并距离就只由半径决定。 */
const ISOLATION = 1

/** 多边形的最大数量：四颗球在 64 分辨率下大约 3 万个三角面。 */
const MAX_POLY_COUNT = 80000

export function createClayBlob(material: THREE.Material, cfg: BlobConfig): ClayBlob {
  const mesh = new MarchingCubes(cfg.resolution, material, true, false, MAX_POLY_COUNT)
  mesh.scale.set(cfg.extent, cfg.extent * cfg.squash, cfg.extent)
  mesh.castShadow = true
  mesh.receiveShadow = true
  // 几何每帧重建，包围球不会自动更新，交给场景自己剔除会闪
  mesh.frustumCulled = false

  const toLocal = (world: number): number => 0.5 + world / (2 * cfg.extent)
  const toLocalY = (world: number): number => 0.5 + world / (2 * cfg.extent * cfg.squash)
  const toLocalRadius = (world: number): number => world / (2 * cfg.extent)

  let alpha = 1

  const blob: ClayBlob = {
    mesh,
    update(balls) {
      const field = mesh as unknown as {
        reset(): void
        addBall(x: number, y: number, z: number, strength: number, subtract: number): void
        update(): void
        isolation: number
      }
      field.isolation = ISOLATION
      field.reset()
      for (const ball of balls) {
        // 单球表面：strength / r² - subtract = isolation；令 subtract = isolation，
        // 则强度 = 2 · isolation · r²，合并距离只取决于半径本身（约 2.3 倍半径）
        const r = toLocalRadius(ball.radius)
        field.addBall(toLocal(ball.x), toLocalY(ball.y), toLocal(ball.z), 2 * ISOLATION * r * r, ISOLATION)
      }
      field.update()
      applyAlpha()
    },
    setOpacity(next) {
      alpha = next
      applyAlpha()
    },
    dispose() {
      mesh.geometry.dispose()
    },
  }

  function applyAlpha(): void {
    const visible = alpha > 0.001
    mesh.visible = visible
    if (!visible) {
      mesh.castShadow = false
      return
    }
    const mat = mesh.material as THREE.MeshStandardMaterial
    const opaque = alpha > 0.999
    if (mat.transparent === opaque) {
      // 透明开关改变着色器分支，必须让材质重编译
      mat.transparent = !opaque
      mat.depthWrite = opaque
      mat.needsUpdate = true
    }
    mat.opacity = opaque ? 1 : alpha
    // 半透明阶段关掉投影，否则阴影会按不透明几何整块落下
    mesh.castShadow = opaque
  }

  applyAlpha()
  return blob
}
