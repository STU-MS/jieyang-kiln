import shape from '../data/shape.json'
import { clamp } from './math'
import type { GameSession, Part, ShapeState, ShapeValues } from '../game/types'

/**
 * 捏的规则（设计文档 §2.2）：每部位一组滑杆，每根滑杆 0–1，中心 0.5 = 默认形状。
 * 滑杆 id、文案 key、对应 morph target 全部来自数据表 src/data/shape.json，代码不写死 id。
 */

export interface ShapeChannel {
  /** MakeHuman / MPFB 的 morph target 名 */
  morph: string
  /** +1 = 滑杆往大走时权重上升；-1 = 往小走时上升 */
  dir: 1 | -1
}

export interface ShapeSlider {
  id: string
  /** 文案 key（走 t()） */
  text: string
  channels: ShapeChannel[]
}

export const SHAPE_PARTS: readonly Part[] = ['head', 'body', 'arms', 'legs']

/** 工位摆放参数（`birth.pose`）：模型正面朝摄像机、身 / 手 / 脚仰面平躺。 */
export interface PartPose {
  /** 绕世界 Z 的躺平角度（度），0 = 直立 */
  readonly lie: number
  /** 聚焦该部位时的俯角（度） */
  readonly focusPitch: number
}

const POSE_DATA = shape.birth.pose as unknown as { yaw: number; parts: Record<Part, PartPose> }

/** 全部部位共用：绕世界 Y 让模型正面（+Z）对准摄像机 */
export function poseYaw(): number {
  return POSE_DATA.yaw
}

/** 某个部位在工位上的摆放：躺平角度与聚焦俯角（度）。缺表就是数据错，直接抛。 */
export function poseOf(part: Part): PartPose {
  const pose = POSE_DATA.parts[part]
  if (!pose) throw new Error(`shape.json 的 birth.pose.parts 缺 ${part}`)
  return pose
}
/** 滑杆中心：值 = 中心 → 默认形状，所有 morph 权重为 0 */
export const SHAPE_CENTER = shape.value.neutral
export const SHAPE_MIN = shape.value.min
export const SHAPE_MAX = shape.value.max

const PARTS_DATA = shape.parts as unknown as Record<Part, { sliders: ShapeSlider[] }>

/** 某部位的滑杆定义，顺序即面板顺序（数据表是唯一来源）。 */
export function shapeSliders(part: Part): ShapeSlider[] {
  return PARTS_DATA[part].sliders
}

/** 新局每部位每根滑杆的默认值：全部为中性（默认形状）。每次返回新对象。 */
export function defaultShapeValues(): Record<Part, ShapeValues> {
  const out = {} as Record<Part, ShapeValues>
  for (const part of SHAPE_PARTS) {
    const values: ShapeValues = {}
    for (const slider of shapeSliders(part)) values[slider.id] = SHAPE_CENTER
    out[part] = values
  }
  return out
}

/** 出生变形动画是否播放过：新局全未播放。 */
export function defaultAnimated(): Record<Part, boolean> {
  const out = {} as Record<Part, boolean>
  for (const part of SHAPE_PARTS) out[part] = false
  return out
}

/** 完整的新局 s2_shape（默认值 + 未播放动画）。 */
export function defaultShapeState(): ShapeState {
  return { ...defaultShapeValues(), animated: defaultAnimated() }
}

/** 夹到 [0,1]；非有限数（NaN / Infinity / 非数字）退回中性，等于默认形状。 */
export function clampShapeValue(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SHAPE_CENTER
  return clamp(v, SHAPE_MIN, SHAPE_MAX)
}

/**
 * 某部位的滑杆值 → morph 权重表（0–1，未出现的通道不返回）。
 * 同一部位的每个通道都算：dir>0 → 中心以上的部分翻倍，dir<0 → 中心以下的部分翻倍。
 * 缺的滑杆 id 按中性处理（权重 0）。
 */
export function morphWeights(part: Part, values: ShapeValues): Record<string, number> {
  const out: Record<string, number> = {}
  for (const slider of shapeSliders(part)) {
    const v = clampShapeValue(values[slider.id])
    for (const ch of slider.channels) {
      const w = ch.dir > 0 ? Math.max(0, v - SHAPE_CENTER) * 2 : Math.max(0, SHAPE_CENTER - v) * 2
      out[ch.morph] = clamp((out[ch.morph] ?? 0) + w, 0, 1)
    }
  }
  return out
}

/** ③ 姿势是否解锁：四个部位都播放过出生变形动画。 */
export function poseUnlocked(session: GameSession): boolean {
  const animated = session.s2_shape.animated
  return SHAPE_PARTS.every((part) => animated[part])
}
