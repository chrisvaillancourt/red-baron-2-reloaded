import type { GraphicsQuality } from '../core/types';

export interface QualityPreset {
  pixelRatioCap: number;
  terrainMaxLevel: number;
  terrainSplit: number;
  terrainCache: number;
  maskResolution: number;
  shadows: boolean;
  shadowMapSize: number;
  treeRadius: number;
  treeDensity: number;
  cloudRadius: number;
  cloudPuffBudget: number;
  buildingDistance: number;
  farPlane: number;
  maxParticles: number;
  antialias: boolean;
}

export const QUALITY: Record<GraphicsQuality, QualityPreset> = {
  low: {
    pixelRatioCap: 1, terrainMaxLevel: 8, terrainSplit: 1.1, terrainCache: 350, maskResolution: 100,
    shadows: false, shadowMapSize: 1024, treeRadius: 1800, treeDensity: 0.45, cloudRadius: 22_000,
    cloudPuffBudget: 1800, buildingDistance: 9_000, farPlane: 90_000, maxParticles: 2500, antialias: false,
  },
  medium: {
    pixelRatioCap: 1.25, terrainMaxLevel: 9, terrainSplit: 1.25, terrainCache: 500, maskResolution: 70,
    shadows: true, shadowMapSize: 1024, treeRadius: 2600, treeDensity: 0.7, cloudRadius: 30_000,
    cloudPuffBudget: 3000, buildingDistance: 14_000, farPlane: 110_000, maxParticles: 4000, antialias: true,
  },
  high: {
    pixelRatioCap: 1.5, terrainMaxLevel: 9, terrainSplit: 1.45, terrainCache: 700, maskResolution: 50,
    shadows: true, shadowMapSize: 2048, treeRadius: 3600, treeDensity: 1, cloudRadius: 38_000,
    cloudPuffBudget: 5000, buildingDistance: 20_000, farPlane: 130_000, maxParticles: 6000, antialias: true,
  },
  ultra: {
    pixelRatioCap: 2, terrainMaxLevel: 10, terrainSplit: 1.7, terrainCache: 1000, maskResolution: 40,
    shadows: true, shadowMapSize: 4096, treeRadius: 5000, treeDensity: 1.25, cloudRadius: 45_000,
    cloudPuffBudget: 8000, buildingDistance: 28_000, farPlane: 150_000, maxParticles: 9000, antialias: true,
  },
};
