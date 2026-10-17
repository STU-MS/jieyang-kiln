import { generateTexture, type TextureParams } from '../sim/kilnTexture'

const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<{ params: TextureParams; size: number }>) => {
  const baked = generateTexture(event.data.params, event.data.size)
  scope.postMessage(baked, [baked.albedo.buffer, baked.roughness.buffer])
}
