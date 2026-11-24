import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createClayRig } from './clay'
import data from '../data/split.json'

/**
 * 泥块体积必须等于整团泥 × 占比（设计文档 §2.1「硬约束」）。
 * 只测几何体积关系，不测渲染。
 */
describe('泥团：体积按比例拆', () => {
  it('四块体积之和 = 整团体积；每块 = 整团 × 占比（±1%）', () => {
    const rig = createClayRig()
    const split = { head: 0.7, body: 0.1, arms: 0.1, legs: 0.1 }
    rig.setSplit(split)
    const wholeVol = volume(rig.whole)
    let total = 0
    for (const part of data.parts as (keyof typeof split)[]) {
      const v = volume(rig.chunks[part])
      expect(v / wholeVol).toBeCloseTo(split[part], 2)
      total += v
    }
    expect(total / wholeVol).toBeCloseTo(1, 2)
    rig.dispose()
  })

  it('默认比例也成立（四块加起来正好是那团泥）', () => {
    const rig = createClayRig()
    rig.setSplit(data.default as Record<'head' | 'body' | 'arms' | 'legs', number>)
    const wholeVol = volume(rig.whole)
    const sum = (data.parts as ('head' | 'body' | 'arms' | 'legs')[]).reduce((s, p) => s + volume(rig.chunks[p]), 0)
    expect(sum / wholeVol).toBeCloseTo(1, 2)
    rig.dispose()
  })
})

describe('泥团：显示状态', () => {
  it('整团 / 四块互斥', () => {
    const rig = createClayRig()
    rig.showWhole()
    expect(rig.whole.visible).toBe(true)
    expect(rig.chunks.head.visible).toBe(false)
    rig.showChunks()
    expect(rig.whole.visible).toBe(false)
    expect(rig.chunks.head.visible).toBe(true)
    rig.dispose()
  })

  it('拆分动画首尾：p=0 只有一整团，p=1 四块都在工位且落在桌面上', () => {
    const rig = createClayRig()
    rig.poseSplit(0)
    expect(rig.blob.visible).toBe(true)
    expect(rig.whole.visible).toBe(false)
    expect(rig.chunks.head.visible).toBe(false)
    rig.poseSplit(1)
    expect(rig.whole.visible).toBe(false)
    const box = new THREE.Box3()
    const size = new THREE.Vector3()
    for (const part of data.parts as ('head' | 'body' | 'arms' | 'legs')[]) {
      const m = rig.chunks[part]
      expect(m.visible).toBe(true)
      const [x, z] = (data.stations as Record<string, number[]>)[part]
      expect(m.position.x).toBeCloseTo(x, 6)
      expect(m.position.z).toBeCloseTo(z, 6)
      // 底部贴桌面（y = 0 平面）——不能浮空也不能陷入
      box.setFromObject(m)
      box.getSize(size)
      expect(box.min.y).toBeCloseTo(0, 6)
    }
    rig.dispose()
  })
})

describe('泥团：整团也落在桌面上', () => {
  it('整团底部贴 y = 0（不浮空、不陷入桌面）', () => {
    const rig = createClayRig()
    rig.showWhole()
    const box = new THREE.Box3().setFromObject(rig.whole)
    expect(box.min.y).toBeCloseTo(0, 6)
    rig.dispose()
  })
})

/** 世界空间包围盒体积（几何是球缩放，盒体积即 (2r_x)(2r_y)(2r_z)）。 */
function volume(obj: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(obj)
  const size = new THREE.Vector3()
  box.getSize(size)
  return size.x * size.y * size.z
}

/**
 * 拆分动画是「流体被拉开再断」：势场表面先是一整团，途中被拉长变细，
 * 最后断成四块，贴桌面水平分开，不向上抬。
 * 只断言看得见的行为（几块、离不离桌、多高、多大），不管缓动函数与势场参数怎么写。
 */
describe('泥团：拆分是势场流体被拉开断成四块', () => {
  const parts = data.parts as ('head' | 'body' | 'arms' | 'legs')[]

  it('开局一个连通体，结尾断成四个（不是四个椭球各自滑走）', () => {
    const rig = createClayRig()
    rig.poseSplit(0)
    expect(components(rig.blob)).toBe(1)
    rig.poseSplit(1)
    expect(components(rig.blob)).toBe(4)
    rig.dispose()
  })

  it('断开是一步步发生：中途至少有某个时刻已经是两块以上', () => {
    const rig = createClayRig()
    const counts: number[] = []
    for (const p of [0.3, 0.5, 0.7]) {
      rig.poseSplit(p)
      counts.push(components(rig.blob))
    }
    // 越拉越散：连通块数量单调不减
    expect(counts[0]).toBeLessThanOrEqual(counts[1])
    expect(counts[1]).toBeLessThanOrEqual(counts[2])
    expect(counts[2]).toBeGreaterThan(counts[0])
    rig.dispose()
  })

  it('开局势场整团和静置的整团一样大（切换看不出来）', () => {
    const rig = createClayRig()
    rig.showWhole()
    const wholeSize = size(worldBox(rig.whole))
    rig.poseSplit(0)
    const blobSize = size(blobBox(rig.blob))
    expect(blobSize.x / wholeSize.x).toBeGreaterThan(0.9)
    expect(blobSize.x / wholeSize.x).toBeLessThan(1.1)
    expect(blobSize.y / wholeSize.y).toBeGreaterThan(0.85)
    expect(blobSize.y / wholeSize.y).toBeLessThan(1.15)
    rig.dispose()
  })

  it('全程贴桌面、不向上长高', () => {
    const rig = createClayRig()
    rig.poseSplit(0)
    const initialTop = blobBox(rig.blob).max.y
    for (const p of [0.2, 0.4, 0.6, 0.8, 0.95]) {
      rig.poseSplit(p)
      const box = blobBox(rig.blob)
      // 底部贴桌面（y = 0 平面）：势场格子有厚度，允许一个格子的误差
      expect(box.min.y).toBeGreaterThan(-0.02)
      expect(box.min.y).toBeLessThan(0.02)
      // 任何时刻都不比开局那团高——没有向上拉长
      expect(box.max.y).toBeLessThan(initialTop + 0.02)
    }
    rig.dispose()
  })

  it('末段换成四块真网格，位置与势场落点一致', () => {
    const rig = createClayRig()
    rig.poseSplit(1)
    for (const part of parts) {
      const m = rig.chunks[part]
      expect(m.visible).toBe(true)
      expect((m.material as THREE.Material).transparent).toBe(false)
      const [x, z] = (data.stations as Record<string, number[]>)[part]
      expect(m.position.x).toBeCloseTo(x, 6)
      expect(m.position.z).toBeCloseTo(z, 6)
    }
    expect(rig.blob.visible).toBe(false)
    rig.dispose()
  })
})

/**
 * 数连通体：把势场网格的三角面顶点按格子聚簇，再算格子连通块数。
 * 一整团 = 1，断开成四块 = 4。格子比断口小一个量级，所以不会把断口糊上。
 */
function components(mesh: THREE.Mesh): number {
  const geom = mesh.geometry as THREE.BufferGeometry
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const count = geom.drawRange.count === Infinity ? pos.count : geom.drawRange.count
  const cell = 0.08
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const parent = new Map<string, string>()

  function find(k: string): string {
    const p = parent.get(k)
    if (p === undefined || p === k) return k
    const root = find(p)
    parent.set(k, root)
    return root
  }
  function union(a: string, b: string): void {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const cellOf = (i: number) =>
    key(
      Math.floor(pos.getX(i) / cell),
      Math.floor(pos.getY(i) / cell),
      Math.floor(pos.getZ(i) / cell),
    )

  for (let i = 0; i < count; i += 3) {
    const a = cellOf(i)
    const b = cellOf(i + 1)
    const c = cellOf(i + 2)
    for (const k of [a, b, c]) if (!parent.has(k)) parent.set(k, k)
    union(a, b)
    union(a, c)
  }
  const roots = new Set<string>()
  for (const k of parent.keys()) roots.add(find(k))
  return roots.size
}

function worldBox(obj: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(obj)
}

/** 势场网格只渲染 drawRange 内的三角面，包围盒要按 drawRange 算（缓冲区里有上一帧的残值）。 */
function blobBox(mesh: THREE.Mesh): THREE.Box3 {
  const geom = mesh.geometry as THREE.BufferGeometry
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const count = geom.drawRange.count === Infinity ? pos.count : geom.drawRange.count
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i))
  return box.applyMatrix4(mesh.matrixWorld)
}

function size(box: THREE.Box3): THREE.Vector3 {
  return box.getSize(new THREE.Vector3())
}
