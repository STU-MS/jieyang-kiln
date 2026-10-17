import { assetId } from '../assets/registry'
import { generateTexture, type TextureParams } from '../sim/kilnTexture'
import { getMemoryTexture, rememberTexture } from '../persist/textures'

const budgetMs = 800

function runWorker(params: TextureParams, size: number, budget: number): Promise<{ albedo: Uint8ClampedArray; roughness: Uint8ClampedArray; size: number }> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./kilnWorker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(error)
      return
    }
    const timer = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('timeout'))
    }, budget)
    worker.onmessage = (event: MessageEvent<{ albedo: Uint8ClampedArray; roughness: Uint8ClampedArray; size: number }>) => {
      window.clearTimeout(timer)
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = () => {
      window.clearTimeout(timer)
      worker.terminate()
      reject(new Error('worker'))
    }
    worker.postMessage({ params, size })
  })
}

function toCanvas(pixels: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const copy = new Uint8ClampedArray(pixels)
  ctx.putImageData(new ImageData(copy, size, size), 0, 0)
  return canvas
}

export async function bakeCupTexture(uniqueId: string, params: TextureParams): Promise<{ albedo: HTMLCanvasElement; roughness: HTMLCanvasElement; size: number }> {
  const cached = getMemoryTexture(uniqueId)
  if (cached) return { ...cached, size: cached.albedo.width }
  let baked: { albedo: Uint8ClampedArray; roughness: Uint8ClampedArray; size: number }
  try {
    baked = await runWorker(params, 1024, budgetMs)
  } catch {
    try {
      baked = await runWorker(params, 512, budgetMs)
    } catch {
      baked = generateTexture(params, 512)
    }
  }
  const albedo = toCanvas(baked.albedo, baked.size)
  const roughness = toCanvas(baked.roughness, baked.size)
  rememberTexture(uniqueId, albedo, roughness)
  return { albedo, roughness, size: baked.size }
}

export function textureSeed(uniqueId: string): number {
  let h = 2166136261
  const id = assetId('tex.clay.albedo')
  const text = `${uniqueId}|${id}`
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
