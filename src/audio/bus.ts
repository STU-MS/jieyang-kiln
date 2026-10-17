import { assetId, resolveSync } from '../assets/registry'

let ctx: AudioContext | null = null
const cues = {
  knead: assetId('audio.sfx.knead'),
  wheel: assetId('audio.sfx.wheel'),
  tool: assetId('audio.sfx.tool'),
  kiln: assetId('audio.sfx.kiln'),
  open: assetId('audio.sfx.open'),
  warn: assetId('audio.sfx.warn'),
  voice: assetId('audio.voice.master'),
}

export function resumeAudio(): void {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  if (!ctx) ctx = new Ctx()
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

export function playCue(name: keyof typeof cues): void {
  const id = cues[name]
  const entry = resolveSync(id)
  if (!entry.url || entry.type === 'silent') return
  if (!ctx) return
  const context = ctx
  void fetch(entry.url)
    .then((res) => {
      if (!res.ok) throw new Error('missing')
      return res.arrayBuffer()
    })
    .then((buffer) => context.decodeAudioData(buffer))
    .then((audio) => {
      const source = context.createBufferSource()
      source.buffer = audio
      source.connect(context.destination)
      source.start()
    })
    .catch(() => undefined)
}
