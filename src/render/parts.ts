import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assetId } from '../assets/manifest'
import shapeData from '../data/shape.json'
import splitData from '../data/split.json'
import type { Part, Split } from '../game/types'
import { PARTS } from '../sim/split'
import { chunkRadius, chunkVolume, createClayMaterial, SPLIT_ANIM, SPLIT_SECONDS } from './clay'
import { createClayBlob, type BlobBall, type ClayBlob } from './metaball'

/**
 * ② 捏：人物部位网格。
 *
 * 一份裁剪过的 MakeHuman CC0 网格（`body.clay`）加载进来后按**骨骼权重**切成头 / 身 / 臂 / 腿四块，
 * 四块共享顶点数据、各有自己的索引，所以内存只多三份索引。切面不做封口片，靠部位之间轻微重叠遮挡
 * （设计文档 §2.2）。
 *
 * 泥块 → 部位的出生动画走「势场液态倒放」：部位内部按网格填满小球（只填实体内部，左右手臂之间自然空着），
 * 播放时这些球**先全部叠在球心**（看着就是那颗泥块球），再边移动边长大散到各自位置（= 一颗球摊成一簇球），
 * 同时泥块球收缩让位、整簇抬到部位高度，末段交叉淡出到真实网格。节奏与势场实现都和拆泥共用
 * （`SPLIT_ANIM` + `createClayBlob`），所以两段是同一个语言的正反播放。
 *
 * 体积：部位显示尺寸由「这块泥的体积 ÷ 部位体积」开立方反解（泥给多少，部位就有多大）；
 * 滑杆改形后用同一个体积反算统一缩放补偿，形变不改变泥量。
 *
 * 坐标：原点在桌面中心（rig.group 已挪到 tableTop），y 向上；部位在各自工位上方，底部贴桌面。
 */

const BIRTH = shapeData.birth

/** 出生动画时长（秒）：与拆泥同一个常量，倒放才是同一套节奏。 */
export const BIRTH_SECONDS = SPLIT_SECONDS
const DISPLAY = BIRTH.display
const FILL = BIRTH.fill
const BLOB = BIRTH.blob
const TL = BIRTH.timeline
/** 拆泥动画的节奏表：出生动画倒着用同一份（fit / travel / stagger / swap / swapFade） */
const ANIM = SPLIT_ANIM
const STATIONS = splitData.stations as unknown as Record<Part, readonly [number, number]>
const DEFAULT_SPLIT = splitData.default as Split
/** 泥块的压扁比：出生动画第一帧必须和桌上那块扁球一模一样 */
const CHUNK_SQUASH = splitData.chunk.squash

/** 部位的骨架归组（骨骼名来自 MakeHuman 的 game_engine 骨架）。 */
function partOfBone(name: string): Part | null {
  if (name === 'head' || name === 'neck_01') return 'head'
  if (name === 'pelvis' || name === 'Root' || name.startsWith('spine_') || name.startsWith('clavicle_')) return 'body'
  if (name.includes('arm') || name.startsWith('hand_') || isFinger(name)) return 'arms'
  if (name.startsWith('thigh_') || name.startsWith('calf_') || name.startsWith('foot_') || name.startsWith('ball_')) return 'legs'
  return null
}

function isFinger(name: string): boolean {
  return /^(index|middle|pinky|ring|thumb)_/.test(name)
}

function isArmBone(name: string): boolean {
  return name.includes('arm') || name.startsWith('hand_') || isFinger(name)
}

function isLegBone(name: string): boolean {
  return name.startsWith('thigh_') || name.startsWith('calf_') || name.startsWith('foot_') || name.startsWith('ball_')
}

function sideOf(name: string): 'l' | 'r' | null {
  if (name.endsWith('_l')) return 'l'
  if (name.endsWith('_r')) return 'r'
  return null
}

export interface PartRig {
  readonly group: THREE.Group
  /** GLB 加载 + 切块完成；失败时 reject，调用方退回泥块继续渲染 */
  readonly ready: Promise<void>
  /** 拆泥比例 → 每个部位的显示尺寸（体积按占比） */
  setSplit(split: Split): void
  /** 出生动画某帧，p ∈ [0,1]：0 = 刚被点开的那团泥 */
  poseBirth(part: Part, p: number): void
  /** 直接显示成形后的部位（动画收尾 / 读档恢复） */
  showPart(part: Part): void
  /** 滑杆值 → morph 权重（原生 target 与 gen_* 都在这里生效） */
  setWeights(part: Part, weights: Record<string, number>): void
  /** 聚焦时拖动：转部位本身（横向 = 绕竖轴，纵向 = 前后倾一点，别掀到桌下去） */
  spin(part: Part, dx: number, dy: number): void
  /** 点选已出生的部位：射线打在可见的部位网格上就返回它 */
  hitTest(raycaster: THREE.Raycaster): Part | null
  /** 收起某部位（回到泥块状态）：网格与势场球都藏起来 */
  hidePart(part: Part): void
  /** 该部位在画面里的中心与半径（世界坐标）：镜头聚焦用 */
  frameOf(part: Part): { center: THREE.Vector3; radius: number } | null
  dispose(): void
}

interface PartSlot {
  /** 部位网格的挂点（工位上方，底部贴桌面） */
  readonly holder: THREE.Group
  readonly mesh: THREE.Mesh
  readonly material: THREE.MeshStandardMaterial
  /** 部位几何在原始网格坐标里的中心（x、z）与最低点（y），用于把部件摆到工位 */
  readonly offset: THREE.Vector3
  /** 未缩放的包围盒半尺寸 */
  readonly halfExtent: number
  /** 部位内部的填充球（相对包围盒中心、未缩放）：出生动画的终点，按离中心由近到远排序 */
  readonly balls: readonly { x: number; y: number; z: number; radius: number }[]
  /** 包围盒中心离底面的高度（部位本地坐标）：势场球以这里为原点 */
  readonly lift: number
  /** 该部位自己的几何（共享顶点 + 本部位的索引）：算体积用 */
  readonly geometry: THREE.BufferGeometry
  readonly index: Uint32Array
  /** 体积积分的参考点（包围盒中心），切开的部位用它当锥顶 */
  readonly pivot: THREE.Vector3
  /** 部位自身（静置、中性形变）的体积：显示缩放由泥块体积反解 */
  readonly volume: number
  /** 体积反解出来的显示缩放（拆泥占比变了才变） */
  displayScale: number
  /** 形变后的体积补偿缩放：滑杆只改形，不改泥量 */
  morphScale: number
  /** 当前朝向：拖动累积的偏航 / 俯仰 */
  turn: { yaw: number; pitch: number }
  blob: ClayBlob | null
  /** 势场方块的半边长（世界），缩放换算用 */
  blobExtent: number
}

export function createPartRig(opts: { tableTop: THREE.Vector3 }): PartRig {
  const group = new THREE.Group()
  group.position.copy(opts.tableTop)

  const slots = {} as Record<Part, PartSlot | null>
  let split: Split = { ...DEFAULT_SPLIT }
  let disposed = false
  const ready = build()

  async function build(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(assetId('body.clay').url)
    if (disposed) return
    const root = gltf.scene
    root.updateMatrixWorld(true)

    let source: THREE.SkinnedMesh | null = null
    root.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh
      if (!source && mesh.isSkinnedMesh) source = mesh
    })
    if (!source) throw new Error('人物网格里没有蒙皮网格')

    const src: THREE.SkinnedMesh = source
    const geo = src.geometry
    const boneNames = skeletonNames(src)
    const partOfVertex = classifyVertices(geo, boneNames)
    const triangles = splitTriangles(geo, partOfVertex)

    const names = morphNames(src)
    const bones = bonePositions(src, boneNames)
    const generated = generateMorphs(geo, partOfVertex, bones, boneNames)
    for (const g of generated) {
      geo.morphAttributes.position.push(new THREE.BufferAttribute(g.delta, 3))
      names.push(g.name)
    }
    // morph 法线不同步（原生 target 的法线删掉，避免与生成式 target 数量对不上）；顶点法线仍在，光照够用
    delete geo.morphAttributes.normal

    for (const part of PARTS) {
      const idx = triangles[part]
      if (idx.length === 0) {
        slots[part] = null
        continue
      }
      const partGeo = new THREE.BufferGeometry()
      for (const [key, attr] of Object.entries(geo.attributes)) partGeo.setAttribute(key, attr)
      // morph 的 delta 数组直接共享（四块部位用同一批 target，只是各自的索引不同）
      partGeo.morphAttributes = geo.morphAttributes
      partGeo.morphTargetsRelative = geo.morphTargetsRelative
      partGeo.setIndex(new THREE.BufferAttribute(idx, 1))

      const material = createClayMaterial() as THREE.MeshStandardMaterial
      const mesh = new THREE.Mesh(partGeo, material)
      mesh.visible = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.morphTargetDictionary = names.reduce<Record<string, number>>((a, n, i) => {
        a[n] = i
        return a
      }, {})
      mesh.morphTargetInfluences = new Array(names.length).fill(0)

      const bounds = boundsOf(geo, idx)
      const offset = new THREE.Vector3(bounds.center.x, bounds.min.y, bounds.center.z)
      mesh.position.set(-offset.x, -offset.y, -offset.z)
      // 中性形变下的体积：显示尺寸与滑杆补偿都以它为基准
      const restVolume = volumeOf(partGeo, idx, [] as unknown as ArrayLike<number>, bounds.center)

      const holder = new THREE.Group()
      holder.add(mesh)
      group.add(holder)

      slots[part] = {
        holder,
        mesh,
        material,
        offset,
        geometry: partGeo,
        index: idx,
        pivot: bounds.center.clone(),
        volume: restVolume,
        halfExtent: Math.max(bounds.half.x, bounds.half.y, bounds.half.z),
        balls: fillBalls(partGeo, idx, bounds, restVolume),
        lift: bounds.center.y - bounds.min.y,
        displayScale: 1,
        morphScale: 1,
        turn: { yaw: 0, pitch: 0 },
        blob: null,
        blobExtent: 0,
      }
    }

    layout()
  }

  /** 拆泥占比 → 显示缩放与工位摆放。部位体积随占比变，泥多的那条胳膊就是粗。 */
  function layout(): void {
    for (const part of PARTS) {
      const slot = slots[part]
      if (!slot) continue
      const share = Math.max(split[part], 1e-4)
      // 体积对应：这块泥的体积 = 部位显示体积 → 缩放 = (泥块体积 / 部位体积)^(1/3)
      const scale = DISPLAY.scaleGain * Math.cbrt(chunkVolume(share) / Math.max(slot.volume, 1e-9))
      slot.displayScale = scale
      const [x, z] = STATIONS[part]
      slot.holder.position.set(x, 0, z)
      // 缩放挂在 holder 上：部位自己的偏移量不变，形变补偿也只是乘一个标量
      slot.holder.scale.setScalar(scale * slot.morphScale)
      slot.mesh.scale.setScalar(1)
      slot.mesh.position.set(-slot.offset.x, -slot.offset.y, -slot.offset.z)
      if (slot.blob) {
        slot.blob.dispose()
        group.remove(slot.blob.mesh)
        slot.blob = null
      }
    }
  }

  function ensureBlob(part: Part): PartSlot {
    const slot = slots[part]
    if (!slot) throw new Error(`没有部位网格：${part}`)
    if (slot.blob) return slot
    // 势场盒子按球簇**真实**包围盒算：球心 + 半径，再留一点余量。
    // 按部位尺寸估是不够的——球会顶出盒子，等值面在盒边被切断，破洞就是这么来的。
    const total = slot.holder.scale.x
    let reach = chunkRadius(split[part])
    for (const ball of slot.balls) {
      reach = Math.max(reach, (Math.hypot(ball.x, ball.y, ball.z) + ball.radius) * total)
    }
    const extent = reach * 1.15
    const blob = createClayBlob(createClayMaterial(), {
      resolution: BLOB.resolution,
      maxPolyCount: BLOB.maxPolyCount,
      extent: Math.max(extent, 0.02),
      squash: 1,
      // 部位势场不用「按占比换算半径」那套（球半径直接由采样给出），这个值只占位
      fieldRadius: 0.2,
    })
    blob.mesh.visible = false
    group.add(blob.mesh)
    slot.blob = blob
    slot.blobExtent = extent
    return slot
  }

  const rig: PartRig = {
    group,
    ready,
    setSplit(next) {
      split = { ...next }
      layout()
    },
    poseBirth(part, p) {
      const slot = ensureBlob(part)
      const t = clamp01(p)
      const mix = clamp01((t - ANIM.swap) / ANIM.swapFade)
      const rise = eased(span(t, TL.travel[0], TL.travel[1])) // 整簇抬到部位高度

      const total = slot.holder.scale.x
      const r0 = chunkRadius(split[part])
      const blob = slot.blob!
      const extent = slot.blobExtent || blob.mesh.scale.x || 1 // 势场半边长（世界）：半径换算要用

      // 竖向压扁：起点和泥块一致（0.72），抬升过程中回到正球，末段与真网格交接时已经不再扁
      const squash = CHUNK_SQUASH + (1 - CHUNK_SQUASH) * rise
      blob.mesh.scale.set(extent, extent * squash, extent)
      // 整簇中心：压扁后半径 = r0·squash，这样底部刚好贴桌；终点是部位中心。x/z 固定在工位
      const restY = r0 * squash
      const centerY = restY + (slot.lift * total - restY) * rise
      blob.mesh.position.set(slot.holder.position.x, centerY, slot.holder.position.z)

      const targets = slot.balls.map((ball) => ball.radius * total * BLOB.fieldBias)
      const n = targets.length
      // 合并补偿：n 颗球完全叠在一起时，势场表面半径 = √(2·Σr²/(n+1))，与拆泥 mergedFit 同一个式子。
      // 反解出「叠成一团正好等于泥块半径」的系数 f0；散开过程中每颗球按自己的进度从 f0 回到 1。
      let sumSq = 0
      for (const r of targets) {
        const local = r / (2 * extent)
        sumSq += local * local
      }
      const mergedQ = Math.sqrt((2 * sumSq) / (n + 1))
      const f0 = mergedQ > 1e-9 ? Math.min(Math.max(r0 / (2 * extent) / mergedQ, 0.05), 3) : 1

      // 一颗球同时「拆」和「移」：同一颗球的 k 同时驱动它的位置与半径补偿，
      // 靠近中心的那批先离队，外缘的依次跟上——球体是被拉开、变细、断开的，不是先鼓起来再散开。
      const span0 = TL.spread[0]
      const window = Math.max(TL.spread[1] - span0, 1e-3)
      const balls: BlobBall[] = []
      for (let i = 0; i < n; i++) {
        const ball = slot.balls[i]
        const late = (i / Math.max(n - 1, 1)) * FILL.staggerSpan
        const k = eased(span(t, span0 + late, Math.min(span0 + late + window * 0.75, TL.spread[1] + 0.05)))
        const fit = f0 + (1 - f0) * k
        balls.push({
          x: ball.x * total * k,
          y: ball.y * total * k,
          z: ball.z * total * k,
          radius: targets[i] * fit,
        })
      }

      blob.update(balls)
      blob.setOpacity(1 - mix)
      fade(slot, mix)
    },
    showPart(part) {
      const slot = slots[part]
      if (!slot) return
      slot.blob?.setOpacity(0)
      fade(slot, 1)
    },
    hitTest(raycaster) {
      const meshes = PARTS.map((part) => slots[part]?.mesh).filter((m): m is THREE.Mesh => !!m && m.visible)
      if (meshes.length === 0) return null
      const hit = raycaster.intersectObjects(meshes, false)[0]
      if (!hit) return null
      return PARTS.find((part) => slots[part]?.mesh === hit.object) ?? null
    },
    spin(part, dx, dy) {
      const slot = slots[part]
      if (!slot) return
      slot.turn.yaw += dx * 0.01
      slot.turn.pitch = THREE.MathUtils.clamp(slot.turn.pitch + dy * 0.01, -0.3, 0.55)
      slot.holder.rotation.set(slot.turn.pitch, slot.turn.yaw, 0)
    },
    hidePart(part) {
      const slot = slots[part]
      if (!slot) return
      slot.mesh.visible = false
      if (slot.blob) {
        slot.blob.dispose()
        group.remove(slot.blob.mesh)
        slot.blob = null
      }
    },
    frameOf(part) {
      const slot = slots[part]
      if (!slot) return null
      const scale = slot.holder.scale.x
      const center = slot.holder.position.clone().add(new THREE.Vector3(0, slot.lift * scale, 0)).add(group.position)
      return { center, radius: slot.halfExtent * scale }
    },
    setWeights(part, weights) {
      const slot = slots[part]
      if (!slot) return
      const dict = slot.mesh.morphTargetDictionary ?? {}
      const influences = slot.mesh.morphTargetInfluences
      if (!influences) return
      for (const [name, index] of Object.entries(dict)) influences[index] = weights[name] ?? 0
      // 体积守恒：把形变后的体积算出来，用统一缩放补回去——滑杆只改形状，泥量始终就是那块泥
      const now = volumeOf(slot.geometry, slot.index, influences, slot.pivot)
      const ratio = now > 1e-12 ? Math.cbrt(slot.volume / now) : 1
      slot.morphScale = Math.min(Math.max(ratio, 0.6), 1.6)
      slot.holder.scale.setScalar(slot.displayScale * slot.morphScale)
    },
    dispose() {
      disposed = true
      for (const part of PARTS) {
        const slot = slots[part]
        if (!slot) continue
        slot.blob?.dispose()
        if (slot.blob) group.remove(slot.blob.mesh)
        slot.mesh.geometry.dispose()
        slot.material.dispose()
        group.remove(slot.holder)
      }
    },
  }

  return rig

  // ─── 内部工具（闭包内共享 slots / split） ───

  function fade(slot: PartSlot, alpha: number): void {
    const mat = slot.material
    if (alpha <= 0.001) {
      slot.mesh.visible = false
      slot.mesh.castShadow = false
      return
    }
    slot.mesh.visible = true
    const opaque = alpha > 0.999
    if (mat.transparent === opaque) {
      mat.transparent = !opaque
      mat.depthWrite = opaque
      mat.needsUpdate = true
    }
    mat.opacity = opaque ? 1 : alpha
    slot.mesh.castShadow = opaque
  }
}

// ─── 网格切分 ───

function skeletonNames(mesh: THREE.SkinnedMesh): string[] {
  return mesh.skeleton.bones.map((b) => b.name)
}

/** 每个顶点的归属部位：取权重最大的那根骨。 */
function classifyVertices(geo: THREE.BufferGeometry, boneNames: readonly string[]): Part[] {
  const skinIndex = geo.attributes.skinIndex
  const skinWeight = geo.attributes.skinWeight
  const count = geo.attributes.position.count
  const out: Part[] = new Array(count)
  for (let v = 0; v < count; v++) {
    let best = -1
    let bestW = -1
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k)
      if (w > bestW) {
        bestW = w
        best = skinIndex.getComponent(v, k)
      }
    }
    const part = best >= 0 ? partOfBone(boneNames[best] ?? '') : null
    out[v] = part ?? 'body'
  }
  return out
}

/** 三角形归属：三个顶点取多数（平票取第一个顶点）。 */
function splitTriangles(geo: THREE.BufferGeometry, partOfVertex: readonly Part[]): Record<Part, Uint32Array> {
  const index = geo.index
  if (!index) throw new Error('人物网格不是索引几何，切不了部位')
  const lists: Record<Part, number[]> = { head: [], body: [], arms: [], legs: [] }
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    const pa = partOfVertex[a]
    const pb = partOfVertex[b]
    const pc = partOfVertex[c]
    const part = pa === pb || pa === pc ? pa : pb === pc ? pb : pa
    lists[part].push(a, b, c)
  }
  const out = {} as Record<Part, Uint32Array>
  for (const part of PARTS) out[part] = new Uint32Array(lists[part])
  return out
}

interface Bounds {
  readonly min: THREE.Vector3
  readonly max: THREE.Vector3
  readonly center: THREE.Vector3
  readonly half: THREE.Vector3
}

function boundsOf(geo: THREE.BufferGeometry, idx: ArrayLike<number>): Bounds {
  const pos = geo.attributes.position
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  const v = new THREE.Vector3()
  for (let i = 0; i < idx.length; i++) {
    v.fromBufferAttribute(pos, idx[i])
    min.min(v)
    max.max(v)
  }
  return { min, max, center: min.clone().add(max).multiplyScalar(0.5), half: max.clone().sub(min).multiplyScalar(0.5) }
}

/**
 * 部位体积（三角形四面体带符号求和）。部位是按骨骼权重切开的开口网格，
 * 这里以包围盒中心为锥顶把切面补齐——对本游戏「泥量 → 尺寸」的换算够用，也不依赖封口片。
 */
function volumeOf(
  geo: THREE.BufferGeometry,
  idx: ArrayLike<number>,
  influences: ArrayLike<number>,
  pivot: THREE.Vector3,
): number {
  const pos = geo.attributes.position
  const morphs = geo.morphAttributes.position ?? []
  const relative = geo.morphTargetsRelative
  const base = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const read = (v: number, out: THREE.Vector3): void => {
    base.fromBufferAttribute(pos, v)
    out.copy(base)
    for (let m = 0; m < morphs.length; m++) {
      const w = influences[m] ?? 0
      if (!w) continue
      const arr = morphs[m].array
      if (relative) {
        out.x += arr[v * 3] * w
        out.y += arr[v * 3 + 1] * w
        out.z += arr[v * 3 + 2] * w
      } else {
        out.x += (arr[v * 3] - base.x) * w
        out.y += (arr[v * 3 + 1] - base.y) * w
        out.z += (arr[v * 3 + 2] - base.z) * w
      }
    }
    out.sub(pivot)
  }
  let sum = 0
  for (let i = 0; i < idx.length; i += 3) {
    read(idx[i], a)
    read(idx[i + 1], b)
    read(idx[i + 2], c)
    sum += a.dot(b.clone().cross(c)) / 6
  }
  return Math.abs(sum)
}

function morphNames(mesh: THREE.SkinnedMesh): string[] {
  const dict = mesh.morphTargetDictionary
  if (dict) {
    return Object.entries(dict)
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name)
  }
  // 没有 dictionary 时按 GLB 的 morph 顺序补名字（我们自己的裁剪脚本保留了 20 个原生 target）
  const count = mesh.geometry.morphAttributes.position?.length ?? 0
  return Array.from({ length: count }, (_, i) => `morph_${i}`)
}

// ─── 生成式 morph（MakeHuman 没有四肢/肩腰/头大小这类 target） ───

interface BonePositions {
  get(name: string): THREE.Vector3 | null
  getSide(prefix: 'upperarm' | 'thigh' | 'lowerarm' | 'calf', side: 'l' | 'r'): THREE.Vector3 | null
}

function bonePositions(mesh: THREE.SkinnedMesh, boneNames: readonly string[]): BonePositions {
  const toLocal = mesh.matrixWorld.clone().invert()
  const map = new Map<string, THREE.Vector3>()
  for (const bone of mesh.skeleton.bones) {
    map.set(bone.name, new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(toLocal))
  }
  // 有些骨架把上臂写成 upperarm_l / lowerarm_l；按前缀取第一个命中的
  const byPrefix = (prefix: string): THREE.Vector3 | null => {
    for (const name of boneNames) {
      if (name.startsWith(prefix)) return map.get(name) ?? null
    }
    return null
  }
  return {
    get(name) {
      return map.get(name) ?? null
    },
    getSide(prefix, side) {
      return byPrefix(`${prefix}_${side}`)
    },
  }
}

interface GeneratedMorph {
  readonly name: string
  readonly delta: Float32Array
}

/**
 * 生成式 morph：按骨骼权重把「部位」整块做形变，写成顶点偏移（morph target 的 delta）。
 * 四肢的长短 / 粗细走**体积守恒**的缩放：加长就按 1/√k 变细，加粗就按 1/k² 变短。
 */
function generateMorphs(
  geo: THREE.BufferGeometry,
  partOfVertex: readonly Part[],
  bones: BonePositions,
  boneNames: readonly string[],
): GeneratedMorph[] {
  const pos = geo.attributes.position
  const skinIndex = geo.attributes.skinIndex
  const skinWeight = geo.attributes.skinWeight
  const normal = geo.attributes.normal
  const count = pos.count

  const weightWhere = (v: number, pred: (name: string) => boolean): number => {
    let sum = 0
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k)
      if (w <= 0) continue
      const name = boneNames[skinIndex.getComponent(v, k)] ?? ''
      if (pred(name)) sum += w
    }
    return Math.min(1, sum)
  }

  const p = new THREE.Vector3()
  /** 同名通道合并（左右手共用 gen_hand_size 之类），最后再落成数组 */
  const merged = new Map<string, Float32Array>()
  const wanted = new Set(
    Object.values(shapeData.parts)
      .flatMap((part) => part.sliders)
      .flatMap((slider) => slider.channels)
      .map((channel) => channel.morph)
      .filter((name) => name.startsWith('gen_')),
  )

  const headPivot = bones.get('head')
  const spinePivot = bones.get('pelvis') ?? bones.get('spine_01')
  const front = headFrontDirection(geo, partOfVertex, bones)

  function add(name: string, fn: (v: number, x: number, y: number, z: number) => THREE.Vector3 | null): void {
    if (!wanted.has(name)) return
    let delta = merged.get(name)
    if (!delta) {
      delta = new Float32Array(count * 3)
      merged.set(name, delta)
    }
    for (let v = 0; v < count; v++) {
      p.fromBufferAttribute(pos, v)
      const d = fn(v, p.x, p.y, p.z)
      if (!d) continue
      delta[v * 3] += d.x
      delta[v * 3 + 1] += d.y
      delta[v * 3 + 2] += d.z
    }
  }

  // 头整体缩放：以头顶骨为支点放 8%
  if (headPivot) {
    const pivot = headPivot.clone()
    add('gen_head_scale', (v, x, y, z) => {
      const w = weightWhere(v, (n) => n === 'head')
      if (w <= 0) return null
      return new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z).multiplyScalar(0.08 * w)
    })
  }

  // 脸颊鼓出：脸前半、下巴到眼之间的区域沿法线往外推
  if (headPivot && normal) {
    const pivot = headPivot.clone()
    add('gen_cheek_puff', (v, x, y, z) => {
      const w = weightWhere(v, (n) => n === 'head' || n === 'neck_01')
      if (w <= 0) return null
      const rel = new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z)
      const flat = new THREE.Vector3(rel.x, 0, rel.z)
      if (flat.lengthSq() < 1e-10) return null
      const frontness = Math.max(0, flat.normalize().dot(front))
      if (frontness <= 0) return null
      const h = clamp01((rel.y + 0.06) / 0.12) // 0 = 下巴附近，1 = 眼以上
      const band = Math.max(0, 1 - Math.abs(h - 0.42) / 0.28)
      const k = 0.012 * w * frontness * band
      if (k <= 0) return null
      return new THREE.Vector3(normal.getX(v), normal.getY(v), normal.getZ(v)).multiplyScalar(k)
    })

    // 眉毛上翘：眼以上的前半张脸往上提一点
    add('gen_brow_tilt', (v, x, y, z) => {
      const w = weightWhere(v, (n) => n === 'head')
      if (w <= 0) return null
      const rel = new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z)
      const flat = new THREE.Vector3(rel.x, 0, rel.z)
      if (flat.lengthSq() < 1e-10) return null
      const frontness = Math.max(0, flat.normalize().dot(front))
      const h = clamp01((rel.y + 0.04) / 0.14)
      const band = Math.max(0, 1 - Math.abs(h - 0.74) / 0.16)
      const k = 0.01 * w * frontness * band
      if (k <= 0) return null
      return new THREE.Vector3(0, k, 0)
    })
  }

  // 肩宽：锁骨 / 上臂权重区沿 x 往外开
  if (spinePivot) {
    const cx = spinePivot.x
    add('gen_shoulder', (v, x) => {
      const w = weightWhere(v, (n) => n.startsWith('clavicle_') || n.startsWith('upperarm_'))
      if (w <= 0) return null
      const sign = x >= cx ? 1 : -1
      return new THREE.Vector3(sign * 0.03 * w, 0.008 * w, 0)
    })

    // 腰粗：腰一圈径向变粗 10%
    const px = spinePivot.x
    const pz = spinePivot.z
    add('gen_waist', (v, x, _y, z) => {
      const w = weightWhere(v, (n) => n === 'spine_01' || n === 'pelvis' || n === 'spine_02')
      if (w <= 0) return null
      return new THREE.Vector3((x - px) * 0.1 * w, 0, (z - pz) * 0.1 * w)
    })
  }

  // 四肢：长短 / 粗细（体积守恒）
  for (const side of ['l', 'r'] as const) {
    const shoulder = bones.getSide('upperarm', side)
    const wrist = bones.get(`hand_${side}`) ?? bones.getSide('lowerarm', side)
    if (shoulder && wrist) {
      const limb = { a: shoulder, b: wrist, pred: (n: string) => isArmBone(n) && sideOf(n) === side }
      pushLimbMorphs(add, weightWhere, limb, 'gen_arm_length', 'gen_arm_thickness')
      // 手大：以手腕为支点放大 25%
      const pivot = wrist.clone()
      add('gen_hand_size', (v, x, y, z) => {
        const w = weightWhere(v, (n) => (n.startsWith('hand_') || isFinger(n)) && sideOf(n) === side)
        if (w <= 0) return null
        return new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z).multiplyScalar(0.25 * w)
      })
    }

    const hip = bones.getSide('thigh', side)
    const ankle = bones.get(`foot_${side}`) ?? bones.getSide('calf', side)
    if (hip && ankle) {
      const limb = { a: hip, b: ankle, pred: (n: string) => isLegBone(n) && sideOf(n) === side }
      pushLimbMorphs(add, weightWhere, limb, 'gen_leg_length', 'gen_leg_thickness')
      const pivot = ankle.clone()
      add('gen_foot_size', (v, x, y, z) => {
        const w = weightWhere(v, (n) => (n.startsWith('foot_') || n.startsWith('ball_')) && sideOf(n) === side)
        if (w <= 0) return null
        return new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z).multiplyScalar(0.22 * w)
      })
    }
  }

  // 没被上面覆盖到的生成式通道（数据表新增时）补一条零 delta，避免权重指向不存在的 target
  for (const name of wanted) {
    if (!merged.has(name)) merged.set(name, new Float32Array(count * 3))
  }
  return [...merged].map(([name, delta]) => ({ name, delta }))
}

function pushLimbMorphs(
  add: (name: string, fn: (v: number, x: number, y: number, z: number) => THREE.Vector3 | null) => void,
  weightWhere: (v: number, pred: (name: string) => boolean) => number,
  limb: { a: THREE.Vector3; b: THREE.Vector3; pred: (name: string) => boolean },
  lengthName: string,
  thicknessName: string,
): void {
  const axis = limb.b.clone().sub(limb.a)
  if (axis.lengthSq() < 1e-10) return
  axis.normalize()
  const pivot = limb.a.clone()

  const scale = (axial: number, radial: number) => (v: number, x: number, y: number, z: number) => {
    const w = weightWhere(v, limb.pred)
    if (w <= 0) return null
    const rel = new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z)
    const along = rel.dot(axis)
    const radialVec = rel.clone().addScaledVector(axis, -along)
    return new THREE.Vector3()
      .addScaledVector(axis, along * (axial - 1))
      .addScaledVector(radialVec, radial - 1)
      .multiplyScalar(w)
  }

  // 长短：拉长 12%，径向按 1/√1.12 变细（体积不变）
  add(lengthName, scale(1.12, 1 / Math.sqrt(1.12)))
  // 粗细：径向变粗 12%，轴向按 1/1.12² 缩短（体积不变）
  add(thicknessName, scale(1 / (1.12 * 1.12), 1.12))
}

/** 判定「脸朝哪边」：头部前半张脸的顶点在水平面上偏出去最多的方向。 */
function headFrontDirection(geo: THREE.BufferGeometry, partOfVertex: readonly Part[], bones: BonePositions): THREE.Vector3 {
  const head = bones.get('head')
  const pos = geo.attributes.position
  if (!head) return new THREE.Vector3(0, 0, 1)
  const acc = new THREE.Vector3()
  for (let v = 0; v < pos.count; v++) {
    if (partOfVertex[v] !== 'head') continue
    const dx = pos.getX(v) - head.x
    const dz = pos.getZ(v) - head.z
    const len = Math.hypot(dx, dz)
    if (len <= 0) continue
    // 只统计头部中段（鼻子、颧骨一带），避开后脑
    acc.x += (dx / len) * len
    acc.z += (dz / len) * len
  }
  if (acc.lengthSq() < 1e-10) return new THREE.Vector3(0, 0, 1)
  acc.y = 0
  return acc.normalize()
}

// ─── 部位内部的填充球（出生动画的终点） ───

interface Triangles {
  /** 每个三角形 9 个数（a、b、c 三个顶点） */
  readonly pos: Float32Array
  /** 每个三角形 3 个数的面法线（朝外） */
  readonly nrm: Float32Array
  /** 每个三角形的包围盒：6 个数（min xyz、max xyz），用于快速剔除 */
  readonly box: Float32Array
  readonly count: number
}

function trianglesOf(geo: THREE.BufferGeometry, idx: ArrayLike<number>): Triangles {
  const attr = geo.attributes.position
  const count = Math.floor(idx.length / 3)
  const pos = new Float32Array(count * 9)
  const nrm = new Float32Array(count * 3)
  const box = new Float32Array(count * 6)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < count; t++) {
    a.fromBufferAttribute(attr, idx[t * 3])
    b.fromBufferAttribute(attr, idx[t * 3 + 1])
    c.fromBufferAttribute(attr, idx[t * 3 + 2])
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], t * 9)
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
    nrm.set([n.x, n.y, n.z], t * 3)
    box.set(
      [
        Math.min(a.x, b.x, c.x),
        Math.min(a.y, b.y, c.y),
        Math.min(a.z, b.z, c.z),
        Math.max(a.x, b.x, c.x),
        Math.max(a.y, b.y, c.y),
        Math.max(a.z, b.z, c.z),
      ],
      t * 6,
    )
  }
  return { pos, nrm, box, count }
}

/** 点到三角形表面最近距离 + 是否在实体内部（按最近面的外法线定向）。 */
function nearestSurface(tris: Triangles, p: THREE.Vector3): { dist: number; inside: boolean } {
  let best = Infinity
  let bestT = -1
  for (let t = 0; t < tris.count; t++) {
    // 先用三角面包围盒快速剔除
    const b = t * 6
    const dx = Math.max(tris.box[b] - p.x, 0, p.x - tris.box[b + 3])
    const dy = Math.max(tris.box[b + 1] - p.y, 0, p.y - tris.box[b + 4])
    const dz = Math.max(tris.box[b + 2] - p.z, 0, p.z - tris.box[b + 5])
    if (dx * dx + dy * dy + dz * dz >= best) continue
    const i = t * 9
    const d = pointTriangleDistanceSq(p, tris.pos[i], tris.pos[i + 1], tris.pos[i + 2], tris.pos[i + 3], tris.pos[i + 4], tris.pos[i + 5], tris.pos[i + 6], tris.pos[i + 7], tris.pos[i + 8])
    if (d < best) {
      best = d
      bestT = t
    }
  }
  if (bestT < 0) return { dist: Infinity, inside: false }
  const n = bestT * 3
  // 最近点方向与面外法线的夹角 → 判定内外（局部凸性足够用，左右手臂各判各的，不会互相连）
  const i = bestT * 9
  const cp = closestPointOnTriangle(p, tris.pos[i], tris.pos[i + 1], tris.pos[i + 2], tris.pos[i + 3], tris.pos[i + 4], tris.pos[i + 5], tris.pos[i + 6], tris.pos[i + 7], tris.pos[i + 8])
  const inside = (p.x - cp.x) * tris.nrm[n] + (p.y - cp.y) * tris.nrm[n + 1] + (p.z - cp.z) * tris.nrm[n + 2] < 0
  return { dist: Math.sqrt(best), inside }
}

function closestPointOnTriangle(p: THREE.Vector3, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): THREE.Vector3 {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const apx = p.x - ax
  const apy = p.y - ay
  const apz = p.z - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return new THREE.Vector3(ax, ay, az)
  const bpx = p.x - bx
  const bpy = p.y - by
  const bpz = p.z - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return new THREE.Vector3(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return new THREE.Vector3(ax + abx * v, ay + aby * v, az + abz * v)
  }
  const cpx = p.x - cx
  const cpy = p.y - cy
  const cpz = p.z - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return new THREE.Vector3(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return new THREE.Vector3(ax + acx * w, ay + acy * w, az + acz * w)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return new THREE.Vector3(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w)
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return new THREE.Vector3(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

function pointTriangleDistanceSq(p: THREE.Vector3, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const q = closestPointOnTriangle(p, ax, ay, az, bx, by, bz, cx, cy, cz)
  const dx = p.x - q.x
  const dy = p.y - q.y
  const dz = p.z - q.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * 部位内部填球：按「体积 ÷ 每部位球数」反解网格间距（球数封顶，保证势场不超预算），
 * 只留实体内部的采样点，半径取「间距 × 比例」与「局部厚度 × 系数」的较小者。
 * 左右手臂之间的空档在网格之外，天然没有球——势场不会把两条手臂黏成蹼。
 */
function fillBalls(
  geo: THREE.BufferGeometry,
  idx: ArrayLike<number>,
  bounds: Bounds,
  volume: number,
): { x: number; y: number; z: number; radius: number }[] {
  // 间距由「部位体积 ÷ 目标球数 ÷ 填充率」反解：大部位球变少、球变大，小部位反之，总数始终封顶
  let spacing = Math.max(Math.cbrt(volume / Math.max(FILL.perPart, 1) / FILL.packing), 1e-4)
  const tris = trianglesOf(geo, idx)
  // 太稀（可能被判成「都在外面」或者只剩几颗）就把网格加密再采一次，最多两轮
  let out = sampleGrid(bounds, tris, spacing)
  if (out.length < 8) out = sampleGrid(bounds, tris, spacing * 0.6)
  return out.sort((a, b) => a.x * a.x + a.y * a.y + a.z * a.z - (b.x * b.x + b.y * b.y + b.z * b.z)).slice(0, FILL.perPart)
}

/** 按给定间距在部位包围盒里打网格，采实体内部的点。 */
function sampleGrid(
  bounds: Bounds,
  tris: Triangles,
  spacing: number,
): { x: number; y: number; z: number; radius: number }[] {
  const out: { x: number; y: number; z: number; radius: number }[] = []
  const p = new THREE.Vector3()
  const limit = FILL.perPart * 2 // 去重前多采一些，最后再封顶
  for (let x = bounds.min.x + spacing * 0.5; x < bounds.max.x && out.length < limit; x += spacing) {
    for (let y = bounds.min.y + spacing * 0.5; y < bounds.max.y && out.length < limit; y += spacing) {
      for (let z = bounds.min.z + spacing * 0.5; z < bounds.max.z && out.length < limit; z += spacing) {
        p.set(x, y, z)
        const hit = nearestSurface(tris, p)
        if (!hit.inside || hit.dist <= 0) continue
        // 半径：间距与局部厚度（≈ 2 × 到表面距离）取小，最薄处也不缩成针尖
        const radius = Math.max(
          Math.min(spacing * FILL.radiusRatio, hit.dist * 2 * FILL.thicknessClamp),
          spacing * FILL.minRadius,
        )
        // 球心要够靠里，球才不会冒出表面
        if (hit.dist < radius * FILL.insideInset) continue
        // 同一个位置只留一颗：叠球会让势场过强、表面鼓包
        let crowded = false
        for (const o of out) {
          const dx = o.x - x
          const dy = o.y - y
          const dz = o.z - z
          const gap = Math.min(o.radius, radius) * 0.9
          if (dx * dx + dy * dy + dz * dz < gap * gap) {
            crowded = true
            break
          }
        }
        if (crowded) continue
        out.push({ x: x - bounds.center.x, y: y - bounds.center.y, z: z - bounds.center.z, radius })
      }
    }
  }
  // 由近到远：展开时先中心后外缘，读起来是「从泥团里长出来」
  return out
}

/** 把 t 从 [a,b] 线性映射到 [0,1]（越界夹紧）。 */
function span(t: number, a: number, b: number): number {
  return clamp01((t - a) / Math.max(b - a, 1e-4))
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function eased(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}
