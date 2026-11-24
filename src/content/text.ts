/**
 * 文案出口。所有用户可见文字走 t() / f()，不写在组件里。
 * 字典来源：src/content/ui.json（扁平 key → 文本）。
 */
import ui from './ui.json'

const dict = new Map<string, string>(Object.entries(ui))

export function t(id: string): string {
  return dict.get(id) ?? id
}

/** 带变量：f('ui.x', { n: 30 }) 把 {n} 换成 30。 */
export function f(id: string, vars: Record<string, string | number>): string {
  return t(id).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export function hasText(id: string): boolean {
  return dict.has(id)
}

export function allTextIds(): string[] {
  return [...dict.keys()]
}
