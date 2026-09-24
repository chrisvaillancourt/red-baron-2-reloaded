/**
 * Aircraft visuals: GLB models from tools/blender, runtime liveries,
 * animation, gauges, damage. See docs/models.md.
 */
export { createAircraftVisual, type AircraftVisualExt } from './aircraftVisual';
export { preloadAircraftModels, loadTemplate, setModelBaseUrl } from './modelLoader';
export { defaultLivery, getLiveryTextures, clearLiveryCache } from './livery';
export { buildFallbackModel } from './fallbackModel';
export type { AircraftMeta } from './meta';
