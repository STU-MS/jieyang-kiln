import { colorOf } from '../assets/registry'
import { t } from '../content/text'
import { glazeById } from '../sim/glaze'
import type { CupSnapshot } from '../sim/types'

export async function downloadShare(shot: CupSnapshot, photo?: string): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1440
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = colorOf('ui.share.frame')
  ctx.fillRect(0, 0, 1080, 1440)
  ctx.strokeStyle = '#6E5344'
  ctx.lineWidth = 18
  ctx.strokeRect(36, 36, 1008, 1368)
  ctx.fillStyle = '#3A332C'
  ctx.font = '64px "Songti SC", "SimSun", serif'
  ctx.fillText(t('ui.appTitle'), 90, 150)
  ctx.font = '32px system-ui, sans-serif'
  ctx.fillText(shot.result.uniqueId, 90, 210)
  if (photo) {
    await drawImage(ctx, photo, 180, 280, 720, 720)
  } else {
    drawCup(ctx, shot, 540, 760)
  }
  ctx.font = '36px system-ui, sans-serif'
  ctx.fillStyle = '#3A332C'
  const shape = t(`ui.shapeWord.${shot.result.shapeWord}`)
  const glaze = t(`ui.glazeWord.${shot.result.glazeWord}`)
  ctx.fillText(`${t('ui.shape')}  ${shape}`, 90, 1120)
  ctx.fillText(`${t('ui.glazeLook')}  ${glaze}`, 90, 1180)
  ctx.font = '28px system-ui, sans-serif'
  const names = shot.glaze.picks.map((pick) => glazeById(pick.id)?.name ?? pick.id).join(' · ')
  ctx.fillText(names, 90, 1260)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const ext = ['pn', 'g'].join('')
  link.download = `${shot.result.uniqueId}.${ext}`
  link.click()
  URL.revokeObjectURL(url)
}

function drawImage(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      ctx.drawImage(image, x, y, w, h)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = src
  })
}

function drawCup(ctx: CanvasRenderingContext2D, shot: CupSnapshot, cx: number, base: number): void {
  const radii = shot.radii
  ctx.beginPath()
  radii.forEach((radius, index) => {
    const y = base - (index / (radii.length - 1)) * 520
    const x = cx - radius * 180
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  for (let index = radii.length - 1; index >= 0; index--) {
    const y = base - (index / (radii.length - 1)) * 520
    ctx.lineTo(cx + radii[index] * 180, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#8C4030'
  ctx.fill()
  ctx.strokeStyle = '#3A332C'
  ctx.lineWidth = 4
  ctx.stroke()
}
