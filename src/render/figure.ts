import * as THREE from 'three'
import shapeData from '../data/shape.json'
import splitData from '../data/split.json'
import poseData from '../data/pose.json'
import glazeData from '../data/glaze.json'
import type { Part, Split } from '../game/types'

/**
 * 极简版小人：球 / 胶囊拼出来的参数化人形，不用 MakeHuman 网格、不用 morph target。
 * 尺寸 = src/data/shape.json 的 rig 基准 × 滑杆倍数 × 拆泥占比；姿势 = src/data/pose.json 的关节角。
 *
 * 关节层级（都在 group.rotation.y = 90° 之后）：
 *   hipJoint（y = 腿长 × 胯高系数）
 *     ├ torsoPivot → 躯干 / 脖子 / 头 / 两肩（→ 肘 → 前臂）
 *     └ 两胯（→ 大腿 → 膝 → 小腿）
 *
 * 约定：group 原点在脚底，y 向上；挂到桌面上时 group.position 直接摆在 tableTop。
 */

export type ShapeParams = Record<string, number>
export type PoseName = 'stand' | 'sit' | 'lean' | 'kneel' | 'crossLeg'

export const POSE_NAMES: PoseName[] = ['stand', 'sit', 'lean', 'kneel', 'crossLeg']

export const DEFAULT_SHAPE: ShapeParams = Object.fromEntries(
  shapeData.sliders.map((s) => [s.id, s.default]),
) as ShapeParams

/** 关节名，和 pose.json 的键一一对应 */
const JOINTS = ['torso', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'thighL', 'thighR', 'kneeL', 'kneeR'] as const
type JointName = (typeof JOINTS)[number]
type Angles = { x: number; y: number; z: number }

const DEG = Math.PI / 180

/**
 * 拆泥占比换成尺寸倍数：指数压到 0.22 再夹住，
 * 免得「头分 50%」直接把头放大到比身子还大。
 */
function shareFactor(split: Split, part: Part): number {
  const base = (splitData.default as Record<Part, number>)[part]
  const raw = (split[part] ?? base) / base
  const [lo, hi] = shapeData.shareClamp
  return THREE.MathUtils.clamp(Math.pow(raw, shapeData.shareWeight), lo, hi)
}

function capsule(radius: number, length: number): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 6, 16)
}

function toAngles(v: number[] | undefined): Angles {
  const [x = 0, y = 0, z = 0] = v ?? []
  return { x: x * DEG, y: y * DEG, z: z * DEG }
}

interface Bone {
  pivot: THREE.Object3D
  mesh: THREE.Mesh
  ball?: THREE.Mesh
}

function makeBone(radius: number, length: number, material: THREE.Material, part: Part): Bone {
  const pivot = new THREE.Object3D()
  const mesh = new THREE.Mesh(capsule(radius, length - radius * 2), material)
  mesh.position.y = -length / 2
  mesh.castShadow = true
  mesh.receiveShadow = true
  // 关节球：两段胶囊在肘 / 膝 / 肩 / 胯处不会露出缝
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.02, 16, 12), material)
  ball.castShadow = true
  ball.receiveShadow = true
  // 点击上釉时靠这个字段认出部位
  mesh.userData.part = part
  ball.userData.part = part
  pivot.add(mesh, ball)
  return { pivot, mesh, ball }
}

export interface Figure {
  readonly group: THREE.Group
  setShape(params: ShapeParams): void
  /** 设目标姿势，之后靠 update 逐帧补间过去（1 秒左右走完） */
  setPose(name: PoseName): void
  update(dt: number): void
  /** 头顶离脚底的近似高度（取景用，会随滑杆变） */
  getTop(): number
  /** 出生动画用：整体缩放，0 = 没有，1 = 原大 */
  setGrow(k: number): void
  /** 给某个部位上釉（id 见 src/data/glaze.json）；'none' = 露胎 */
  setGlaze(part: Part, glazeId: string): void
  /** 开窑：把所有部位换成烧成色 */
  fire(): void
  dispose(): void
}

/** 当前各部位上的釉 */
export type GlazeState = Record<Part, string>

export function createFigure(split: Split): Figure {
  const rig = shapeData.rig

  /** 每个部位一份材质：上釉就是改这块的颜色 */
  const clayMaterials: Record<Part, THREE.MeshStandardMaterial> = {
    head: new THREE.MeshStandardMaterial({ color: shapeData.color, roughness: 0.82, metalness: 0 }),
    body: new THREE.MeshStandardMaterial({ color: shapeData.color, roughness: 0.82, metalness: 0 }),
    arms: new THREE.MeshStandardMaterial({ color: shapeData.color, roughness: 0.82, metalness: 0 }),
    legs: new THREE.MeshStandardMaterial({ color: shapeData.color, roughness: 0.82, metalness: 0 }),
  }

  const glazeById = new Map(glazeData.glazes.map((g) => [g.id, g]))
  const glazeState: GlazeState = { head: 'none', body: 'none', arms: 'none', legs: 'none' }
  let fired = false

  /** 按当前釉层状态刷一遍颜色 */
  function applyGlaze(): void {
    for (const part of glazeData.parts as Part[]) {
      const glaze = glazeById.get(glazeState[part])
      const hex = fired ? glaze?.fired : glaze?.raw
      clayMaterials[part].color.set(hex ?? shapeData.color)
    }
  }

  const group = new THREE.Group()
  // 相机在 +x 方向看向桌子，所以让小人正面朝 +x（否则侧面看过去两条腿会叠成一根）
  group.rotation.y = Math.PI / 2

  const hipJoint = new THREE.Object3D()
  group.add(hipJoint)

  const torsoPivot = new THREE.Object3D()
  hipJoint.add(torsoPivot)

  const torso = new THREE.Mesh(capsule(rig.torsoR, rig.torsoH), clayMaterials.body)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(rig.torsoR * 0.5, rig.torsoR * 0.6, rig.headR * 0.8, 16), clayMaterials.head)
  const head = new THREE.Mesh(new THREE.SphereGeometry(rig.headR, 32, 24), clayMaterials.head)
  for (const m of [torso, neck, head]) {
    m.castShadow = true
    m.receiveShadow = true
    torsoPivot.add(m)
  }
  torso.userData.part = 'body'
  neck.userData.part = 'head'
  head.userData.part = 'head'

  const shoulderL = makeBone(rig.armR, rig.armLen * 0.55, clayMaterials.arms, 'arms')
  const shoulderR = makeBone(rig.armR, rig.armLen * 0.55, clayMaterials.arms, 'arms')
  const elbowL = makeBone(rig.armR * 0.92, rig.armLen * 0.45, clayMaterials.arms, 'arms')
  const elbowR = makeBone(rig.armR * 0.92, rig.armLen * 0.45, clayMaterials.arms, 'arms')
  shoulderL.pivot.add(elbowL.pivot)
  shoulderR.pivot.add(elbowR.pivot)
  torsoPivot.add(shoulderL.pivot, shoulderR.pivot)

  const thighL = makeBone(rig.legR, rig.legLen * 0.55, clayMaterials.legs, 'legs')
  const thighR = makeBone(rig.legR, rig.legLen * 0.55, clayMaterials.legs, 'legs')
  const kneeL = makeBone(rig.legR * 0.9, rig.legLen * 0.45, clayMaterials.legs, 'legs')
  const kneeR = makeBone(rig.legR * 0.9, rig.legLen * 0.45, clayMaterials.legs, 'legs')
  thighL.pivot.add(kneeL.pivot)
  thighR.pivot.add(kneeR.pivot)
  hipJoint.add(thighL.pivot, thighR.pivot)

  const joints: Record<JointName, Bone> = {
    torso: { pivot: torsoPivot, mesh: torso },
    shoulderL,
    shoulderR,
    elbowL,
    elbowR,
    thighL,
    thighR,
    kneeL,
    kneeR,
  }

  /** 当前尺寸（setShape 算完放这里，pose 补间也要用） */
  const dims = {
    headR: rig.headR,
    torsoH: rig.torsoH,
    torsoR: rig.torsoR,
    armLen: rig.armLen,
    armR: rig.armR,
    legLen: rig.legLen,
    legR: rig.legR,
    shoulderX: 0,
    shoulderY: 0,
    legX: 0,
  }

  const presetFor = (name: PoseName) => poseData.presets[name as keyof typeof poseData.presets]

  const rest = presetFor('stand')
  const cur: { hip: number; joints: Record<JointName, Angles> } = {
    hip: rest.hip,
    joints: Object.fromEntries(
      JOINTS.map((k) => [k, toAngles((rest as Record<string, unknown>)[k] as number[])]),
    ) as Record<JointName, Angles>,
  }
  const tgt: { hip: number; joints: Record<JointName, Angles> } = {
    hip: rest.hip,
    joints: Object.fromEntries(JOINTS.map((k) => [k, { ...cur.joints[k] }])) as Record<JointName, Angles>,
  }

  function sync(): void {
    hipJoint.position.y = dims.legLen * cur.hip
    for (const k of JOINTS) {
      const a = cur.joints[k]
      joints[k].pivot.rotation.set(a.x, a.y, a.z)
    }
  }

  function swap(mesh: THREE.Mesh, geo: THREE.BufferGeometry): void {
    mesh.geometry.dispose()
    mesh.geometry = geo
  }

  /** 头顶高度（随 setShape 更新），取景用 */
  let topY = rig.legLen + rig.torsoH + rig.headR * 2

  const figure: Figure = {
    group,

    getTop() {
      return topY
    },

    setShape(params) {
      const s = (id: string) => params[id] ?? 1
      const fHead = shareFactor(split, 'head')
      const fBody = shareFactor(split, 'body')
      const fArms = shareFactor(split, 'arms')
      const fLegs = shareFactor(split, 'legs')

      dims.headR = rig.headR * s('headSize') * fHead
      dims.torsoH = rig.torsoH * s('bodyHeight') * fBody
      dims.torsoR = rig.torsoR * s('bodyGirth') * fBody
      dims.armLen = rig.armLen * s('armLen') * fArms
      dims.armR = rig.armR * s('armThick') * fArms
      dims.legLen = rig.legLen * s('legLen') * fLegs
      dims.legR = rig.legR * s('legThick') * fLegs

      const { headR, torsoH, torsoR, armLen, armR, legLen, legR } = dims
      const upperLen = armLen * 0.55
      const foreLen = armLen * 0.45
      const thighLen = legLen * 0.55
      const shinLen = legLen * 0.45

      dims.shoulderX = torsoR * 0.9 + armR * 0.6
      dims.shoulderY = torsoH - torsoR * 0.55
      dims.legX = legR * 1.15

      // 躯干从胯往下压一点，盖住大腿根，别露缝
      const torsoY = torsoH / 2 - torsoR * 0.45
      swap(torso, capsule(torsoR, torsoH - torsoR * 2))
      torso.position.set(0, torsoY, 0)

      swap(head, new THREE.SphereGeometry(headR, 32, 24))
      head.position.set(0, torsoY + torsoH / 2 + headR * 0.62, 0)
      // 头顶的世界高度 = 胯高（站立时 = 腿长）+ 躯干坐标里的头顶
      topY = legLen + head.position.y + headR
      // 脸宽只压 x，z 不变：横向脸宽，前后还是那个厚度
      head.scale.set(s('headWidth'), 1, 1)

      swap(neck, new THREE.CylinderGeometry(torsoR * 0.5, torsoR * 0.6, Math.max(0.008, headR * 0.8), 16))
      neck.position.set(0, torsoY + torsoH / 2 + headR * 0.1, 0)

      for (const [side, bone] of [[-1, shoulderL], [1, shoulderR]] as const) {
        bone.pivot.position.set(side * dims.shoulderX, dims.shoulderY, 0)
        swap(bone.mesh, capsule(armR, upperLen - armR * 2))
        bone.mesh.position.y = -upperLen / 2
        if (bone.ball) swap(bone.ball, new THREE.SphereGeometry(armR * 1.02, 16, 12))
        const fore = side === -1 ? elbowL : elbowR
        fore.pivot.position.set(0, -upperLen * 0.94, 0)
        swap(fore.mesh, capsule(armR * 0.92, foreLen - armR * 2))
        fore.mesh.position.y = -foreLen / 2
        if (fore.ball) swap(fore.ball, new THREE.SphereGeometry(armR * 0.95, 16, 12))
      }

      for (const [side, bone] of [[-1, thighL], [1, thighR]] as const) {
        bone.pivot.position.set(side * dims.legX, 0, 0)
        swap(bone.mesh, capsule(legR, thighLen - legR * 2))
        bone.mesh.position.y = -thighLen / 2
        if (bone.ball) swap(bone.ball, new THREE.SphereGeometry(legR * 1.02, 16, 12))
        const knee = side === -1 ? kneeL : kneeR
        knee.pivot.position.set(0, -thighLen * 0.94, 0)
        swap(knee.mesh, capsule(legR * 0.9, shinLen - legR * 2))
        knee.mesh.position.y = -shinLen / 2
        if (knee.ball) swap(knee.ball, new THREE.SphereGeometry(legR * 0.92, 16, 12))
      }

      sync()
    },

    setPose(name) {
      const preset = presetFor(name)
      if (!preset) return
      tgt.hip = preset.hip
      for (const k of JOINTS) {
        const a = toAngles((preset as Record<string, unknown>)[k] as number[])
        tgt.joints[k] = a
      }
    },

    update(dt) {
      // 指数逼近：一帧最多走一点点，约 1 秒收敛，够当作补帧
      const k = 1 - Math.exp(-Math.max(0, dt) * 7)
      cur.hip += (tgt.hip - cur.hip) * k
      for (const j of JOINTS) {
        const c = cur.joints[j]
        const t = tgt.joints[j]
        c.x += (t.x - c.x) * k
        c.y += (t.y - c.y) * k
        c.z += (t.z - c.z) * k
      }
      sync()
    },

    setGrow(k) {
      group.scale.setScalar(Math.max(0.001, k))
    },

    setGlaze(part, glazeId) {
      glazeState[part] = glazeId
      fired = false
      applyGlaze()
    },

    fire() {
      fired = true
      applyGlaze()
    },

    dispose() {
      for (const m of [torso, head, neck]) m.geometry.dispose()
      for (const j of JOINTS) {
        joints[j].mesh.geometry.dispose()
        joints[j].ball?.geometry.dispose()
      }
      for (const m of Object.values(clayMaterials)) m.dispose()
    },
  }

  figure.setShape(DEFAULT_SHAPE)

  return figure
}
