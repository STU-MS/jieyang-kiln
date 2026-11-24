import data from '../data/split.json'
import { clamp } from './math'
import type { Part, Split } from '../game/types'

/**
 * 拆泥规则（设计文档 §2.1）：四段和恒为 1，每段不低于最小值。
 * 滑杆用「分隔块位置」表达：三个分隔块 b0 ≤ b1 ≤ b2 ∈ [0,1]，
 * head = b0，body = b1 - b0，arms = b2 - b1，legs = 1 - b2。
 */
export const PARTS = data.parts as Part[]
export const MIN_PART = data.min as Record<Part, number>

/** 新局默认比例（数据表）。每次返回新对象。 */
export function defaultSplit(): Split {
  return { ...(data.default as Split) }
}

/** 分隔块位置 → 四段比例。不夹取：越界由 clampDivider 负责。 */
export function toSplit(dividers: readonly [number, number, number]): Split {
  const [a, b, c] = dividers
  return { head: a, body: b - a, arms: c - b, legs: 1 - c }
}

/** 四段比例 → 分隔块位置。 */
export function toDividers(split: Split): [number, number, number] {
  return [split.head, split.head + split.body, split.head + split.body + split.arms]
}

/** 第 k 段的最小值（k = 0..3）。 */
function minOf(k: number): number {
  return MIN_PART[PARTS[k]]
}

/** 第 i 个分隔块只看全局最小值时的理论区间。 */
function bound(i: 0 | 1 | 2): readonly [number, number] {
  let lo = 0
  for (let k = 0; k <= i; k++) lo += minOf(k)
  let hi = 1
  for (let k = i + 1; k < 4; k++) hi -= minOf(k)
  return [lo, hi]
}

/**
 * 把第 i 个分隔块拖到 want，返回新的三个位置。
 * 被两边夹住：前一个分隔块 + 左段最小值 ≤ want ≤ 后一个分隔块 − 右段最小值，
 * 再夹全局理论区间。结果保证四段都 ≥ 最小值、和恒为 1、分隔块不互穿。
 */
export function clampDivider(dividers: readonly [number, number, number], i: 0 | 1 | 2, want: number): [number, number, number] {
  const [glo, ghi] = bound(i)
  const lo = i === 0 ? glo : Math.max(dividers[i - 1] + minOf(i), glo)
  const hi = i === 2 ? ghi : Math.min(dividers[i + 1] - minOf(i + 1), ghi)
  const out: [number, number, number] = [dividers[0], dividers[1], dividers[2]]
  out[i] = clamp(want, lo, hi)
  return out
}

/**
 * 是否合法比例：四个部位都是有限数、每段 ≥ 最小值、和为 1（容差 1e-9，浮点）。
 * 读档用：不是合法比例的存档当坏档。
 */
export function isValidSplit(raw: unknown): raw is Split {
  if (!raw || typeof raw !== 'object') return false
  const s = raw as Record<string, unknown>
  for (const p of PARTS) {
    const v = s[p]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_PART[p] - 1e-9 || v > 1) return false
  }
  const total = PARTS.reduce((t, p) => t + (s[p] as number), 0)
  return Math.abs(total - 1) <= 1e-9
}
