export interface GestureHandlers {
  onDrag?: (dx: number, dy: number, x: number, y: number) => void
  onPinch?: (delta: number) => void
  onWheel?: (dy: number) => void
  onDown?: (x: number, y: number) => void
  onUp?: (x: number, y: number) => void
}

export function bindGestures(el: HTMLElement, handlers: GestureHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  const distance = () => {
    const pts = [...pointers.values()]
    if (pts.length < 2) return 0
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }
  const down = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof Element && target.closest('.master-pop')) return
    el.setPointerCapture?.(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) handlers.onDown?.(event.clientX, event.clientY)
    if (pointers.size >= 2) pinch = distance()
  }
  const move = (event: PointerEvent) => {
    const prev = pointers.get(event.pointerId)
    if (!prev) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) handlers.onDrag?.(event.clientX - prev.x, event.clientY - prev.y, event.clientX, event.clientY)
    if (pointers.size >= 2 && pinch > 0) {
      const next = distance()
      handlers.onPinch?.(next - pinch)
      pinch = next
    }
  }
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
    handlers.onUp?.(event.clientX, event.clientY)
    pinch = 0
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    handlers.onWheel?.(event.deltaY)
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  el.addEventListener('wheel', wheel, { passive: false })
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    el.removeEventListener('wheel', wheel)
  }
}
