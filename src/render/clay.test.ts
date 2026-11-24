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

  it('拆分动画首尾：p=0 只有整团，p=1 四块都在工位且落在桌面上', () => {
    const rig = createClayRig()
    rig.poseSplit(0)
    expect(rig.whole.visible).toBe(true)
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
