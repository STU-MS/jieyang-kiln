import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import clayData from '../data/clay.json'
import data from '../data/split.json'
import { assetId } from '../assets/manifest'
import type { Part, Split } from '../game/types'
import { createClayBlob, type BlobBall, type ClayBlob } from './metaball'

/**
 * 泥团：一团泥（S0）→ 四块泥（S1）与拆分动画。
 * 几何全部程序生成（SphereGeometry 缩放 / marching cubes 势场），不依赖模型资产（开发计划 §4）；
 * 表面只用一张 CC0 漫反射贴图（`clay.albedo`）。
 * 坐标系：以桌面中心为原点，y 向上；工位偏移来自数据表。
 */
const WHOLE = data.whole
const CHUNK = data.chunk
const STATIONS = data.stations as unknown as Record<Part, readonly [number, number]>
const PARTS = data.parts as Part[]
const ANIM = data.animation

/** 拆分动画时长（秒）。 */
export const SPLIT_SECONDS = 1.6

/** 湿泥色（设计文档 §2.5：深、略有反光）。阴干后换干坯色是另一阶段的事。 */
export const WET_CLAY = clayData.tint

export interface ClayRig {
  readonly group: THREE.Group
  /** 整团泥（S0 静置） */
  readonly whole: THREE.Mesh
  /** 四块泥，按部位（S1 静置、后续捏与上釉都走它们） */
  readonly chunks: Record<Part, THREE.Mesh>
  /** 拆分动画期间才存在的势场流体（1.6 秒后隐藏） */
  readonly blob: MarchingCubes
  /** 设置比例并重算四块体积：块体积 = 整团体积 × 占比 */
  setSplit(split: Split): void
  /** 显示整团 / 隐藏四块（S0） */
  showWhole(): void
  /** 显示四块停在工位 / 隐藏整团（读档恢复 S1） */
  showChunks(): void
  /**
   * 拆分动画某一帧的姿态，p ∈ [0,1]（节奏见数据表 animation）：
   * 四颗势场球从整团位置水平拉开，势场表面先融合成一整团、被拉长变细、
   * 再断裂成四块，末段交叉淡出到四块真网格。全程贴桌面，不向上抬。
   */
  poseSplit(p: number): void
  dispose(): void
}

export interface ClayRigOptions {
  /** 工位标签文字（UI 层用 t() 注入，render 不依赖 content） */
  label?: (part: Part) => string
}

export function createClayRig(opts: ClayRigOptions = {}): ClayRig {
  const group = new THREE.Group()

  const wholeMat = clayMaterial()
  const whole = new THREE.Mesh(new THREE.SphereGeometry(WHOLE.radius, 48, 32), wholeMat)
  whole.castShadow = true
  whole.receiveShadow = true
  group.add(whole)

  const chunks = {} as Record<Part, THREE.Mesh>
  const labels = {} as Record<Part, THREE.Sprite>
  for (const part of PARTS) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(CHUNK.unitRadius, 40, 28), clayMaterial())
    m.castShadow = true
    m.receiveShadow = true
    m.visible = false
    group.add(m)
    chunks[part] = m
    if (opts.label) {
      const sprite = makeLabel(opts.label(part))
      sprite.visible = false
      group.add(sprite)
      labels[part] = sprite
    }
  }

  const blobMat = clayMaterial()
  const BLOB = ANIM.blob
  const blob: ClayBlob = createClayBlob(blobMat, {
    resolution: BLOB.resolution,
    extent: BLOB.extent,
    squash: WHOLE.squash,
    fieldRadius: BLOB.fieldRadius,
  })
  blob.mesh.visible = false
  group.add(blob.mesh)

  let split: Split = data.default as Split

  /** 整团泥的半径（缩放 1 时） */
  const wholeRadius = WHOLE.radius

  /** 第 i 块的缩放：体积守恒 → (unitRadius·s)²·squash·s = 整团体积·share */
  function chunkScale(share: number): number {
    const wholeVol = WHOLE.radius ** 2 * WHOLE.squash
    return Math.cbrt((wholeVol * share) / (CHUNK.unitRadius ** 2 * CHUNK.squash))
  }

  /** 块静止时的高度（底部贴桌面） */
  function chunkRestY(part: Part): number {
    return CHUNK.unitRadius * chunks[part].scale.y
  }

  /** 势场球的世界半径：体积 ∝ 占比（半径 ∝ 占比的立方根） */
  function blobRadius(share: number): number {
    return 2 * BLOB.extent * BLOB.fieldRadius * Math.cbrt(share)
  }

  /**
   * 四颗球完全重叠时，势场表面比「半径之和」大一圈，按合并后的实际半径归一，
   * 让开局那团和 SphereGeometry 整团一样大（切换看不出来）。
   * 单球：strength / r² - subtract = isolation；合并后：Σ(2rᵢ² / r²) - 4·isolation = isolation。
   */
  function mergedFit(): number {
    const sum = PARTS.reduce((acc, part) => acc + Math.cbrt(split[part]) ** 2, 0)
    const sumR2 = BLOB.fieldRadius ** 2 * sum
    const mergedQ = Math.sqrt((2 * sumR2) / 5)
    return wholeRadius / (2 * BLOB.extent * mergedQ)
  }

  const rig: ClayRig = {
    group,
    whole,
    chunks,
    blob: blob.mesh,
    setSplit(next) {
      split = { ...next }
      for (const part of PARTS) {
        const s = chunkScale(split[part])
        chunks[part].scale.set(s, s * CHUNK.squash, s)
        const [x, z] = STATIONS[part]
        chunks[part].position.set(x, chunkRestY(part), z)
        labels[part]?.position.set(x, chunkRestY(part) * 2 + 0.03, z)
      }
      whole.position.y = wholeRadius * WHOLE.squash
    },
    showWhole() {
      whole.visible = true
      whole.scale.set(1, WHOLE.squash, 1)
      whole.position.y = wholeRadius * WHOLE.squash
      setNoise(wholeMat, 0)
      blob.setOpacity(0)
      for (const p of PARTS) {
        fadeTo(chunks[p], 0)
        if (labels[p]) labels[p].visible = false
        setNoise(chunks[p].material as THREE.Material, 0)
      }
    },
    showChunks() {
      whole.visible = false
      blob.setOpacity(0)
      for (const p of PARTS) {
        fadeTo(chunks[p], 1)
        if (labels[p]) labels[p].visible = true
        const [x, z] = STATIONS[p]
        chunks[p].position.set(x, chunkRestY(p), z)
        setNoise(chunks[p].material as THREE.Material, 0)
      }
    },
    poseSplit(p) {
      whole.visible = false

      // ① 势场：球心水平分开（错开一点出发），球半径从「合并后正好是一整团」长到真实体积
      const grow = eased(p / ANIM.fit)
      const scale = mergedFit() + (1 - mergedFit()) * grow
      const balls: BlobBall[] = PARTS.map((part, i) => {
        const t = clamp01((p / ANIM.travel - i * ANIM.stagger) / (1 - i * ANIM.stagger))
        const k = eased(t)
        const [x, z] = STATIONS[part]
        const radius = blobRadius(split[part]) * scale
        return {
          x: x * k,
          // 球心高度 = 球自身的竖直半径：底部始终贴桌面，横向滑动时不会浮空也不会抬升
          y: radius * WHOLE.squash,
          z: z * k,
          radius,
        }
      })
      blob.update(balls)

      // ② 末段交叉淡出：势场消失、真网格淡入（位置已经对齐，看起来是最后一点黏丝断开）
      const mix = clamp01((p - ANIM.swap) / ANIM.swapFade)
      blob.setOpacity(1 - mix)
      for (const part of PARTS) {
        fadeTo(chunks[part], mix)
        if (labels[part]) labels[part].visible = mix > 0.5
      }
    },
    dispose() {
      blob.dispose()
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
        if ((obj as THREE.Sprite).isSprite) {
          const sm = (obj as THREE.Sprite).material
          sm.map?.dispose()
          sm.dispose()
          return
        }
        const m = mesh.material as THREE.Material | undefined
        m?.dispose()
      })
    },
  }
  rig.setSplit(split)
  rig.showWhole()
  return rig
}

// ─── 湿泥材质：一张 CC0 漫反射 + 程序噪声法线（打散光滑球面那条干净的镜面高光） ───

const NOISE = 'uNoise'

/** 贴图全局共用一份（四块泥 + 整团 + 势场），避免重复解码。 */
let texture: THREE.Texture | null = null

function clayTexture(): THREE.Texture {
  if (texture) return texture
  // 单测跑在 node 里，没有 DOM 也就没有 ImageLoader；几何断言不需要贴图
  const tex =
    typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(assetId(clayData.albedo as 'clay.albedo').url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(clayData.repeat, clayData.repeat)
  tex.anisotropy = 4
  texture = tex
  return tex
}

function clayMaterial(): THREE.Material {
  const grain = clayData.grain
  const mat = new THREE.MeshStandardMaterial({
    color: WET_CLAY,
    map: clayTexture(),
    roughness: clayData.roughness,
    metalness: clayData.metalness,
  })
  const uniform: THREE.IUniform<number> = { value: 0 }
  ;(mat as THREE.Material & { userData: { noise?: THREE.IUniform<number> } }).userData.noise = uniform
  mat.onBeforeCompile = (shader) => {
    shader.uniforms[NOISE] = uniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float ${NOISE};\n`)
      // 程序噪声法线：打散光滑球面那条干净的镜面高光
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         float grainX = position.x * ${num(grain.frequency[1])} + position.y * ${num(grain.frequency[0])};
         float grainY = position.y * ${num(grain.frequency[0])} + position.z * ${num(grain.frequency[2])};
         float grainZ = position.z * ${num(grain.frequency[2])} - position.x * ${num(grain.frequency[1])};
         objectNormal = normalize(objectNormal + vec3(sin(grainX), sin(grainY), sin(grainZ)) * ${num(grain.normal)});`,
      )
      // 顶点噪声：静置时是 0；只有显式设置才会动（预留给马赛克阶段的「泥在涌」）
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed += normal * ${NOISE} * sin(position.y * ${num(grain.frequency[0])} + position.x * ${num(grain.frequency[1])} + position.z * ${num(grain.frequency[2])});`,
      )
  }
  return mat
}

/** 浮点数写成 GLSL 字面量（必须带小数点）。 */
function num(v: number): string {
  return v.toFixed(1)
}

function setNoise(mat: THREE.Material, amount: number): void {
  const u = (mat as THREE.Material & { userData: { noise?: THREE.IUniform<number> } }).userData.noise
  if (u) u.value = amount
}

/** 0 = 隐藏，1 = 不透明；中间值走高透明，供拆分末段交叉淡出用。 */
function fadeTo(mesh: THREE.Mesh, alpha: number): void {
  const mat = mesh.material as THREE.MeshStandardMaterial
  if (alpha <= 0.001) {
    mesh.visible = false
    mesh.castShadow = false
    return
  }
  mesh.visible = true
  const opaque = alpha > 0.999
  if (mat.transparent === opaque) {
    mat.transparent = !opaque
    mat.depthWrite = opaque
    mat.needsUpdate = true
  }
  mat.opacity = opaque ? 1 : alpha
  mesh.castShadow = opaque
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** smoothstep：起止都平滑，读起来像黏稠的流体而不是机械位移。 */
function eased(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 34px "PingFang SC", "Songti SC", "Noto Sans CJK SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#f3ead9'
  ctx.fillText(text, 64, 32)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sprite.scale.set(0.12, 0.06, 1)
  return sprite
}
