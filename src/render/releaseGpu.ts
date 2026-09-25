/**
 * Release every GPU resource a renderer touched through the scene, so a
 * disposed WebGLRenderer can be garbage-collected.
 *
 * Why this exists: when three.js first uploads a geometry, material or
 * texture it adds a 'dispose' listener to that object, and the listener's
 * closure holds the renderer. `WebGLRenderer.dispose()` does not remove those
 * listeners. Any resource that outlives the flight - module-level caches
 * (aircraft templates, livery canvases, shared balloon materials) and
 * three's own module-level DFG LUT texture - therefore pins every past
 * renderer, its WebGL context and all of its programs. Calling `dispose()`
 * on the resource fires the event, which frees the GPU copy and removes the
 * listener. A shared resource stays valid: three re-uploads it the next
 * time it is rendered.
 */
import type { BufferGeometry, Material, Object3D, Scene, Texture, WebGLRenderer } from 'three';

interface Disposable {
  dispose(): void;
}

function isTexture(v: unknown): v is Texture {
  return !!v && typeof v === 'object' && (v as Texture).isTexture === true;
}

function collectTextures(values: Iterable<unknown>, out: Set<Disposable>): void {
  for (const v of values) {
    if (isTexture(v)) out.add(v);
    else if (v && typeof v === 'object' && 'value' in (v as object)) {
      // Uniform: { value: Texture | Texture[] }
      const u = (v as { value: unknown }).value;
      if (isTexture(u)) out.add(u);
      else if (Array.isArray(u)) for (const t of u) if (isTexture(t)) out.add(t);
    }
  }
}

function collectMaterial(renderer: WebGLRenderer, m: Material, out: Set<Disposable>): void {
  out.add(m);
  collectTextures(Object.values(m), out);
  const shader = m as Material & { uniforms?: Record<string, unknown> };
  if (shader.uniforms) collectTextures(Object.values(shader.uniforms), out);
  const ud = m.userData as { uniforms?: Record<string, unknown> } | undefined;
  if (ud?.uniforms) collectTextures(Object.values(ud.uniforms), out);
  // Uniforms the renderer injected itself (e.g. the shared dfgLUT on standard materials).
  const props = renderer.properties.get(m) as { uniforms?: Record<string, unknown> } | undefined;
  if (props?.uniforms) collectTextures(Object.values(props.uniforms), out);
}

/** Dispose every geometry/material/texture reachable from `roots` (plus scene env/background). */
export function releaseGpuResources(renderer: WebGLRenderer, scene: Scene, extraRoots: Object3D[] = []): number {
  const out = new Set<Disposable>();
  const visit = (o: Object3D) => {
    const mesh = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (mesh.geometry) out.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) collectMaterial(renderer, m, out);
    const withMats = o as Object3D & { customDepthMaterial?: Material; customDistanceMaterial?: Material };
    if (withMats.customDepthMaterial) collectMaterial(renderer, withMats.customDepthMaterial, out);
    if (withMats.customDistanceMaterial) collectMaterial(renderer, withMats.customDistanceMaterial, out);
  };
  scene.traverse(visit);
  for (const r of extraRoots) r.traverse(visit);
  if (isTexture(scene.environment)) out.add(scene.environment);
  if (isTexture(scene.background)) out.add(scene.background);
  if (scene.overrideMaterial) collectMaterial(renderer, scene.overrideMaterial, out);
  for (const d of out) d.dispose();
  return out.size;
}
