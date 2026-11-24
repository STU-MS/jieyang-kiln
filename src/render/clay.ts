import * as THREE from 'three'
import data from '../data/split.json'
import type { Part, Split } from '../game/types'

/**
 * 泥团：一团泥（S0）→ 四块泥（S1）与拆分动画。
 * 几何全部程序生成（SphereGeometry 缩放），不依赖资产文件（开发计划 §4）。
 * 坐标系：以桌面中心为原点，y 向上；工位偏移来自数据表。
 */
const WHOLE = data.whole
const CHUNK = data.chunk
const STATIONS = data.stations as unknown as Record<Part, readonly [number, number]>
const PARTS = data.parts as Part[]

/** 拆分动画时长（秒）。 */
export const SPLIT_SECONDS = 1.6

/** 湿泥色（设计文档 §2.5：深、略有反光）。阴干后换干坯色是另一阶段的事。 */
export const WET_CLAY = '#6b4a35'

export interface ClayRig {
  readonly group: THREE.Group
  /** 整团泥 */
  readonly whole: THREE.Mesh
  /** 四块泥，按部位 */
  readonly chunks: Record<Part, THREE.Mesh>
  /** 设置比例并重算四块体积：块体积 = 整团体积 × 占比 */
  setSplit(split: Split): void
  /** 显示整团 / 隐藏四块（S0） */
  showWhole(): void
  /** 显示四块停在工位 / 隐藏整团（读档恢复 S1） */
  showChunks(): void
  /**
   * 拆分动画某一帧的姿态，p ∈ [0,1]：
   * 0–0.3 整团拉长变细；0.3 起整团换成四块（已按比例），
   * 四块沿弧线飞到工位，带 overshoot 回弹，顶点噪声从强收敛到 0。
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

  const rig: ClayRig = {
    group,
    whole,
    chunks,
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
      for (const p of PARTS) {
        chunks[p].visible = false
        if (labels[p]) labels[p].visible = false
        setNoise(chunks[p].material as THREE.Material, 0)
      }
    },
    showChunks() {
      whole.visible = false
      for (const p of PARTS) {
        chunks[p].visible = true
        if (labels[p]) labels[p].visible = true
        const [x, z] = STATIONS[p]
        chunks[p].position.set(x, chunkRestY(p), z)
        setNoise(chunks[p].material as THREE.Material, 0)
      }
    },
    poseSplit(p) {
      const PULL = 0.3
      whole.visible = p < PULL
      if (whole.visible) {
        const stretch = 1 + easeOut(p / PULL) * 0.9
        whole.scale.set(1 / Math.sqrt(stretch), WHOLE.squash * stretch, 1 / Math.sqrt(stretch))
        // 底部贴桌面，向上拉长
        whole.position.y = wholeRadius * WHOLE.squash * stretch
        setNoise(wholeMat, (p / PULL) * 0.03)
      }
      const t = clamp01((p - PULL) / (1 - PULL))
      for (const part of PARTS) {
        const m = chunks[part]
        const on = p >= PULL
        m.visible = on
        if (labels[part]) labels[part].visible = on && t > 0.8
        if (!on) continue
        const [x, z] = STATIONS[part]
        const k = backOut(t, 1.4)
        // 弧线：先抬再落，落到工位后贴桌面
        m.position.set(x * k, chunkRestY(part) + Math.sin(Math.min(k, 1) * Math.PI) * 0.08, z * k)
        setNoise(m.material as THREE.Material, (1 - t) * 0.04)
      }
    },
    dispose() {
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

// ─── 湿泥材质 + 顶点噪声（「泥涌出来」的近似；设计文档 §2.2 做法，拆分动画复用） ───

const NOISE = 'uNoise'

function clayMaterial(): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({ color: WET_CLAY, roughness: 0.55, metalness: 0 })
  const uniform: THREE.IUniform<number> = { value: 0 }
  ;(mat as THREE.Material & { userData: { noise?: THREE.IUniform<number> } }).userData.noise = uniform
  mat.onBeforeCompile = (shader) => {
    shader.uniforms[NOISE] = uniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float ${NOISE};\n`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed += normal * ${NOISE} * sin(position.y * 70.0 + position.x * 50.0 + position.z * 30.0);`,
      )
  }
  return mat
}

function setNoise(mat: THREE.Material, amount: number): void {
  const u = (mat as THREE.Material & { userData: { noise?: THREE.IUniform<number> } }).userData.noise
  if (u) u.value = amount
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** back-out：先过冲再回弹。 */
function backOut(t: number, s: number): number {
  const c = s + 1
  const u = t - 1
  return 1 + c * u * u * u + s * u * u
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
