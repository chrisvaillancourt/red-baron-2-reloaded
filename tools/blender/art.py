"""
Key art renders (Cycles, Metal GPU) for menus: public/art/*.jpg

  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/art.py -- --scene title [--res 1920] [--samples 256] [--out path]

Scenes: title, aerodrome, desk, debrief. Aircraft come from aircraft_gen.py
with liveries painted here in NumPy using the same UV-atlas conventions as
the runtime painter (docs/models.md).
"""
import json
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aircraft_gen as gen  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SPECS = {s['id']: s for s in json.load(open(os.path.join(HERE, 'out', 'aircraft.json')))}


def argv():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opt = {'scene': 'title', 'res': 960, 'samples': 64, 'out': None}
    for i, k in enumerate(a):
        if k.startswith('--') and i + 1 < len(a):
            key = k[2:]
            if key in opt:
                opt[key] = type(opt[key])(a[i + 1]) if opt[key] is not None else a[i + 1]
    return opt


# ---------------------------------------------------------------------------
# NumPy livery painter (mirrors src/render/aircraft/livery.ts, simplified)
# ---------------------------------------------------------------------------

def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


class Canvas:
    def __init__(self, w, h, color):
        self.w, self.h = w, h
        self.a = np.ones((h, w, 3), dtype=np.float32) * hexrgb(color)
        ys, xs = np.mgrid[0:h, 0:w]
        self.xs = xs.astype(np.float32) + 0.5
        self.ys = ys.astype(np.float32) + 0.5

    def fill(self, mask, color, alpha=1.0):
        c = hexrgb(color) if isinstance(color, str) else color
        m = mask.astype(np.float32)[..., None] * alpha
        self.a = self.a * (1 - m) + c * m

    def rect(self, x0, y0, x1, y1, color):
        self.fill((self.xs >= x0) & (self.xs < x1) & (self.ys >= y0) & (self.ys < y1), color)

    def ellipse(self, cx, cy, rx, ry, color):
        self.fill(((self.xs - cx) / rx) ** 2 + ((self.ys - cy) / ry) ** 2 <= 1, color)

    def local(self, cx, cy, sx, sy):
        """Pixel coords -> insignia unit coords centred at (cx, cy), sx/sy px per unit."""
        return (self.xs - cx) / sx, (self.ys - cy) / sy

    def noise(self, seed, amount=0.05, scale=40):
        rng = np.random.default_rng(seed)
        gh, gw = max(2, self.h // scale), max(2, self.w // scale)
        g = rng.random((gh, gw)).astype(np.float32)
        yi = (np.linspace(0, gh - 1.001, self.h)).astype(np.float32)
        xi = (np.linspace(0, gw - 1.001, self.w)).astype(np.float32)
        y0 = yi.astype(int)
        x0 = xi.astype(int)
        fy = (yi - y0)[:, None]
        fx = (xi - x0)[None, :]
        v = (g[y0][:, x0] * (1 - fx) * (1 - fy) + g[y0][:, x0 + 1] * fx * (1 - fy) + g[y0 + 1][:, x0] * (1 - fx) * fy + g[y0 + 1][:, x0 + 1] * fx * fy)
        grain = rng.random((self.h, self.w)).astype(np.float32)
        self.a *= (1 + (v[..., None] - 0.5) * amount * 2 + (grain[..., None] - 0.5) * amount * 0.5)

    def to_image(self, name):
        img = bpy.data.images.new(name, self.w, self.h, alpha=True)
        rgba = np.concatenate([np.clip(self.a, 0, 1), np.ones((self.h, self.w, 1), np.float32)], axis=2)
        img.pixels.foreach_set(np.flipud(rgba).ravel())
        img.pack()
        return img


def iron_cross(cv, cx, cy, sx, sy, border=True):
    u, v = cv.local(cx, cy, sx, sy)
    au, av = np.abs(u), np.abs(v)

    def arms(scale):
        uu, vv = au / scale, av / scale
        # arm along v: half-width grows from 0.07 at centre to 0.2 at 0.5
        a1 = (vv <= 0.5) & (uu <= 0.07 + (0.2 - 0.07) * (vv / 0.5))
        a2 = (uu <= 0.5) & (vv <= 0.07 + (0.2 - 0.07) * (uu / 0.5))
        return a1 | a2
    if border:
        cv.fill(arms(1.14), '#f1eee4')
    cv.fill(arms(1.0), '#141312')


def balkenkreuz(cv, cx, cy, sx, sy):
    u, v = cv.local(cx, cy, sx, sy)
    au, av = np.abs(u), np.abs(v)
    w = 0.22
    cv.fill(((au <= 0.5) & (av <= w / 2 + 0.05)) | ((av <= 0.5) & (au <= w / 2 + 0.05)), '#f1eee4')
    cv.fill(((au <= 0.45) & (av <= w / 2)) | ((av <= 0.45) & (au <= w / 2)), '#141312')


ROUNDELS = {'roundel-rfc': ['#2a3f7a', '#f2efe6', '#b3241f'], 'roundel-france': ['#c12a22', '#f2efe6', '#2a3f8a'], 'roundel-usa': ['#c12a22', '#2a3f8a', '#f2efe6']}
STRIPES = {'roundel-rfc': ['#2a3f7a', '#f2efe6', '#b3241f'], 'roundel-france': ['#2a3f8a', '#f2efe6', '#c12a22'], 'roundel-usa': ['#c12a22', '#f2efe6', '#2a3f8a']}


def insignia(cv, kind, cx, cy, sx, sy):
    if kind == 'iron-cross-patee':
        iron_cross(cv, cx, cy, sx, sy)
    elif kind == 'balkenkreuz':
        balkenkreuz(cv, cx, cy, sx, sy)
    else:
        for col, r in zip(ROUNDELS[kind], (0.5, 0.34, 0.17)):
            cv.ellipse(cx, cy, r * sx, r * sy, col)


def paint_livery(ac, liv, seed=1):
    m = ac.meta
    ins = liv['insignia']
    german = ins in ('iron-cross-patee', 'balkenkreuz')
    imgs = {}
    # wings
    for top in (True, False):
        W, H = 1024, 512
        cv = Canvas(W, H, liv['wingTop'] if top else liv['wingBottom'])
        pxU = W / m['uv_span_ref']
        pxV = H / 2 / m['uv_chord_ref']
        for k in range(1, int(m['uv_span_ref'] / 0.3)):
            x = k * 0.3 * pxU
            cv.fill((np.abs(cv.xs - x) < 1.2), (cv.a[0, 0] * 1.08), alpha=0.35)
        chord = m['uv_top_wing_chord'] if top else m['uv_bottom_wing_chord']
        half = (m['uv_span_ref'] if top else m['uv_bottom_wing_span']) / 2
        size = min(chord * (0.92 if german else 0.88), 1.6)
        off = half - size * 0.5 - min(0.9, half * 0.14)
        for s in (-1, 1):
            insignia(cv, ins, W / 2 + s * off * pxU, chord / 2 * pxV, size * pxU, size * pxV)
        cv.noise(seed + (1 if top else 2), 0.05)
        imgs['Livery_WingTop' if top else 'Livery_WingBottom'] = cv
    # fuselage
    W, H = 1024, 512
    cv = Canvas(W, H, liv['fuselage'])
    pxU = W / m['uv_fuselage_len']
    pxV = H / m['uv_fuselage_perim']
    uIns = 0.72 if german else 0.62
    size = min(ac.W * 1.2 * (1 - 0.55 * uIns) * 0.95, 0.85 if german else 0.8)
    if german and liv.get('accent') and liv['accent'] != liv['fuselage']:
        cv.rect((uIns - 0.12) * W, 0, (uIns - 0.12) * W + 0.16 * pxU, H, liv['accent'])
    for v in (0.25, 0.75):
        insignia(cv, ins, uIns * W, v * H, size * pxU, size * pxV)
    # exhaust / oil staining
    rot = ac.rotary
    for v in (0.25, 0.75):
        yy = (v + (0.1 if v < 0.5 else -0.1) * (1 if rot else -0.6)) * H
        mask = (np.abs(cv.ys - yy) < 0.25 * pxV) & (cv.xs < 0.45 * W)
        fade = np.clip(1 - cv.xs / (0.45 * W), 0, 1) * 0.45
        cv.a = cv.a * (1 - (mask * fade)[..., None]) + hexrgb('#2a2014') * (mask * fade)[..., None]
    cv.noise(seed + 3, 0.06)
    imgs['Livery_Fuselage'] = cv
    # tail
    cv = Canvas(512, 512, liv['tail'])
    if ins in STRIPES:
        for i, col in enumerate(STRIPES[ins]):
            cv.rect(0.4 * 512 + i * 0.2 * 512, 0, 0.4 * 512 + (i + 1) * 0.2 * 512 + 1, 256, col)
    else:
        pxU = 0.6 * 512 / max(0.2, m['uv_rudder_chord'])
        pxV = 256 / max(0.3, m['uv_vtail_height'])
        sz = min(m['uv_rudder_chord'] * 0.85, m['uv_vtail_height'] * 0.6)
        if ins == 'iron-cross-patee':
            cv.rect(0.4 * 512, 0, 512, 256, '#f1eee4')
            iron_cross(cv, 0.4 * 512 + 0.6 * 512 * 0.45, 512 * 0.2, sz * pxU, sz * pxV, border=False)
        else:
            balkenkreuz(cv, 0.4 * 512 + 0.6 * 512 * 0.45, 512 * 0.22, sz * pxU, sz * pxV)
    cv.noise(seed + 4, 0.04)
    imgs['Livery_Tail'] = cv
    cv = Canvas(256, 128, liv['cowling'])
    cv.noise(seed + 5, 0.08, 16)
    imgs['Livery_Cowling'] = cv
    return imgs


def build_painted(aid, liv, tag, loc=(0, 0, 0), rot=(0, 0, 0), prop_blur=True):
    """Build an aircraft, paint its livery, isolate its materials (suffix `tag`)."""
    ac = gen.Aircraft(SPECS[aid])
    root = ac.build()
    canvases = paint_livery(ac, liv, seed=hash(tag) % 1000)
    for name in list(MAT_NAMES):
        m = bpy.data.materials.get(name)
        if not m:
            continue
        m.name = f'{name}_{tag}'
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if name in canvases:
            img = canvases[name].to_image(f'{name}_{tag}_img')
            tex = m.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = img
            m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            bsdf.inputs['Roughness'].default_value = 0.72 if name != 'Livery_Cowling' else 0.35
            if name == 'Livery_Cowling':
                bsdf.inputs['Metallic'].default_value = 0.5
            # subtle fabric sheen
            try:
                bsdf.inputs['Sheen Weight'].default_value = 0.15
            except KeyError:
                pass
        elif name == 'Livery_Accent':
            bsdf.inputs['Base Color'].default_value = gen.hex_rgba(liv['accent'])
    root.location = loc
    root.rotation_euler = rot
    prop = next(o for o in bpy.data.objects if o.name.startswith('Propeller') and o.parent and root in parents(o))
    if prop_blur:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
        prop.rotation_mode = 'XYZ'
        prop.rotation_euler = (0, 0, 0)
        prop.keyframe_insert('rotation_euler', frame=1)
        prop.rotation_euler = (0, 1.6, 0)
        prop.keyframe_insert('rotation_euler', frame=2)
    return root, ac


MAT_NAMES = ['Livery_Fuselage', 'Livery_WingTop', 'Livery_WingBottom', 'Livery_Tail', 'Livery_Cowling', 'Livery_Accent',
             'Metal', 'Wood', 'Rubber', 'Pilot', 'Skin', 'Leather', 'Glass', 'Gauge', 'Cloth']


def parents(o):
    out = []
    while o.parent:
        o = o.parent
        out.append(o)
    return out


def world_pos(root, local):
    return root.matrix_world @ Vector(local)


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------

def reset(view='AgX'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.refresh_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    sc.cycles.device = 'GPU'
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = view
    if view == 'AgX':
        sc.view_settings.look = 'AgX - Punchy'
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    return sc


def mat(name, color=(0.5, 0.5, 0.5, 1), rough=0.6, metal=0.0, emission=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emission:
        b.inputs['Emission Color'].default_value = emission
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def sky_world(sc, elevation_deg, rotation_deg, strength=1.0, dust=1.0, air=1.0, altitude=0.0, ozone=1.0, ground_color=None):
    w = bpy.data.worlds.new('Sky')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_elevation = math.radians(elevation_deg)
    sky.sun_rotation = math.radians(rotation_deg)
    for attr, val in (('altitude', altitude), ('air_density', air), ('aerosol_density', dust), ('dust_density', dust), ('ozone_density', ozone)):
        if hasattr(sky, attr):
            setattr(sky, attr, val)
    bg.inputs['Strength'].default_value = strength
    if ground_color is None:
        nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    else:
        # The physical sky is black below the horizon; fade to a haze colour there so
        # a flat ground plane never shows a dark band at the horizon.
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Generated'], sep.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        mr.inputs['From Min'].default_value = -0.03
        mr.inputs['From Max'].default_value = 0.004
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 0.0
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        nt.links.new(mr.outputs[0], mix.inputs[0])
        nt.links.new(sky.outputs['Color'], mix.inputs[6])
        mix.inputs[7].default_value = ground_color
        nt.links.new(mix.outputs[2], bg.inputs['Color'])
    sc.world = w
    return sky


def camera(sc, loc, target, lens=50, dof=None):
    cd = bpy.data.cameras.new('Cam')
    cd.lens = lens
    cd.clip_end = 200000
    cam = bpy.data.objects.new('Cam', cd)
    sc.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if dof:
        cd.dof.use_dof = True
        cd.dof.focus_distance = d.length
        cd.dof.aperture_fstop = dof
    sc.camera = cam
    return cam


def add_mesh(name, verts, faces, material=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material:
        me.materials.append(material)
    return ob


def plane(name, size, z=0.0, material=None, subdiv=0):
    s = size / 2
    ob = add_mesh(name, [(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, s * 0 + z)], [(0, 1, 2, 3)], material)
    return ob


def node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        if k in n.inputs:
            n.inputs[k].default_value = v
        else:
            setattr(n, k, v)
    return n


def terrain_material(haze=(0.62, 0.62, 0.66, 1), haze_dist=9000.0, front_x=900.0, glow=1.6):
    """Patchwork fields, woods and a shell-cratered trench belt near x = front_x, with distance haze."""
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    L = nt.links
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.95
    tc = node(nt, 'ShaderNodeTexCoord', (-1400, 0))
    sep = node(nt, 'ShaderNodeSeparateXYZ', (-1200, -300))
    L.new(tc.outputs['Object'], sep.inputs[0])
    # fields: voronoi cells with random colours
    vor = node(nt, 'ShaderNodeTexVoronoi', (-1100, 200), Scale=0.004)
    vor.voronoi_dimensions = '2D'
    L.new(tc.outputs['Object'], vor.inputs['Vector'])
    ramp = node(nt, 'ShaderNodeValToRGB', (-850, 200))
    cr = ramp.color_ramp
    cr.interpolation = 'CONSTANT'
    cols = [(0.16, 0.22, 0.08), (0.28, 0.3, 0.11), (0.4, 0.36, 0.16), (0.2, 0.26, 0.1), (0.46, 0.42, 0.22), (0.24, 0.2, 0.1), (0.13, 0.19, 0.07)]
    cr.elements[0].color = (*cols[0], 1)
    cr.elements[1].position = 0.999
    for i, c in enumerate(cols[1:], 1):
        e = cr.elements.new(i / len(cols))
        e.color = (*c, 1)
    sepc = node(nt, 'ShaderNodeSeparateColor', (-950, 350))
    L.new(vor.outputs['Color'], sepc.inputs[0])
    L.new(sepc.outputs[0], ramp.inputs['Fac'])
    # fine grain
    noise = node(nt, 'ShaderNodeTexNoise', (-1100, -50), Scale=0.05, Detail=8.0)
    L.new(tc.outputs['Object'], noise.inputs['Vector'])
    grain = node(nt, 'ShaderNodeMix', (-600, 150))
    grain.data_type = 'RGBA'
    grain.blend_type = 'MULTIPLY'
    grain.inputs['Factor'].default_value = 0.35
    L.new(ramp.outputs['Color'], grain.inputs[6])
    L.new(noise.outputs['Color'], grain.inputs[7])
    # trench belt: distance from a wiggly line x = front_x + 400 sin(y/3000)
    wig = node(nt, 'ShaderNodeMath', (-1000, -350), operation='MULTIPLY')
    L.new(sep.outputs['Y'], wig.inputs[0])
    wig.inputs[1].default_value = 1 / 3000
    sn = node(nt, 'ShaderNodeMath', (-850, -350), operation='SINE')
    L.new(wig.outputs[0], sn.inputs[0])
    amp = node(nt, 'ShaderNodeMath', (-700, -350), operation='MULTIPLY')
    L.new(sn.outputs[0], amp.inputs[0])
    amp.inputs[1].default_value = 400
    dx = node(nt, 'ShaderNodeMath', (-550, -350), operation='SUBTRACT')
    L.new(sep.outputs['X'], dx.inputs[0])
    L.new(amp.outputs[0], dx.inputs[1])
    dx2 = node(nt, 'ShaderNodeMath', (-400, -350), operation='SUBTRACT')
    L.new(dx.outputs[0], dx2.inputs[0])
    dx2.inputs[1].default_value = front_x
    ab = node(nt, 'ShaderNodeMath', (-250, -350), operation='ABSOLUTE')
    L.new(dx2.outputs[0], ab.inputs[0])
    belt = node(nt, 'ShaderNodeMapRange', (-100, -350))
    L.new(ab.outputs[0], belt.inputs['Value'])
    belt.inputs['From Min'].default_value = 900
    belt.inputs['From Max'].default_value = 1500
    belt.inputs['To Min'].default_value = 1
    belt.inputs['To Max'].default_value = 0
    # crater noise in the belt
    cn = node(nt, 'ShaderNodeTexVoronoi', (-600, -600), Scale=0.03)
    L.new(tc.outputs['Object'], cn.inputs['Vector'])
    craters = node(nt, 'ShaderNodeMapRange', (-400, -600))
    L.new(cn.outputs['Distance'], craters.inputs['Value'])
    craters.inputs['From Min'].default_value = 0.0
    craters.inputs['From Max'].default_value = 0.45
    mud = node(nt, 'ShaderNodeMix', (-200, -600))
    mud.data_type = 'RGBA'
    mud.inputs[6].default_value = (0.08, 0.065, 0.045, 1)
    mud.inputs[7].default_value = (0.2, 0.16, 0.11, 1)
    L.new(craters.outputs[0], mud.inputs['Factor'])
    # trench zig-zag lines (wave bands along the belt)
    wave = node(nt, 'ShaderNodeTexWave', (-600, -850), Scale=0.0022, Distortion=6.0, Detail=2.0)
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    L.new(tc.outputs['Object'], wave.inputs['Vector'])
    tr = node(nt, 'ShaderNodeMapRange', (-400, -850))
    L.new(wave.outputs['Fac'], tr.inputs['Value'])
    tr.inputs['From Min'].default_value = 0.93
    tr.inputs['From Max'].default_value = 0.97
    mud2 = node(nt, 'ShaderNodeMix', (0, -700))
    mud2.data_type = 'RGBA'
    L.new(tr.outputs[0], mud2.inputs['Factor'])
    L.new(mud.outputs[2], mud2.inputs[6])
    mud2.inputs[7].default_value = (0.04, 0.035, 0.03, 1)
    field = node(nt, 'ShaderNodeMix', (200, 0))
    field.data_type = 'RGBA'
    L.new(belt.outputs[0], field.inputs['Factor'])
    L.new(grain.outputs[2], field.inputs[6])
    L.new(mud2.outputs[2], field.inputs[7])
    # distance haze
    cd = node(nt, 'ShaderNodeCameraData', (0, 300))
    hz = node(nt, 'ShaderNodeMath', (200, 300), operation='DIVIDE')
    L.new(cd.outputs['View Distance'], hz.inputs[0])
    hz.inputs[1].default_value = haze_dist
    ex = node(nt, 'ShaderNodeMath', (350, 300), operation='MULTIPLY')
    L.new(hz.outputs[0], ex.inputs[0])
    ex.inputs[1].default_value = -1
    ex2 = node(nt, 'ShaderNodeMath', (500, 300), operation='EXPONENT')
    L.new(ex.outputs[0], ex2.inputs[0])
    inv = node(nt, 'ShaderNodeMath', (650, 300), operation='SUBTRACT')
    inv.inputs[0].default_value = 1
    L.new(ex2.outputs[0], inv.inputs[1])
    hm = node(nt, 'ShaderNodeMix', (500, 0))
    hm.data_type = 'RGBA'
    L.new(inv.outputs[0], hm.inputs['Factor'])
    L.new(field.outputs[2], hm.inputs[6])
    hm.inputs[7].default_value = haze
    L.new(hm.outputs[2], b.inputs['Base Color'])
    em = b.inputs['Emission Color']
    L.new(hm.outputs[2], em)
    # haze glows a little (in-scattered light)
    emk = node(nt, 'ShaderNodeMath', (700, -100), operation='MULTIPLY')
    L.new(inv.outputs[0], emk.inputs[0])
    emk.inputs[1].default_value = glow
    L.new(emk.outputs[0], b.inputs['Emission Strength'])
    return m


def cloud_material(density=0.6, scale=0.0012, threshold=0.52, color=(1, 1, 1, 1), zmin=0.0, zmax=1.0, anisotropy=0.6):
    """Volume clouds inside a box: noise thresholded, shaped by height (object Z in 0..1 after normalisation)."""
    m = bpy.data.materials.new('Clouds')
    m.use_nodes = True
    nt = m.node_tree
    L = nt.links
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    out = nt.nodes['Material Output']
    vol = node(nt, 'ShaderNodeVolumePrincipled', (200, 0))
    vol.inputs['Color'].default_value = color
    vol.inputs['Anisotropy'].default_value = anisotropy
    tc = node(nt, 'ShaderNodeTexCoord', (-1200, 0))
    noise = node(nt, 'ShaderNodeTexNoise', (-900, 100), Scale=1.0, Detail=10.0, Roughness=0.55)
    noise.noise_dimensions = '3D'
    mp = node(nt, 'ShaderNodeMapping', (-1050, 100))
    mp.inputs['Scale'].default_value = (scale, scale, scale * 1.9)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    L.new(mp.outputs['Vector'], noise.inputs['Vector'])
    gen_ = node(nt, 'ShaderNodeTexCoord', (-1200, -300))
    sep = node(nt, 'ShaderNodeSeparateXYZ', (-1000, -300))
    L.new(gen_.outputs['Generated'], sep.inputs[0])
    # height profile: flat bottom, puffy top
    hp = node(nt, 'ShaderNodeFloatCurve', (-800, -300))
    c = hp.mapping.curves[0]
    c.points[0].location = (0.0, 0.0)
    c.points[1].location = (1.0, 0.0)
    c.points.new(0.08, 1.0)
    c.points.new(0.45, 0.8)
    hp.mapping.update()
    L.new(sep.outputs['Z'], hp.inputs['Value'])
    mul = node(nt, 'ShaderNodeMath', (-600, 0), operation='MULTIPLY')
    L.new(noise.outputs['Fac'], mul.inputs[0])
    L.new(hp.outputs['Value'], mul.inputs[1])
    sub = node(nt, 'ShaderNodeMath', (-450, 0), operation='SUBTRACT')
    L.new(mul.outputs[0], sub.inputs[0])
    sub.inputs[1].default_value = threshold * 0.8
    mx = node(nt, 'ShaderNodeMath', (-300, 0), operation='MAXIMUM')
    L.new(sub.outputs[0], mx.inputs[0])
    mx.inputs[1].default_value = 0
    den = node(nt, 'ShaderNodeMath', (-150, 0), operation='MULTIPLY')
    L.new(mx.outputs[0], den.inputs[0])
    den.inputs[1].default_value = density * 0.6
    L.new(den.outputs[0], vol.inputs['Density'])
    L.new(vol.outputs[0], out.inputs['Volume'])
    return m


def cloud_box(name, center, size, material):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    vs = [(cx + dx * sx, cy + dy * sy, cz + dz * sz) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    ob = add_mesh(name, vs, fs, material)
    return ob


def tracer(p0, p1, m, r=0.025):
    d = Vector(p1) - Vector(p0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=r, depth=d.length, location=(Vector(p0) + Vector(p1)) / 2)
    ob = bpy.context.active_object
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(m)
    return ob


def smoke_puffs(points, m, base_r=0.7, grow=0.12):
    for i, p in enumerate(points):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=base_r + grow * i, location=p)
        ob = bpy.context.active_object
        ob.data.materials.append(m)


def smoke_material(color=(0.05, 0.05, 0.05, 1), density=0.8):
    m = bpy.data.materials.new('Smoke')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    vol = node(nt, 'ShaderNodeVolumePrincipled', (0, 0))
    vol.inputs['Color'].default_value = color
    tc = node(nt, 'ShaderNodeTexCoord', (-600, 0))
    noise = node(nt, 'ShaderNodeTexNoise', (-400, 0), Scale=1.6, Detail=6.0)
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    grad = node(nt, 'ShaderNodeTexGradient', (-400, -200))
    grad.gradient_type = 'SPHERICAL'
    nt.links.new(tc.outputs['Object'], grad.inputs['Vector'])
    mul = node(nt, 'ShaderNodeMath', (-200, 0), operation='MULTIPLY')
    nt.links.new(noise.outputs['Fac'], mul.inputs[0])
    nt.links.new(grad.outputs['Fac'], mul.inputs[1])
    m2 = node(nt, 'ShaderNodeMath', (-50, 0), operation='MULTIPLY')
    nt.links.new(mul.outputs[0], m2.inputs[0])
    m2.inputs[1].default_value = density * 6
    nt.links.new(m2.outputs[0], vol.inputs['Density'])
    nt.links.new(vol.outputs[0], nt.nodes['Material Output'].inputs['Volume'])
    return m


def render(sc, path, res, samples, aspect=(16, 9)):
    sc.render.resolution_x = res
    sc.render.resolution_y = int(res * aspect[1] / aspect[0])
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------

RED = {'fuselage': '#6a0509', 'wingTop': '#6a0509', 'wingBottom': '#6a0509', 'tail': '#f1eee4', 'cowling': '#6a0509', 'accent': '#6a0509', 'insignia': 'iron-cross-patee'}
PC10 = {'fuselage': '#4f4a31', 'wingTop': '#4f4a31', 'wingBottom': '#d8cfae', 'tail': '#4f4a31', 'cowling': '#a7a9a4', 'accent': '#4f4a31', 'insignia': 'roundel-rfc'}
SE5 = {'fuselage': '#4f4a31', 'wingTop': '#4f4a31', 'wingBottom': '#d8cfae', 'tail': '#4f4a31', 'cowling': '#a7a9a4', 'accent': '#f1eee4', 'insignia': 'roundel-rfc'}


def scene_title(opt):
    sc = reset('Khronos PBR Neutral')
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 0.5
    sc.frame_set(1)
    sky_world(sc, elevation_deg=6, rotation_deg=-32, strength=0.07, dust=3.0, air=1.3, ground_color=(3.6, 2.6, 1.9, 1))
    alt = 2200
    plane('Ground', 400000, 0, terrain_material(haze=(0.78, 0.62, 0.52, 1), haze_dist=30000, front_x=-1100, glow=0.5))
    clouds = cloud_material(density=0.6, scale=0.0007, threshold=0.72, color=(1, 0.97, 0.94, 1))
    cloud_box('CloudDeck', (0, 100000, 1300), (300000, 220000, 800), clouds)
    # Richthofen's Dr.I in the foreground right, banking left onto the tail of a Camel
    dri, _ = build_painted('fokker_dri', RED, 'dri', loc=(3.6, 5.5, alt + 0.3), rot=(math.radians(4), math.radians(-34), math.radians(18)))
    camel, _ = build_painted('sopwith_camel', PC10, 'camel', loc=(-7.5, 34, alt + 4.5), rot=(math.radians(-8), math.radians(-40), math.radians(80)))
    bpy.context.view_layer.update()
    tm = mat('Tracer', emission=(1.0, 0.5, 0.15, 1), strength=2.5)
    rng = random.Random(4)
    for k in range(10):
        for gx in (-0.12, 0.12):
            muzzle = dri.matrix_world @ Vector((gx, 1.1, 0.55))
            aim = camel.matrix_world.translation + Vector((rng.uniform(-2.5, 2.5), rng.uniform(-1, 1), rng.uniform(-1.5, 1.5)))
            d = (aim - muzzle).normalized()
            a = muzzle + d * (5 + k * 3.4 + rng.uniform(0, 1.5))
            tracer(a, a + d * 1.6, tm, r=0.025)
    sm = smoke_material((0.035, 0.032, 0.03, 1), 0.9)
    fwd = (camel.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()
    base = camel.matrix_world @ Vector((0, 1.0, 0.0))
    trail = [base - fwd * (0.6 + 0.9 * i) + Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0.05 * i)) for i in range(40)]
    smoke_puffs(trail, sm, base_r=0.35, grow=0.06)
    camera(sc, (0.5, -9, alt + 1.6), (-1.5, 30, alt + 0.6), lens=35, dof=9)
    sc.cycles.volume_step_rate = 4.0
    sc.cycles.volume_max_steps = 256
    render(sc, opt['out'] or os.path.join(REPO, 'public', 'art', 'title.jpg'), opt['res'], opt['samples'])


def foliage_material():
    m = bpy.data.materials.new('Foliage')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 1.0
    n = node(nt, 'ShaderNodeTexNoise', (-500, 0), Scale=3.0, Detail=6.0)
    r = node(nt, 'ShaderNodeValToRGB', (-250, 0))
    r.color_ramp.elements[0].color = (0.012, 0.022, 0.008, 1)
    r.color_ramp.elements[1].color = (0.03, 0.05, 0.014, 1)
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], b.inputs['Base Color'])
    bump = node(nt, 'ShaderNodeBump', (-150, -200), Strength=0.8)
    nt.links.new(n.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def canvas_material():
    """Weathered hangar canvas with vertical panel seams."""
    m = bpy.data.materials.new('Canvas')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.95
    tc = node(nt, 'ShaderNodeTexCoord', (-800, 0))
    wave = node(nt, 'ShaderNodeTexWave', (-600, 0), Scale=0.9, Distortion=0.4)
    wave.bands_direction = 'Y'
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    n = node(nt, 'ShaderNodeTexNoise', (-600, -250), Scale=0.4, Detail=5.0)
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    r = node(nt, 'ShaderNodeValToRGB', (-350, -250))
    r.color_ramp.elements[0].color = (0.32, 0.28, 0.2, 1)
    r.color_ramp.elements[1].color = (0.52, 0.47, 0.36, 1)
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 0.25
    nt.links.new(r.outputs['Color'], mix.inputs[6])
    nt.links.new(wave.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def bessonneau(x, y, heading, m_canvas, m_wood, length=24, width=20, height=6.5):
    """Canvas Bessonneau hangar: arched roof on wooden frames, open front."""
    obs = []
    n = 14
    rings = []
    for j in range(n + 1):
        a = math.pi * j / n
        rings.append((math.cos(a) * width / 2, math.sin(a) * height * 0.55 + height * 0.45))
    verts, faces = [], []
    for i, yy in enumerate((0, length)):
        for (rx, rz) in rings:
            verts.append((rx, yy, rz))
    # side walls
    verts += [(-width / 2, 0, 0), (-width / 2, length, 0), (width / 2, 0, 0), (width / 2, length, 0)]
    for j in range(n):
        faces.append((j, j + 1, n + 1 + j + 1, n + 1 + j))
    b = 2 * (n + 1)
    faces.append((b + 0, b + 1, n + 1 + n, n))  # left wall (x=-w/2) uses ring index n (cos pi = -1)
    faces.append((b + 2, 0, n + 1, b + 3))
    # back wall
    faces.append(tuple([n + 1 + j for j in range(n + 1)]))
    ob = add_mesh('Hangar', verts, faces, m_canvas)
    ob.location = (x, y, 0)
    ob.rotation_euler = (0, 0, heading)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    obs.append(ob)
    return obs


def scene_aerodrome(opt):
    sc = reset()
    sky_world(sc, elevation_deg=5.0, rotation_deg=-80, strength=0.07, dust=3.5, air=1.4, ground_color=(2.0, 1.6, 1.3, 1))
    grass = bpy.data.materials.new('Grass')
    grass.use_nodes = True
    nt = grass.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 1.0
    noise = node(nt, 'ShaderNodeTexNoise', (-600, 0), Scale=0.08, Detail=12.0, Roughness=0.65)
    ramp = node(nt, 'ShaderNodeValToRGB', (-350, 0))
    ramp.color_ramp.elements[0].color = (0.06, 0.1, 0.03, 1)
    ramp.color_ramp.elements[1].color = (0.2, 0.24, 0.08, 1)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    bump = node(nt, 'ShaderNodeBump', (-200, -200), Strength=0.4)
    n2 = node(nt, 'ShaderNodeTexNoise', (-500, -250), Scale=40.0, Detail=4.0)
    nt.links.new(n2.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    plane('Field', 6000, 0, grass)
    canvas_m = canvas_material()
    wood_m = mat('Timber', (0.2, 0.13, 0.07, 1), rough=0.8)
    for i, x in enumerate((-40, -14, 12)):
        bessonneau(-28, 2 + i * 26, math.radians(90), canvas_m, wood_m)
    # Parked scouts in a line, tails down (rotate so wheels + skid touch)
    lineup = [('sopwith_camel', PC10, (0, 6), -90), ('se5a', SE5, (1, 17), -92), ('sopwith_camel', PC10, (0, 28), -88)]
    for k, (aid, liv, (x, y), hdg) in enumerate(lineup):
        root, ac = build_painted(aid, liv, f'p{k}', prop_blur=False)
        wl = ac.contacts['Contact_WheelL']
        sk = ac.contacts['Contact_Skid']
        pitch = math.atan2(sk[2] - wl[2], wl[1] - sk[1])
        root.rotation_euler = Euler((pitch, 0, math.radians(hdg)), 'XYZ')
        bpy.context.view_layer.update()
        wl_w = root.matrix_world @ Vector(wl)
        root.location = (x, y, -wl_w.z + 0.02)
    # Morning ground mist
    mist = bpy.data.materials.new('Mist')
    mist.use_nodes = True
    mnt = mist.node_tree
    for n_ in list(mnt.nodes):
        if n_.type == 'BSDF_PRINCIPLED':
            mnt.nodes.remove(n_)
    vs = node(mnt, 'ShaderNodeVolumeScatter', (0, 0))
    vs.inputs['Density'].default_value = 0.0009
    vs.inputs['Anisotropy'].default_value = 0.5
    mnt.links.new(vs.outputs[0], mnt.nodes['Material Output'].inputs['Volume'])
    cloud_box('Mist', (0, 400, 12), (2000, 1600, 24), mist)
    # Poplar tree line far back
    tree_m = foliage_material()
    rng = random.Random(7)
    # A line of poplars along the far hedge, each a few jittered lumps with noisy displacement
    for i in range(46):
        x0, y0 = -300 + i * 13 + rng.uniform(-4, 4), 170 + rng.uniform(-10, 10)
        h = 16 + rng.uniform(-5, 5)
        for k in range(4):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(x0 + rng.uniform(-0.8, 0.8), y0 + rng.uniform(-0.8, 0.8), h * (0.3 + 0.18 * k)))
            t = bpy.context.active_object
            t.scale = (1.7 - 0.25 * k + rng.uniform(-0.2, 0.2), 1.7 - 0.25 * k, h * 0.3)
            t.data.materials.append(tree_m)
            d = t.modifiers.new('d', 'DISPLACE')
            tex = bpy.data.textures.new(f'tn{i}_{k}', 'CLOUDS')
            tex.noise_scale = 0.6
            d.texture = tex
            d.strength = 0.6
    # Set dressing: fuel drums and a crate by the first machine
    drum_m = mat('Drum', (0.12, 0.16, 0.1, 1), rough=0.5, metal=0.6)
    for (x, y) in ((-9.5, -3.5), (-8.7, -2.8), (-9.1, -4.4)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.29, depth=0.88, location=(x, y, 0.44))
        bpy.context.active_object.data.materials.append(drum_m)
    crate_m = mat('Crate', (0.25, 0.17, 0.09, 1), rough=0.8)
    bpy.ops.mesh.primitive_cube_add(size=0.8, location=(-10.6, -1.8, 0.4), rotation=(0, 0, 0.4))
    bpy.context.active_object.data.materials.append(crate_m)
    # Windsock pole
    camera(sc, (12, -6, 1.1), (-3, 12, 3.2), lens=30, dof=None)
    sc.view_settings.exposure = 1.4
    sc.cycles.volume_step_rate = 2.0
    render(sc, opt['out'] or os.path.join(REPO, 'public', 'art', 'menu-aerodrome.jpg'), opt['res'], opt['samples'])


def map_canvas():
    """Paper trench map of the sector drawn from src/data/geography.ts (exported alongside aircraft.json)."""
    geo_path = os.path.join(HERE, 'out', 'geography.json')
    geo = json.load(open(geo_path)) if os.path.exists(geo_path) else {'towns': [], 'rivers': [], 'front': []}
    W, H = 2048, 1448
    cv = Canvas(W, H, '#d9c9a3')
    cv.noise(11, 0.06, 64)
    lat0, lat1, lon0, lon1 = 49.6, 51.1, 1.9, 3.9

    def px(lat, lon):
        return ((lon - lon0) / (lon1 - lon0) * W, (lat1 - lat) / (lat1 - lat0) * H)

    def line(pts, color, width):
        for (a, b) in zip(pts[:-1], pts[1:]):
            (x0, y0), (x1, y1) = px(*a), px(*b)
            L = max(1.0, math.hypot(x1 - x0, y1 - y0))
            for t in np.linspace(0, 1, int(L / 2) + 2):
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                x0i, x1i = int(max(0, x - width)), int(min(W, x + width + 1))
                y0i, y1i = int(max(0, y - width)), int(min(H, y + width + 1))
                if x1i <= x0i or y1i <= y0i:
                    continue
                sub = (cv.xs[y0i:y1i, x0i:x1i] - x) ** 2 + (cv.ys[y0i:y1i, x0i:x1i] - y) ** 2 <= width * width
                cv.a[y0i:y1i, x0i:x1i][sub] = hexrgb(color)
    # grid
    for k in range(1, 10):
        cv.rect(k * W / 10 - 1, 0, k * W / 10 + 1, H, '#b9a57e')
        cv.rect(0, k * H / 7 - 1, W, k * H / 7 + 1, '#b9a57e')
    for r in geo['rivers']:
        line(r['points'], '#5a7b93', 4)
    # sea (north-west of the coastline)
    coast = sorted([(lo, la) for la, lo in geo.get('coast', [])])
    if coast:
        lons = np.array([c[0] for c in coast]); lats = np.array([c[1] for c in coast])
        lon_px = lon0 + cv.xs / W * (lon1 - lon0)
        lat_px = lat1 - cv.ys / H * (lat1 - lat0)
        cl = np.interp(lon_px, lons, lats, left=lats[0], right=lats[-1])
        sea = lat_px > cl
        cv.fill(sea, '#a9b9b4')
        cv.fill(sea & (np.abs(lat_px - cl) < 0.012), '#6d8580')
    if geo['front']:
        # British trench maps: own lines blue, German lines red
        line([(la, lo - 0.025) for la, lo in geo['front']], '#2a3f7a', 5)
        line([(la, lo + 0.02) for la, lo in geo['front']], '#a51c14', 6)
    for t in geo['towns']:
        x, y = px(t['lat'], t['lon'])
        r = {'city': 14, 'town': 10, 'village': 6}[t['size']]
        cv.ellipse(x, y, r, r, '#2b241a')
    return cv


FONT_DIR = '/System/Library/Fonts/Supplemental'


def load_font(name):
    try:
        return bpy.data.fonts.load(os.path.join(FONT_DIR, name), check_existing=True)
    except RuntimeError:
        return None


def text_obj(body, loc, size, font, material, parent=None, rot_z=0.0, align='LEFT'):
    cu = bpy.data.curves.new('T', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = align
    if font:
        cu.font = font
    cu.materials.append(material)
    ob = bpy.data.objects.new('Text', cu)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def scene_desk(opt):
    sc = reset()
    w = bpy.data.worlds.new('Room')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.018, 0.015, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
    sc.world = w
    serif = load_font('Georgia.ttf')
    serif_b = load_font('Georgia Bold.ttf')
    mono = load_font('Courier New.ttf')
    ink = mat('Ink', (0.05, 0.045, 0.04, 1), rough=0.6)
    red_ink = mat('RedInk', (0.35, 0.04, 0.03, 1), rough=0.5)
    # desk (dark oak) with leather blotter
    desk = bpy.data.materials.new('Desk')
    desk.use_nodes = True
    nt = desk.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.42
    wave = node(nt, 'ShaderNodeTexWave', (-700, 0), Scale=0.6, Distortion=14.0, Detail=8.0)
    wave.bands_direction = 'X'
    ramp = node(nt, 'ShaderNodeValToRGB', (-400, 0))
    ramp.color_ramp.elements[0].color = (0.035, 0.016, 0.008, 1)
    ramp.color_ramp.elements[1].color = (0.13, 0.065, 0.028, 1)
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    plane('DeskTop', 4, 0, desk)
    blotter = mat('Blotter', (0.06, 0.1, 0.07, 1), rough=0.85)
    bl = plane('Blotter', 1.0, 0.001, blotter)
    bl.scale = (1.15, 0.8, 1)
    bl.location = (0.12, 0.0, 0)
    # the sector map, pinned slightly askew
    cvm = map_canvas()
    mm = bpy.data.materials.new('Map')
    mm.use_nodes = True
    tex = mm.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = cvm.to_image('MapImg')
    mm.node_tree.links.new(tex.outputs['Color'], mm.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    mm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
    me = bpy.data.meshes.new('Map')
    s = (0.84, 0.594)
    me.from_pydata([(-s[0] / 2, -s[1] / 2, 0.003), (s[0] / 2, -s[1] / 2, 0.003), (s[0] / 2, s[1] / 2, 0.003), (-s[0] / 2, s[1] / 2, 0.003)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new()
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = c
    me.materials.append(mm)
    mob = bpy.data.objects.new('Map', me)
    sc.collection.objects.link(mob)
    mob.location = (0.2, 0.02, 0)
    mob.rotation_euler = (0, 0, math.radians(-3))
    geo = json.load(open(os.path.join(HERE, 'out', 'geography.json')))
    lat0, lat1, lon0, lon1 = 49.6, 51.1, 1.9, 3.9
    for t in geo['towns']:
        u = (t['lon'] - lon0) / (lon1 - lon0)
        v = (t['lat'] - lat0) / (lat1 - lat0)
        if not (0.02 < u < 0.98 and 0.03 < v < 0.97):
            continue
        size = {'city': 0.0135, 'town': 0.011, 'village': 0.0085}[t['size']]
        text_obj(t['name'].upper() if t['size'] == 'city' else t['name'], ((u - 0.5) * s[0] + 0.008, (v - 0.5) * s[1] + 0.004, 0.0035), size, serif, ink, parent=mob)
    text_obj('WESTERN FRONT', (-0.24, 0.235, 0.0035), 0.026, serif_b, ink, parent=mob, align='CENTER')
    text_obj('Sheet 51b  —  Scale 1 : 250,000', (-0.24, 0.212, 0.0035), 0.011, serif, ink, parent=mob, align='CENTER')
    text_obj('Enemy lines in red', (0.3, -0.27, 0.0035), 0.01, serif, red_ink, parent=mob)
    # typed orders & reports
    paper = mat('Paper', (0.74, 0.7, 0.6, 1), rough=0.9)
    docs = [
        ((-0.66, 0.2, 0.004), 7, ['OPERATION ORDERS', '', 'Patrol:  Offensive, 2 flights.', 'Area:    Douai - Cambrai.', 'Height:  12,000 ft.', 'Time:    Dawn.', '', 'Engage all hostile machines', 'encountered. Special attention', 'to two-seaters over the lines.']),
        ((-0.6, -0.2, 0.005), -6, ['COMBAT REPORT', '', 'Locality: E. of Arras', 'Duty:     O.P.', 'Result:   1 E.A. driven down', '          out of control.', '', 'Narrative: Observed five', 'Albatros scouts at 10,000 ft...']),
    ]
    for (x, y, z), rot, lines in docs:
        p = plane('Paper', 0.3, 0, paper)
        p.scale = (0.72, 1.0, 1)
        p.location = (x, y, z)
        p.rotation_euler = (0, 0, math.radians(rot))
        for i, ln in enumerate(lines):
            if ln:
                text_obj(ln, (-0.095, 0.12 - i * 0.022, 0.0012), 0.0105 if i else 0.013, mono, ink, parent=p)
    # brass lamp with green glass shade
    brass = mat('Brass', (0.75, 0.55, 0.25, 1), rough=0.25, metal=1.0)
    for (loc, r, d) in (((-0.5, 0.46, 0.015), 0.1, 0.03), ((-0.5, 0.46, 0.2), 0.012, 0.36)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=d, location=loc)
        bpy.context.active_object.data.materials.append(brass)
        bpy.ops.object.shade_smooth()
    shade = mat('Shade', (0.03, 0.22, 0.08, 1), rough=0.15)
    bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=0.17, radius2=0.06, depth=0.12, location=(-0.46, 0.4, 0.38), end_fill_type='NOTHING')
    bpy.context.active_object.data.materials.append(shade)
    bpy.ops.object.shade_smooth()
    ld = bpy.data.lights.new('Lamp', 'POINT')
    ld.energy = 70
    ld.color = (1.0, 0.72, 0.42)
    ld.shadow_soft_size = 0.05
    lo = bpy.data.objects.new('Lamp', ld)
    sc.collection.objects.link(lo)
    lo.location = (-0.46, 0.4, 0.34)
    fd = bpy.data.lights.new('Window', 'AREA')
    fd.energy = 25
    fd.size = 1.5
    fd.color = (0.7, 0.8, 1.0)
    fo = bpy.data.objects.new('Window', fd)
    sc.collection.objects.link(fo)
    fo.location = (1.6, -1.0, 1.6)
    fo.rotation_euler = (math.radians(50), 0, math.radians(55))
    # pencil, tin mug, flying goggles
    pencil = mat('Pencil', (0.55, 0.35, 0.08, 1), rough=0.5)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.004, depth=0.17, location=(0.35, -0.3, 0.007), rotation=(0, math.radians(90), math.radians(20)))
    bpy.context.active_object.data.materials.append(pencil)
    tin = mat('Tin', (0.35, 0.36, 0.34, 1), rough=0.35, metal=0.9)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.045, depth=0.1, location=(0.66, 0.36, 0.05))
    bpy.context.active_object.data.materials.append(tin)
    bpy.ops.object.shade_smooth()
    leather = mat('GoggleLeather', (0.12, 0.07, 0.04, 1), rough=0.6)
    glass = mat('GoggleGlass', (0.2, 0.25, 0.2, 1), rough=0.05, metal=0.2)
    for dx in (-0.045, 0.045):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.032, minor_radius=0.008, location=(0.62 + dx, -0.3, 0.01))
        bpy.context.active_object.data.materials.append(brass)
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.03, depth=0.004, location=(0.62 + dx, -0.3, 0.012))
        bpy.context.active_object.data.materials.append(glass)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.1, minor_radius=0.006, location=(0.62, -0.25, 0.006))
    bpy.context.active_object.scale = (1.2, 0.5, 0.4)
    bpy.context.active_object.data.materials.append(leather)
    cam = camera(sc, (0.04, -0.02, 1.5), (0.04, 0.0, 0), lens=35)
    cam.rotation_euler = (0, 0, 0)
    render(sc, opt['out'] or os.path.join(REPO, 'public', 'art', 'briefing-desk.jpg'), opt['res'], opt['samples'])


def scene_debrief(opt):
    sc = reset('Khronos PBR Neutral')
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 0.5
    sc.frame_set(1)
    # Evening: the sun sinking ahead, a lone scout heading home over a broken cloud layer
    sky_world(sc, elevation_deg=1.6, rotation_deg=8, strength=0.07, dust=4.0, air=1.5, ground_color=(3.0, 1.9, 1.2, 1))
    alt = 2100
    plane('Ground', 400000, 0, terrain_material(haze=(0.62, 0.36, 0.24, 1), haze_dist=20000, front_x=6000, glow=0.22))
    clouds = cloud_material(density=0.55, scale=0.0006, threshold=0.76, color=(1, 0.95, 0.92, 1))
    cloud_box('CloudDeck', (0, 100000, 1100), (300000, 220000, 700), clouds)
    root, _ = build_painted('se5a', SE5, 'home', loc=(-9, 60, alt + 4), rot=(math.radians(3), math.radians(-8), math.radians(-6)))
    # distant smoke columns over the lines
    sm = smoke_material((0.06, 0.05, 0.045, 1), 0.3)
    rng = random.Random(9)
    for (x, y) in ((-3800, 9000), (2200, 12000), (-700, 7000), (5200, 15000)):
        pts = [(x + i * 30 + rng.uniform(-20, 20), y + i * 14, 30 + i * 55) for i in range(16)]
        smoke_puffs(pts, sm, base_r=60, grow=16)
    camera(sc, (4, -6, alt + 2.5), (-4, 60, alt + 2.0), lens=32)
    sc.cycles.volume_step_rate = 4.0
    sc.cycles.volume_max_steps = 256
    render(sc, opt['out'] or os.path.join(REPO, 'public', 'art', 'debrief-sky.jpg'), opt['res'], opt['samples'])


SCENES = {'title': scene_title, 'aerodrome': scene_aerodrome, 'desk': scene_desk, 'debrief': scene_debrief}

if __name__ == '__main__':
    o = argv()
    SCENES[o['scene']](o)
