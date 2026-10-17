import { Color, ShaderMaterial } from 'three'

const vertex = `
uniform float uSway;
uniform float uSwayTime;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  float u = clamp((position.y - 0.05) / 0.95, 0.0, 1.0);
  float s = u * u * (3.0 - 2.0 * u);
  float a = uSway * 0.13 * s * s;
  vec3 swayed = position;
  swayed.x += a * sin(uSwayTime) + a * 0.28 * sin(uSwayTime * 0.55 + 1.3);
  swayed.z += a * cos(uSwayTime);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(swayed, 1.0);
}
`

const fragment = `
uniform vec3 uColor;
uniform vec3 uGlaze;
uniform float uGlazeMix;
uniform float uWet;
uniform float uCrack;
uniform float uPinhole;
uniform float uCrazing;
uniform float uHasMap;
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vNormalW;

void main() {
  vec3 base = uColor;
  if (uHasMap > 0.5) {
    base = texture2D(uMap, vUv).rgb;
  } else if (uGlazeMix > 0.01 && vUv.y > 0.08 && vUv.y < 0.9) {
    base = mix(uColor, uGlaze, uGlazeMix);
  }
  vec3 lightDir = normalize(vec3(0.25, 0.85, 0.4));
  float ndl = clamp(dot(normalize(vNormalW), lightDir), 0.0, 1.0);
  float light = 0.4 + 0.6 * ndl;
  float spec = pow(clamp(dot(normalize(vNormalW), normalize(vec3(-0.15, 0.55, 0.75))), 0.0, 1.0), 20.0);
  vec3 col = base * light + spec * uWet * vec3(1.0, 0.96, 0.9);
  float crackWidth = 0.02;
  if (uCrack > 0.5) {
    float line = abs(fract(vUv.x * 7.0 + vUv.y * 3.0) - 0.5);
    if (line < crackWidth && fract(vUv.y * 9.0) > 0.35) col *= 0.28;
  }
  if (uCrazing > 0.5) {
    float gx = abs(fract(vUv.x * 13.0) - 0.5);
    float gy = abs(fract(vUv.y * 15.0) - 0.5);
    float w = 0.028;
    if (gx < w || gy < w) col *= 0.4;
  }
  if (uPinhole > 0.5) {
    vec2 cell = fract(vUv * vec2(16.0, 22.0)) - 0.5;
    float d = length(cell);
    float r = 0.08;
    if (d < r && fract(vUv.x * 5.0 + vUv.y) > 0.72) col *= 0.15;
  }
  gl_FragColor = vec4(col, 1.0);
}
`

export interface CupLook {
  color: string
  glaze: string
  glazeMix: number
  wet: number
  crack: boolean
  pinhole: boolean
  crazing: boolean
}

export function createCupMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color('#8C4030') },
      uGlaze: { value: new Color('#7E8B86') },
      uGlazeMix: { value: 0 },
      uWet: { value: 0.15 },
      uCrack: { value: 0 },
      uPinhole: { value: 0 },
      uCrazing: { value: 0 },
      uHasMap: { value: 0 },
      uMap: { value: null },
      uSway: { value: 0 },
      uSwayTime: { value: 0 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    toneMapped: false,
  })
}

export function applyCupLook(material: ShaderMaterial, look: CupLook): void {
  ;(material.uniforms.uColor.value as Color).set(look.color)
  ;(material.uniforms.uGlaze.value as Color).set(look.glaze)
  material.uniforms.uGlazeMix.value = look.glazeMix
  material.uniforms.uWet.value = look.wet
  material.uniforms.uCrack.value = look.crack ? 1 : 0
  material.uniforms.uPinhole.value = look.pinhole ? 1 : 0
  material.uniforms.uCrazing.value = look.crazing ? 1 : 0
}
