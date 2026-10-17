import climate from '../data/climate.json'
import drying from '../data/drying.json'
import { clamp } from './math'
import type { PlacementId, SeasonId } from './types'

export function dryingSeconds(base: number, humidity: number, reference: number): number {
  const steps = (humidity - reference) / drying.humidityStep
  return base * drying.durationPerStep ** steps
}

export function bandWidth(base: number, humidity: number, reference: number): number {
  const steps = (humidity - reference) / drying.humidityStep
  return base * drying.bandPerStep ** steps
}

export function seasonById(id: SeasonId) {
  const found = climate.seasons.find((s) => s.id === id)
  if (!found) return climate.seasons[0]
  return found
}

export function weatherById(id: string) {
  const found = climate.weathers.find((w) => w.id === id)
  if (!found) return climate.weathers[0]
  return found
}

export function seasonOf(month: number): SeasonId {
  for (const season of climate.seasons) {
    if (season.months.includes(month)) return season.id as SeasonId
  }
  return 'winter'
}

export function placementDrySeconds(placement: PlacementId, season: SeasonId, humidity: number): number {
  const scale = seasonById(season).dryScale * drying.placementScale[placement]
  return dryingSeconds(drying.baseSeconds * scale, humidity, climate.referenceHumidity)
}

export function bisqueBandWidth(season: SeasonId, peakHumidity: number): number {
  const base = drying.baseBandWidth * seasonById(season).bandScale
  return bandWidth(base, peakHumidity, climate.referenceHumidity)
}

export function humidityCurve(seed: number, humidity: number): number[] {
  const out: number[] = []
  for (let i = 0; i < drying.curvePoints; i++) {
    const wobble = Math.sin(i * 1.7 + (seed % 17) * 0.2) * drying.fluctuationAmp
    out.push(Math.round(clamp(humidity + wobble, 35, 98) * 10) / 10)
  }
  return out
}
