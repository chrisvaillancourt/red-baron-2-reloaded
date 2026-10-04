import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { AircraftId } from '../../core/types';

interface ModelJson {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; mesh?: number }[];
  meshes: { primitives: { material?: number; attributes: { POSITION: number } }[] }[];
  materials: { name?: string }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

/** Measure shipped GLB positions in the aircraft body frame, independently of simulation/spec geometry. */
export function loadModelGeometry(id: AircraftId) {
  const bytes = readFileSync(new URL(`../../../public/models/${id}.glb`, import.meta.url));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as ModelJson;
  const binaryOffset = 28 + jsonLength;
  const transforms = new Map<number, Matrix4>();
  const children = new Set(gltf.nodes.flatMap(n => n.children ?? []));
  const visit = (index: number, parent: Matrix4) => {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    const world = parent.clone().multiply(local);
    transforms.set(index, world);
    for (const child of node.children ?? []) visit(child, world);
  };
  gltf.nodes.forEach((_, index) => { if (!children.has(index)) visit(index, new Matrix4()); });
  const indexOf = (name: string) => {
    const index = gltf.nodes.findIndex(n => n.name === name);
    if (index < 0) throw new Error(`${id}: missing model node ${name}`);
    return index;
  };
  const toBody = transforms.get(indexOf(`Aircraft_${id}`))!.clone().invert();
  const bodyMatrix = (index: number) => toBody.clone().multiply(transforms.get(index)!);
  const vertices = (name: string, material?: string) => {
    const index = indexOf(name);
    const matrix = bodyMatrix(index);
    const points: Vector3[] = [];
    for (const primitive of gltf.meshes[gltf.nodes[index].mesh!].primitives) {
      if (material && (primitive.material === undefined || gltf.materials[primitive.material].name !== material)) continue;
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      if (accessor.componentType !== 5126 || accessor.type !== 'VEC3') throw new Error(`${id}: unsupported POSITION format in ${name}`);
      const buffer = gltf.bufferViews[accessor.bufferView];
      const offset = binaryOffset + (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const stride = buffer.byteStride ?? 12;
      for (let i = 0; i < accessor.count; i++) {
        const p = offset + i * stride;
        points.push(new Vector3(view.getFloat32(p, true), view.getFloat32(p + 4, true), view.getFloat32(p + 8, true)).applyMatrix4(matrix));
      }
    }
    if (!points.length) throw new Error(`${id}: no positions in ${name} (${material ?? 'all materials'})`);
    return points;
  };
  return {
    point: (name: string) => new Vector3().setFromMatrixPosition(bodyMatrix(indexOf(name))),
    vertices,
    bounds(name: string, material?: string) {
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const point of vertices(name, material)) { min.min(point); max.max(point); }
      return { min: min.toArray(), max: max.toArray() };
    },
  };
}
