/**
 * Analytic daylight sky (Preetham et al. 1999), adapted from three.js'
 * examples/jsm/objects/Sky.js (MIT). Differences: no depth trick (works with
 * a reversed depth buffer), no built-in clouds, horizon blends into the
 * scene fog, and a JS port of the model provides a matching fog colour.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export const SKY_GAIN = 0.55;

const VERT = /* glsl */ `
uniform vec3 sunPosition;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
const float e = 2.718281828459045;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
}
vec3 totalMie( float T ) {
  float c = ( 0.2 * T ) * 10E-18;
  return 0.434 * c * MieConst;
}
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  #include <logdepthbuf_vertex>
  vSunDirection = normalize( sunPosition );
  vSunE = sunIntensity( vSunDirection.y );
  vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );
  float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );
  vBetaR = totalRayleigh * rayleighCoefficient;
  vBetaM = totalMie( turbidity ) * mieCoefficient;
}`;

const FRAG = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform float mieDirectionalG;
uniform float skyGain;
uniform float sunDisc;
uniform vec3 hazeColor;   // display-space fog colour (matches scene.fog)
uniform float hazeBand;   // how far above the horizon haze reaches (dir.y)
uniform float overcast;   // 0..1 greys the sky under heavy cloud
#include <common>
#include <logdepthbuf_pars_fragment>
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99995;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;
float rayleighPhase( float cosTheta ) { return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) ); }
float hgPhase( float cosTheta, float g ) {
  float g2 = pow( g, 2.0 );
  float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 direction = normalize( vWorldPosition - cameraPosition );
  float zenithAngle = acos( max( 0.0, direction.y ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / PI ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );
  float cosTheta = dot( direction, vSunDirection );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  vec3 betaMTheta = vBetaM * mPhase;
  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  float sundisc = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta ) * sunDisc;
  vec3 sundiscColor = ( 760.0 * sundisc ) * min( vSunE * Fex, 80.0 ) * ( 1.0 - overcast );
  vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );
  vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );
  // Overcast: desaturate/darken toward a flat grey.
  float lum = dot( retColor, vec3( 0.299, 0.587, 0.114 ) );
  retColor = mix( retColor, vec3( lum * 0.85 ), overcast * 0.85 );
  gl_FragColor = vec4( retColor * skyGain, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Haze toward the horizon and below it (ground beyond the far plane).
  float h = direction.y;
  float haze = 1.0 - smoothstep( -0.01, hazeBand, h );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor, haze );
}`;

export interface SkyParams {
  sunDirection: Vector3;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  overcast: number;
}

export class SkyDome extends Mesh<SphereGeometry, ShaderMaterial> {
  constructor() {
    const mat = new ShaderMaterial({
      name: 'SkyDome',
      uniforms: {
        sunPosition: { value: new Vector3(0, 1, 0) },
        rayleigh: { value: 1.5 },
        turbidity: { value: 4 },
        mieCoefficient: { value: 0.005 },
        mieDirectionalG: { value: 0.8 },
        skyGain: { value: SKY_GAIN },
        sunDisc: { value: 1 },
        hazeColor: { value: new Color(0.7, 0.75, 0.8) },
        hazeBand: { value: 0.08 },
        overcast: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    super(new SphereGeometry(1000, 48, 24), mat);
    this.name = 'sky';
    this.renderOrder = -1000;
    this.frustumCulled = false;
  }

  setParams(p: SkyParams): void {
    const u = this.material.uniforms;
    u.sunPosition.value.copy(p.sunDirection).multiplyScalar(450000);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mieCoefficient;
    u.mieDirectionalG.value = p.mieDirectionalG;
    u.overcast.value = p.overcast;
  }
}

// ---------------------------------------------------------------------------
// JS port (for fog colour and CPU lighting estimates).
// ---------------------------------------------------------------------------

const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

/** Linear (pre-tonemap, including SKY_GAIN) sky radiance in direction `dir`. */
export function skyRadiance(dir: Vector3, p: SkyParams, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const sun = p.sunDirection;
  const sunY = sun.y;
  const zc = Math.max(-1, Math.min(1, sunY));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(zc)) / 1.5)));
  const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp((sunY * 450000) / 450000)));
  const rc = p.rayleigh - (1 - sunfade);
  const c = 0.2 * p.turbidity * 10e-18;
  const zenithAngle = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv;
  const sM = 1.25e3 * inv;
  const cosTheta = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const mPhase = 0.07957747154594767 * ((1 - g * g) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5));
  const mixF = Math.min(1, Math.max(0, Math.pow(1 - sunY, 5)));
  const gamma = 1 / (1.2 + 1.2 * sunfade);
  let lumAcc = 0;
  for (let i = 0; i < 3; i++) {
    const bR = totalRayleigh[i] * rc;
    const bM = 0.434 * c * MieConst[i] * p.mieCoefficient;
    const fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.pow(sunE * ratio * fex, 0.5) - 1) * mixF;
    const tex = (lin + 0.1 * fex) * 0.04 + (i === 1 ? 0.0003 : i === 2 ? 0.00075 : 0);
    out[i] = Math.pow(tex, gamma);
  }
  lumAcc = out[0] * 0.299 + out[1] * 0.587 + out[2] * 0.114;
  for (let i = 0; i < 3; i++) out[i] = (out[i] + (lumAcc * 0.85 - out[i]) * p.overcast * 0.85) * SKY_GAIN;
  return out;
}

/** three.js ACESFilmicToneMapping + sRGB encode (CPU), exposure as renderer. */
export function linearToDisplay(rgb: [number, number, number], exposure: number): [number, number, number] {
  let r = (rgb[0] * exposure) / 0.6;
  let g = (rgb[1] * exposure) / 0.6;
  let b = (rgb[2] * exposure) / 0.6;
  // ACESInputMat (column-major in GLSL; applied as rows here)
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const fr = fit(ir), fg = fit(ig), fb = fit(ib);
  r = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb;
  g = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb;
  b = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb;
  const enc = (v: number) => {
    v = Math.min(1, Math.max(0, v));
    return v < 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };
  return [enc(r), enc(g), enc(b)];
}
