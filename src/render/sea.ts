/**
 * The Channel / North Sea: a camera-following plane at y = 0 with animated
 * procedural wave normals, reflecting the sky through the scene environment.
 */
import { DataTexture, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, RGBAFormat, LinearMipmapLinearFilter, LinearFilter, Vector2, type Camera } from 'three';

function makeWaveNormalMap(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  // Sum of periodic waves (tileable).
  const waves: [number, number, number, number][] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 24; i++) waves.push([Math.floor(rnd() * 9) - 4, Math.floor(rnd() * 9) - 4, rnd() * Math.PI * 2, 0.4 + rnd()]);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [kx, ky, ph, a] of waves) {
        if (kx === 0 && ky === 0) continue;
        v += (a / Math.hypot(kx, ky)) * Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + ph);
      }
      h[y * size + x] = v;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      const nx = -hx * 0.35;
      const ny = -hy * 0.35;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Sea {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly normalMap = makeWaveNormalMap();
  private t = 0;

  constructor() {
    const geo = new PlaneGeometry(240_000, 240_000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshStandardMaterial({
      color: 0x1d3640,
      roughness: 0.12,
      metalness: 0,
      normalMap: this.normalMap,
      normalScale: new Vector2(0.6, 0.6),
    });
    this.normalMap.repeat.set(240_000 / 60, 240_000 / 60);
    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'sea';
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
  }

  update(dt: number, camera: Camera): void {
    this.t += dt;
    const p = camera.position;
    // Snap to the wave tile so the pattern doesn't swim.
    const snap = 60;
    this.mesh.position.set(Math.round(p.x / snap) * snap, 0, Math.round(p.z / snap) * snap);
    this.normalMap.offset.set(this.t * 0.004, this.t * 0.0027);
  }
}
