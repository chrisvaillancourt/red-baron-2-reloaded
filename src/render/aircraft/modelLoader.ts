/**
 * GLB model loading with a per-type template cache. Instances are cheap
 * clones (shared geometry); materials are assigned per instance by the
 * visual. Falls back to a procedural model if the GLB can't be loaded.
 */
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AircraftId, AircraftSpec } from '../../core/types';
import { getAircraft } from '../../data/aircraft';
import { buildFallbackModel } from './fallbackModel';

const templates = new Map<AircraftId, Promise<Object3D>>();
let loader: GLTFLoader | null = null;

/** Base URL for model files; override for tests or alternative hosting. */
export let modelBaseUrl = `${(import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}models/`;
export function setModelBaseUrl(url: string): void {
  modelBaseUrl = url.endsWith('/') ? url : `${url}/`;
}

function findRoot(scene: Object3D, id: string): Object3D {
  return scene.getObjectByName(`Aircraft_${id}`) ?? scene.children[0] ?? scene;
}

export function loadTemplate(spec: AircraftSpec): Promise<Object3D> {
  let p = templates.get(spec.id);
  if (!p) {
    loader ??= new GLTFLoader();
    p = loader
      .loadAsync(`${modelBaseUrl}${spec.id}.glb`)
      .then((gltf) => {
        const root = findRoot(gltf.scene, spec.id);
        root.removeFromParent();
        root.updateMatrixWorld(true);
        return root;
      })
      .catch((err) => {
        console.warn(`[aircraft] ${spec.id}.glb failed to load; using procedural fallback`, err);
        return buildFallbackModel(spec);
      });
    templates.set(spec.id, p);
  }
  return p;
}

/** Warm the cache so the first spawn of each type doesn't hitch. */
export async function preloadAircraftModels(ids: readonly AircraftId[]): Promise<void> {
  await Promise.all(ids.map((id) => loadTemplate(getAircraft(id))));
}
