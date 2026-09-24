"""
Build every aircraft GLB (and optional EEVEE previews).

  node --experimental-strip-types tools/export-aircraft-json.ts
  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/build_models.py -- [--only id1,id2] [--preview] [--no-export]

Outputs public/models/<id>.glb and tools/blender/out/previews/<id>_{a,b}.png.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aircraft_gen as gen  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(HERE, 'out', 'aircraft.json')
MODELS = os.path.join(REPO, 'public', 'models')
PREVIEWS = os.path.join(HERE, 'out', 'previews')


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    if '--only' in a:
        only = set(a[a.index('--only') + 1].split(','))
    return only, '--preview' in a, '--no-export' not in a


def export_glb(root, path):
    bpy.ops.object.select_all(action='DESELECT')
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack.extend(o.children)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_extras=True, export_cameras=False, export_lights=False, export_texcoords=True,
        export_normals=True, export_materials='EXPORT', export_animations=False,
    )


def setup_preview_scene():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 800
    sc.render.resolution_y = 450
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    bg.inputs[1].default_value = 0.8
    sc.world = world
    sun_d = bpy.data.lights.new('Sun', 'SUN')
    sun_d.energy = 3.5
    sun = bpy.data.objects.new('Sun', sun_d)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(sun)
    cam_d = bpy.data.cameras.new('Cam')
    cam_d.lens = 50
    cam = bpy.data.objects.new('Cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def look_at(cam, target, pos):
    from mathutils import Vector
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def main():
    only, preview, do_export = args()
    with open(DATA) as f:
        specs = json.load(f)
    os.makedirs(MODELS, exist_ok=True)
    os.makedirs(PREVIEWS, exist_ok=True)
    for spec in specs:
        if only and spec['id'] not in only:
            continue
        gen.clear_scene()
        for o in list(bpy.data.lights):
            bpy.data.lights.remove(o)
        ac = gen.Aircraft(spec)
        root = ac.build()
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
        path = os.path.join(MODELS, f"{spec['id']}.glb")
        if do_export:
            export_glb(root, path)
        size = os.path.getsize(path) // 1024 if os.path.exists(path) else 0
        print(f"MODEL {spec['id']}: {tris} tris, {size} KB")
        if preview:
            cam = setup_preview_scene()
            L = spec['geometry']['length']
            s = max(L, spec['geometry']['span'])
            views = {
                'a': (s * 0.95, s * 0.75, s * 0.45),
                'b': (s * 1.35, 0.0, 0.25),
                'c': (0.0, s * 1.4, 0.3),
                'd': (0.0, 0.0, s * 1.6),
            }
            for k, pos in views.items():
                look_at(cam, (0, -L * 0.1, 0.1), pos)
                if k == 'd':
                    cam.rotation_euler = (0, 0, math.pi)
                bpy.context.scene.render.filepath = os.path.join(PREVIEWS, f"{spec['id']}_{k}.png")
                bpy.ops.render.render(write_still=True)


main()
