import data from '../data/dry.json'
import type { GameSession } from '../game/types'

/**
 * 阴干规则（设计文档 §2.5）：纯视觉过场，不改任何玩法数据。
 * 状态只有一个单向门 s5_dried——干坯不会变回湿泥，没有「撤销阴干」。
 * 颜色与粗糙度插值给渲染层用：过场期间每帧调 dryColorAt(t)。
 */
export const TRANSITION_MS: number = data.transitionMs

export interface SurfaceLook {
  /** #rrggbb */
  readonly color: string
  /** 0 = 镜面，1 = 全哑光。湿泥低（有反光），干坯高（无反光）。 */
  readonly roughness: number
}

const WET: SurfaceLook = { color: data.wet.color, roughness: data.wet.roughness }
const DRY: SurfaceLook = { color: data.dry.color, roughness: data.dry.roughness }

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`色值不是 #rrggbb：${hex}`)
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * 过场进度 t（0 = 全湿，1 = 全干）对应的表面外观。
 * t 越界夹取到 [0,1]；两端点返回的数据表原值，中间线性插值。
 */
export function dryColorAt(t: number): SurfaceLook {
  const u = Math.min(Math.max(t, 0), 1)
  const w = hexToRgb(WET.color)
  const d = hexToRgb(DRY.color)
  return {
    color: rgbToHex(w[0] + (d[0] - w[0]) * u, w[1] + (d[1] - w[1]) * u, w[2] + (d[2] - w[2]) * u),
    roughness: WET.roughness + (DRY.roughness - WET.roughness) * u,
  }
}

/** 这一局是否已经阴干过。undefined 与 false 都算没干。 */
export function isDried(session: GameSession): boolean {
  return session.s5_dried === true
}

/**
 * 标记阴干完成，返回新一局（不改入参）。
 * 单向门：已 dried 再调是无操作；除此之外不动任何其他字段（不变量：阴干不改玩法数据）。
 */
export function markDried(session: GameSession): GameSession {
  if (isDried(session)) return session
  return { ...session, s5_dried: true }
}
