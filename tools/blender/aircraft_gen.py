"""
Parametric WWI aircraft generator for Blender (bpy).

Builds one aircraft from the AircraftGeometry JSON exported by
tools/export-aircraft-json.ts. Used by build_models.py (GLB export +
previews) and art.py (key art renders).

Frame (DECISIONS.md D-004): nose -> Blender +Y, top -> +Z, right wing -> +X.
The glTF exporter's Y-up conversion turns that into body frame
(forward -Z, up +Y, right +X). Origin = centre of gravity.

UV / canvas conventions consumed by src/render/aircraft/livery.ts are
documented in docs/models.md. All "canvas" v coordinates below have v=0 at
the TOP of the canvas (glTF convention); they are flipped for Blender.
"""
import math

import bmesh
import bpy
from mathutils import Vector

TAU = math.tau

# ---------------------------------------------------------------------------
# Per-type details that AircraftGeometry doesn't carry.
# ---------------------------------------------------------------------------

TIP = {
    'fokker_dvii': 'square', 'se5a': 'raked', 'spad_vii': 'square', 'spad_xiii': 'square',
    'bristol_f2b': 'raked', 're8': 'raked', 'dh4': 'square', 'rumpler_civ': 'raked',
    'halberstadt_clii': 'square', 'fokker_dviii': 'round', 'airco_dh2': 'square',
    'sopwith_triplane': 'round', 'fokker_eiii': 'square',
}
THICK = {'fokker_dvii': 0.12, 'fokker_dri': 0.12, 'fokker_dviii': 0.14}
SPINNER = {'albatros_dii', 'albatros_diii', 'albatros_dv', 'pfalz_diiia', 'rumpler_civ'}
WING_RADIATOR = {'albatros_diii', 'albatros_dv', 'pfalz_diiia', 'albatros_dii'}
EXPOSED_HEADS = {'albatros_dii', 'albatros_diii', 'albatros_dv', 'pfalz_diiia', 'halberstadt_clii', 'rumpler_civ', 'fokker_dvii'}
AXLE_WING = {'fokker_dri', 'fokker_dvii', 'fokker_dviii'}
NO_WIRES = {'fokker_dri', 'fokker_dvii', 'fokker_dviii'}
TWO_BAY = {'bristol_f2b', 're8', 'dh4', 'rumpler_civ', 'halberstadt_clii'}
INTERMEDIATE_STRUTS = {'spad_vii', 'spad_xiii'}
N_STRUTS = {'fokker_dvii'}
RADIATOR_FRONT = {'fokker_dvii': 'box', 'se5a': 'box', 'bristol_f2b': 'box', 'dh4': 'box', 're8': 'none',
                  'spad_vii': 'round', 'spad_xiii': 'round', 'halberstadt_clii': 'none', 'rumpler_civ': 'none'}
HUMP = {'sopwith_camel'}
LOWER_WING_BELOW = {'bristol_f2b'}
SHARED_COCKPIT = {'halberstadt_clii'}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def smoothstep(a, b, x):
    if b == a:
        return 1.0 if x >= b else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def hex_rgba(h, a=1.0):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    # sRGB -> linear
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), a)


MAT_DEFAULTS = {
    'Livery_Fuselage': ('#8a8660', 0.75, 0.0, True),
    'Livery_WingTop': ('#6b6f45', 0.8, 0.0, True),
    'Livery_WingBottom': ('#c9c2a0', 0.8, 0.0, True),
    'Livery_Tail': ('#8a8660', 0.75, 0.0, True),
    'Livery_Cowling': ('#9a9a92', 0.4, 0.6, True),
    'Livery_Accent': ('#7a1c16', 0.5, 0.1, False),
    'Metal': ('#2b2b2a', 0.45, 0.85, False),
    'Wood': ('#6b4527', 0.55, 0.0, True),
    'Rubber': ('#161514', 0.9, 0.0, False),
    'Pilot': ('#4a2f1d', 0.7, 0.0, False),
    'Skin': ('#c99577', 0.6, 0.0, False),
    'Leather': ('#3a2416', 0.65, 0.0, True),
    'Glass': ('#9fc7d8', 0.05, 0.3, False),
    'Gauge': ('#e8e0c8', 0.4, 0.0, False),
    'Cloth': ('#e9e4d6', 0.9, 0.0, False),
}


def get_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, rough, metal, dbl = MAT_DEFAULTS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = hex_rgba(col)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if name == 'Glass':
        bsdf.inputs['Alpha'].default_value = 0.45
    m.use_backface_culling = not dbl
    m.diffuse_color = hex_rgba(col)
    return m


class MB:
    """Mesh builder with per-face material slots and per-loop canvas UVs."""

    def __init__(self, mats):
        self.mats = list(mats)
        self.v = []
        self.f = []
        self.fuv = []
        self.fm = []

    def vert(self, co):
        self.v.append(tuple(co))
        return len(self.v) - 1

    def face(self, idx, uvs=None, mat=0):
        if len(set(idx)) < 3:
            return
        self.f.append(tuple(idx))
        self.fuv.append(uvs if uvs is not None else [(0.0, 0.0)] * len(idx))
        self.fm.append(mat)

    def extend(self, other_off_verts):
        pass

    def build(self, name, parent=None, origin=(0, 0, 0), smooth=True, sharp_angle=None, recalc=True):
        ox, oy, oz = origin
        me = bpy.data.meshes.new(name)
        me.from_pydata([(x - ox, y - oy, z - oz) for x, y, z in self.v], [], self.f)
        uvl = me.uv_layers.new(name='UVMap')
        for p in me.polygons:
            uvs = self.fuv[p.index]
            for k, li in enumerate(p.loop_indices):
                u, v = uvs[k]
                uvl.data[li].uv = (u, 1.0 - v)
        for m in self.mats:
            me.materials.append(get_mat(m))
        me.polygons.foreach_set('material_index', self.fm)
        if recalc:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
        if smooth:
            me.shade_smooth()
            if sharp_angle is not None:
                me.set_sharp_from_angle(angle=math.radians(sharp_angle))
        else:
            me.shade_flat()
        me.validate()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = origin
        if parent is not None:
            ob.parent = parent
            ob.location = (ox - world_loc(parent)[0], oy - world_loc(parent)[1], oz - world_loc(parent)[2])
        return ob


def world_loc(ob):
    x = y = z = 0.0
    while ob is not None:
        x += ob.location.x
        y += ob.location.y
        z += ob.location.z
        ob = ob.parent
    return (x, y, z)


def empty(name, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
        p = world_loc(parent)
        ob.location = (loc[0] - p[0], loc[1] - p[1], loc[2] - p[2])
    else:
        ob.location = loc
    return ob


def loft(mb, rings, closed=True, uvs=None, mats=None, cap_start=False, cap_end=False, cap_mat=0):
    """rings: list of point lists; uvs same shape (u,v); mats(i, j) -> material index for quad (i,j)."""
    idx = [[mb.vert(p) for p in ring] for ring in rings]
    n = len(rings[0])
    seg = n if closed else n - 1
    for i in range(len(rings) - 1):
        for j in range(seg):
            j2 = (j + 1) % n
            q = [idx[i][j], idx[i + 1][j], idx[i + 1][j2], idx[i][j2]]
            quv = None
            if uvs is not None:
                quv = [uvs[i][j], uvs[i + 1][j], uvs[i + 1][j2], uvs[i][j2]]
                if closed and j2 == 0 and len(uvs[i]) > n:  # wrap column
                    quv[2] = uvs[i + 1][n]
                    quv[3] = uvs[i][n]
            mb.face(q, quv, mats(i, j) if mats else 0)
    if cap_start:
        mb.face(list(reversed(idx[0])), None, cap_mat)
    if cap_end:
        mb.face(idx[-1], None, cap_mat)
    return idx


def tube(mb, pts, radius=0.01, sides=4, closed_path=False, mat=0, flatten=None):
    """Sweep a small polygon along a polyline (struts, wires, coaming, pipes)."""
    rings = []
    npts = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        if closed_path:
            a, b = Vector(pts[i - 1]), Vector(pts[(i + 1) % npts])
        else:
            a = Vector(pts[max(0, i - 1)])
            b = Vector(pts[min(npts - 1, i + 1)])
        d = (b - a).normalized()
        ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
        e1 = (ref - d * ref.dot(d)).normalized()
        e2 = d.cross(e1)
        ring = []
        for k in range(sides):
            ang = TAU * k / sides
            r1 = radius * (flatten if flatten else 1.0)
            ring.append(tuple(p + e1 * (math.cos(ang) * r1) + e2 * (math.sin(ang) * radius)))
        rings.append(ring)
    if closed_path:
        rings.append(rings[0])
    loft(mb, rings, closed=True, mats=lambda i, j: mat, cap_start=not closed_path, cap_end=not closed_path, cap_mat=mat)


def strut(mb, p0, p1, chord=0.07, thick=0.022, mat=0):
    """Streamlined strut: long axis of the section aligned with +Y (airflow)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    fwd = Vector((0, 1, 0))
    e1 = (fwd - d * fwd.dot(d))
    if e1.length < 1e-4:
        e1 = Vector((1, 0, 0))
    e1.normalize()
    e2 = d.cross(e1)
    sec = [(0.5, 0), (0.25, 0.9), (-0.2, 1.0), (-0.5, 0.2), (-0.5, -0.2), (-0.2, -1.0), (0.25, -0.9)]
    rings = []
    for p in (p0, p1):
        rings.append([tuple(p + e1 * (a * chord) + e2 * (b * thick * 0.5)) for a, b in sec])
    loft(mb, rings, closed=True, mats=lambda i, j: mat, cap_start=True, cap_end=True, cap_mat=mat)


def cylinder(mb, center, axis, radius, length, sides=12, mat=0, cap=True, r2=None):
    c = Vector(center)
    a = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    e1 = (ref - a * ref.dot(a)).normalized()
    e2 = a.cross(e1)
    rings = []
    for s, rr in ((-0.5, radius), (0.5, r2 if r2 is not None else radius)):
        rings.append([tuple(c + a * (s * length) + (e1 * math.cos(TAU * k / sides) + e2 * math.sin(TAU * k / sides)) * rr) for k in range(sides)])
    loft(mb, rings, closed=True, mats=lambda i, j: mat, cap_start=cap, cap_end=cap, cap_mat=mat)


def box(mb, center, size, mat=0):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    vs = [mb.vert((cx + dx * sx, cy + dy * sy, cz + dz * sz)) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    # index = (dx,dy,dz) bits: dx*4 + dy*2 + dz
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        mb.face([vs[i] for i in f], None, mat)


def ellipsoid(mb, center, radii, segs=10, rings=7, mat=0):
    cx, cy, cz = center
    rx, ry, rz = radii
    pts = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        pts.append([(cx + rx * math.sin(phi) * math.cos(TAU * k / segs), cy + ry * math.sin(phi) * math.sin(TAU * k / segs), cz + rz * math.cos(phi)) for k in range(segs)])
    idx = loft(mb, pts, closed=True, mats=lambda i, j: mat)
    top = mb.vert((cx, cy, cz + rz))
    bot = mb.vert((cx, cy, cz - rz))
    for k in range(segs):
        k2 = (k + 1) % segs
        mb.face([top, idx[0][k], idx[0][k2]], None, mat)
        mb.face([bot, idx[-1][k2], idx[-1][k]], None, mat)


def plate(mb, outline, axis, thickness, uv_fn, mat=0):
    """Flat plate from a 2D outline. axis 'z': outline in (x, y) at z=const(outline[i][2]);
    axis 'x': outline in (y, z) at x=0. uv_fn(point3) -> canvas uv."""
    h = thickness / 2
    if axis == 'z':
        a = [(p[0], p[1], p[2] + h) for p in outline]
        b = [(p[0], p[1], p[2] - h) for p in outline]
    else:
        a = [(h, p[1], p[2]) for p in outline]
        b = [(-h, p[1], p[2]) for p in outline]
    ia = [mb.vert(p) for p in a]
    ib = [mb.vert(p) for p in b]
    mb.face(ia, [uv_fn(p) for p in a], mat)
    mb.face(list(reversed(ib)), [uv_fn(p) for p in reversed(b)], mat)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        mb.face([ia[i], ib[i], ib[j], ia[j]], [uv_fn(a[i]), uv_fn(b[i]), uv_fn(b[j]), uv_fn(a[j])], mat)


# ---------------------------------------------------------------------------
# Airfoil
# ---------------------------------------------------------------------------

def airfoil(f, thick, camber=0.045, p=0.4):
    """Returns (z_upper, z_lower) as fractions of chord at chord fraction f (0 = LE)."""
    t = 5 * thick * (0.2969 * math.sqrt(max(f, 0)) - 0.126 * f - 0.3516 * f ** 2 + 0.2843 * f ** 3 - 0.1036 * f ** 4)
    if f < p:
        yc = camber / p ** 2 * (2 * p * f - f * f)
    else:
        yc = camber / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * f - f * f)
    return yc + t, yc - t * 0.6  # flat-ish undersurface (RAF 15 style)


def cos_space(a, b, n):
    return [a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * i / (n - 1))) for i in range(n)]


# ---------------------------------------------------------------------------
# Aircraft builder
# ---------------------------------------------------------------------------

class Aircraft:
    def __init__(self, spec):
        self.spec = spec
        self.id = spec['id']
        g = spec['geometry']
        self.g = g
        self.rotary = spec['engineType'] == 'rotary'
        self.pusher = bool(g['pusher'])
        self.two = g['crew'] == 2
        self.layout = g['layout']
        L = g['length']
        W = g['fuselageWidth']
        shape = g['fuselageShape']
        self.W = W
        self.H = W * (1.22 if shape == 'slab' else 1.15)
        if self.two:
            self.H = W * 1.25
        self.L = L
        chord = g['chord']
        lchord = g['lowerChord'] or chord
        self.chord = chord
        self.lchord = lchord
        mono = self.layout in ('monoplane', 'parasol')
        cm = chord if mono else (chord + lchord) / 2
        ref = 0.3 * cm
        st = g['stagger']
        if self.layout == 'triplane':
            self.upperLE, self.midLE, self.lowerLE = ref + st, ref, ref - st
        elif mono:
            self.upperLE = ref
            self.lowerLE = ref
            self.midLE = ref
        else:
            self.upperLE, self.lowerLE = ref + st / 2, ref - st / 2
            self.midLE = ref
        if self.pusher:
            self.noseY = self.upperLE + 1.25
            self.nacelleEnd = self.upperLE - chord - 0.35
        else:
            k = 0.16 if self.rotary else 0.2
            self.noseY = self.upperLE + k * L + (0.1 if self.two else 0.0)
        self.tailEndY = self.noseY - L
        self.rudderChord = 0.62 if self.two else 0.55
        self.postY = self.tailEndY + self.rudderChord * 0.85
        self.cowlLen = 0.55 if self.rotary else 0.0
        self.Rc = max(W, self.H) * 0.56 if self.rotary else 0.0
        # cockpit
        upperTE = self.upperLE - chord
        if self.layout == 'triplane':
            self.cpY = self.midLE - chord - 0.05
        elif self.layout == 'parasol':
            self.cpY = upperTE - 0.05
        elif self.layout == 'monoplane':
            self.cpY = upperTE - 0.15
        else:
            self.cpY = upperTE + 0.05
        if self.pusher:
            self.cpY = self.upperLE - 0.2
        self.gunY = self.cpY - 1.05
        self.span = g['span']
        self.thick = THICK.get(self.id, 0.075)
        self.tip = TIP.get(self.id, 'round')
        # tail plane sizing
        self.tailSpan = max(2.2, min(4.8, 0.32 * self.span))
        self.stabChord = 0.55 if not self.two else 0.7
        self.elevChord = 0.45 if not self.two else 0.5
        self.meta = {}
        self.muzzles = []

    # ------------------------------------------------------------ fuselage
    def t_of(self, y):
        end = self.nacelleEnd if self.pusher else self.postY
        return (self.noseY - y) / (self.noseY - end)

    def y_of(self, t):
        end = self.nacelleEnd if self.pusher else self.postY
        return self.noseY - t * (self.noseY - end)

    def profile(self, t):
        """Return (halfWidth, zTop, zBot, nTop, nBot)."""
        W, H = self.W, self.H
        shape = self.g['fuselageShape']
        if self.pusher:
            # nacelle: bullet nose, boxy, cut off at the engine
            w = W / 2 * (0.55 + 0.45 * smoothstep(0.0, 0.3, t))
            top = H / 2 * (0.5 + 0.5 * smoothstep(0.0, 0.35, t))
            bot = -H / 2 * (0.6 + 0.4 * smoothstep(0.0, 0.3, t))
            return w, top, bot, 3.0, 3.0
        taper = smoothstep(0.38, 1.0, t)
        w = W / 2 * (1 - 0.92 * (taper ** 0.9))
        top = lerp(H / 2, H * 0.24, smoothstep(0.35, 1.0, t))
        bot = lerp(-H / 2, H * 0.02, smoothstep(0.42, 1.0, t) ** 0.85)
        if shape == 'plywood-oval':
            nose = smoothstep(0.0, 0.22, t)
            w *= 0.45 + 0.55 * nose
            top = lerp(0.18, top, nose)
            bot = lerp(-0.2, bot, nose)
            nt, nb = 2.1, 2.1
        elif shape == 'round':
            nt, nb = 2.0, 3.2
        else:
            nt, nb = 4.5, 4.5
        if self.id in HUMP:
            top += 0.1 * smoothstep(0.05, 0.14, t) * (1 - smoothstep(0.26, 0.36, t))
        if self.id == 'fokker_dvii':
            top -= 0.04 * (1 - smoothstep(0.0, 0.15, t))
        return w, top, bot, nt, nb

    def ring(self, t, N=24):
        w, top, bot, nt, nb = self.profile(t)
        zc, hh = (top + bot) / 2, (top - bot) / 2
        y = self.y_of(t)
        pts = []
        for j in range(N):
            th = TAU * j / N
            s, c = math.sin(th), math.cos(th)
            n = nt if c > 0 else nb
            x = w * math.copysign(abs(s) ** (2 / n), s)
            z = zc + hh * math.copysign(abs(c) ** (2 / n), c)
            pts.append([x, y, z])
        # round-nose blend (rotary cowl / SPAD radiator)
        blend_r = None
        if self.rotary and not self.pusher:
            t0 = self.cowlLen / (self.noseY - self.postY)
            k = 1 - smoothstep(t0, t0 + 0.1, t)
            blend_r = (self.Rc * 0.98, k)
        elif RADIATOR_FRONT.get(self.id) == 'round':
            k = 1 - smoothstep(0.0, 0.14, t)
            blend_r = (max(self.W, self.H) * 0.5, k)
        if blend_r and blend_r[1] > 0:
            r, k = blend_r
            for j, p in enumerate(pts):
                th = TAU * j / N
                p[0] = lerp(p[0], r * math.sin(th), k)
                p[2] = lerp(p[2], r * math.cos(th), k)
        return [tuple(p) for p in pts]

    def fuselage_top(self, y):
        return self.profile(self.t_of(y))[1]

    def fuselage_bot(self, y):
        return self.profile(self.t_of(y))[2]

    def fuselage_halfw(self, y):
        return self.profile(self.t_of(y))[0]

    def build_fuselage(self, parent):
        N = 24
        mb = MB(['Livery_Fuselage', 'Livery_Cowling'])
        t_start = self.cowlLen / (self.noseY - (self.nacelleEnd if self.pusher else self.postY)) if self.rotary and not self.pusher else 0.0
        ts = set([t_start, t_start + 0.02, t_start + 0.05, 0.1, 0.14, 0.18, 0.22, 0.27, 0.32, 0.38, 0.44, 0.5, 0.57, 0.64, 0.72, 0.8, 0.88, 0.94, 1.0])
        holes = []
        pil = (self.t_of(self.cpY + 0.38), self.t_of(self.cpY - 0.42))
        holes.append(pil)
        if self.two:
            gh = (self.t_of(self.gunY + 0.4), self.t_of(self.gunY - 0.45))
            if self.id in SHARED_COCKPIT:
                holes = [(pil[0], gh[1])]
            else:
                holes.append(gh)
        for a, b in holes:
            ts.update([a, b, (a + b) / 2])
        if self.pusher:
            ts = set(t for t in ts if t <= 1.0) | {0.02, 0.05}
        ts = sorted(t for t in ts if t_start - 1e-6 <= t <= 1.0)
        # dedupe near-equal
        tl = []
        for t in ts:
            if not tl or t - tl[-1] > 0.008:
                tl.append(t)
        rings = [self.ring(t, N) for t in tl]
        # UVs: u = t along length; v = arc-length based (right half / left half)
        Lf = self.noseY - (self.nacelleEnd if self.pusher else self.postY)
        perims = []
        for r in rings:
            P = sum((Vector(r[j]) - Vector(r[(j + 1) % N])).length for j in range(N))
            perims.append(P)
        Pref = max(perims)
        uvs = []
        for ti, r in zip(tl, rings):
            acc = [0.0]
            for j in range(N):
                acc.append(acc[-1] + (Vector(r[j]) - Vector(r[(j + 1) % N])).length)
            half = N // 2
            q1, q3 = acc[N // 4], acc[3 * N // 4]
            row = []
            for j in range(N + 1):
                s = acc[j]
                if j <= half:
                    v = 0.25 + (s - q1) / Pref
                else:
                    v = 0.75 + (s - q3) / Pref
                row.append((ti, v))
            uvs.append(row)
        # left-half faces use left-half v for the shared vertices at j=half and j=N(=0)
        n = N
        idx = [[mb.vert(p) for p in ring] for ring in rings]
        cowl_t = 0.16 if (not self.rotary and not self.pusher) else -1

        def in_hole(t0, t1, j):
            for a, b in holes:
                if t0 >= a - 1e-6 and t1 <= b + 1e-6:
                    th0 = TAU * j / N
                    th1 = TAU * (j + 1) / N
                    lim = math.radians(40)
                    d0 = min(th0, TAU - th0)
                    d1 = min(th1, TAU - th1)
                    if d0 <= lim + 1e-6 and d1 <= lim + 1e-6:
                        return True
            return False

        for i in range(len(rings) - 1):
            for j in range(n):
                if in_hole(tl[i], tl[i + 1], j):
                    continue
                j2 = (j + 1) % n
                if j < N // 2:
                    uv = [uvs[i][j], uvs[i + 1][j], uvs[i + 1][j + 1], uvs[i][j + 1]]
                else:
                    uv =[self._lv(uvs, i, j), self._lv(uvs, i + 1, j), self._lv(uvs, i + 1, j + 1), self._lv(uvs, i, j + 1)]
                m = 1 if tl[i + 1] <= cowl_t + 1e-6 else 0
                mb.face([idx[i][j], idx[i + 1][j], idx[i + 1][j2], idx[i][j2]], uv, m)
        # caps
        if not self.rotary or self.pusher:
            c0 = mb.vert((0, self.noseY, (rings[0][0][2] + rings[0][N // 2][2]) / 2))
            for j in range(n):
                mb.face([c0, idx[0][(j + 1) % n], idx[0][j]], None, 1 if not self.pusher else 0)
        cE = mb.vert((0, rings[-1][0][1], (rings[-1][0][2] + rings[-1][N // 2][2]) / 2))
        for j in range(n):
            mb.face([cE, idx[-1][j], idx[-1][(j + 1) % n]], None, 0)
        self.meta['uv_fuselage_len'] = Lf
        self.meta['uv_fuselage_perim'] = Pref
        self.meta['uv_fuselage_nose_y'] = -self.noseY  # body frame z of u=0
        self.hole_rings = (tl, rings, holes)
        ob = mb.build('Fuselage', parent, smooth=True, sharp_angle=50, recalc=False)
        return ob

    def _lv(self, uvs, i, j):
        """Left-half v for vertex j of ring i (j in [N/2, N])."""
        u, v = uvs[i][j]
        N = len(uvs[i]) - 1
        if j == N // 2:
            # mirror of right-half bottom: right v = 0.25 + d  -> left v = 0.75 - d
            d = v - 0.25
            return (u, 0.75 - d)
        return (u, v)

    def build_coaming(self, parent):
        tl, rings, holes = self.hole_rings
        N = len(rings[0])
        mb = MB(['Leather'])
        jl = [N - 2, N - 1, 0, 1, 2]  # +-30deg... boundary of 40deg cut is at j=+-2 (30deg) with N=24 -> use 40 deg: j within 2.67
        for a, b in holes:
            ids = [i for i, t in enumerate(tl) if a - 1e-6 <= t <= b + 1e-6]
            if len(ids) < 2:
                continue
            path = []
            i0, i1 = ids[0], ids[-1]
            for j in jl:
                path.append(rings[i0][j])
            for i in ids[1:-1]:
                path.append(rings[i][2])
            for j in reversed(jl):
                path.append(rings[i1][j])
            for i in reversed(ids[1:-1]):
                path.append(rings[i][N - 2])
            tube(mb, path, radius=0.024, sides=6, closed_path=True)
        return mb.build('Coaming', parent, smooth=True)

    # ------------------------------------------------------------ wings
    def wing_half(self, mb, side, x0, x1, le, chord, z0, dihedral, span_ref, chord_ref,
                  top_region, bot_region, cut=None, name_tip=True):
        """Append a half-wing loft (x0..x1 in |x|), chord range cut=(f0,f1) (fractions)."""
        thick = self.thick
        f0, f1 = cut if cut else (0.0, 1.0)
        nf = 7
        fs = cos_space(f0, f1, nf) if f0 == 0.0 else [f0 + (f1 - f0) * i / (nf - 1) for i in range(nf)]
        half = self.span / 2 if span_ref is None else None
        tip_x = x1
        tip_zone = (x1 - x0) * 0.16 if self.tip == 'round' else (x1 - x0) * 0.12
        xs = [x0 + (x1 - x0) * k / 5 for k in range(6)]
        if self.tip in ('round', 'raked', 'square') and name_tip:
            xs = [x for x in xs if x < x1 - tip_zone - 1e-6]
            xs += [x1 - tip_zone * (1 - q) for q in (0.0, 0.45, 0.75, 0.92, 1.0)]
        stations = []
        for x in xs:
            q = max(0.0, (x - (x1 - tip_zone)) / tip_zone) if name_tip else 0.0
            if self.tip == 'round':
                s = math.sqrt(max(0.0, 1 - q * q))
                s = max(0.22, s)
                le_l = le - (1 - s) * chord * 0.45
                te_l = le - chord + (1 - s) * chord * 0.55
            elif self.tip == 'raked':
                le_l = le - (q ** 2) * chord * 0.08
                te_l = le - chord + q * chord * 0.35
            else:
                s = 1 - 0.15 * q ** 3
                le_l = le - (1 - s) * chord * 0.3
                te_l = le - chord + (1 - s) * chord * 0.7
            stations.append((x, le_l, te_l))
        rings, ruv, rmat = [], [], []
        sgn = 1 if side == 'R' else -1
        for x, le_l, te_l in stations:
            c_l = le_l - te_l
            ring, uvr = [], []
            pts = [(f, 'u') for f in fs] + [(f, 'l') for f in reversed(fs)]
            if f0 == 0.0:
                pts = pts[:-1]
            if f1 == 1.0:
                pts = pts[:nf] + pts[nf + 1:]
            for f, surf in pts:
                zu, zl = airfoil(f, thick)
                zz = (zu if surf == 'u' else zl) * c_l * (0.6 + 0.4 * c_l / chord)
                y = le_l - f * c_l
                z = z0 + x * math.tan(math.radians(dihedral)) + zz
                ring.append((sgn * x, y, z))
                fa = (le - y) / chord_ref
                if surf == 'u':
                    uvr.append((0.5 + sgn * x / span_ref, top_region + 0.5 * fa))
                else:
                    uvr.append((0.5 + sgn * x / span_ref, bot_region + 0.5 * fa))
            rings.append(ring)
            ruv.append(uvr)
            rmat.append([0 if s == 'u' else 1 for f, s in pts])
        n = len(rings[0])
        idx = [[mb.vert(p) for p in r] for r in rings]
        for i in range(len(rings) - 1):
            for j in range(n):
                j2 = (j + 1) % n
                m = 0 if (rmat[i][j] == 0 and rmat[i][j2] == 0) else 1
                # the upper->lower wrap faces use bottom material with bottom uvs
                q = [idx[i][j], idx[i + 1][j], idx[i + 1][j2], idx[i][j2]]
                quv = [ruv[i][j], ruv[i + 1][j], ruv[i + 1][j2], ruv[i][j2]]
                if side == 'L':
                    q = list(reversed(q))
                    quv = list(reversed(quv))
                mb.face(q, quv, m)
        # caps
        for k, rr in ((0, idx[0]), (len(idx) - 1, idx[-1])):
            cap = list(rr)
            cuv = list(ruv[k])
            if (k == 0) == (side == 'R'):
                cap.reverse()
                cuv.reverse()
            mb.face(cap, cuv, 1)

    def build_wing(self, parent, which, span, chord, le, z0, root_x, top_region, bot_region, ailerons):
        dih = self.g['dihedralDeg']
        half = span / 2
        span_ref = self.span
        chord_ref = self.chord
        a_start = half * 0.52
        objs = []
        for side in ('L', 'R'):
            mb = MB(['Livery_WingTop', 'Livery_WingBottom'])
            if ailerons:
                self.wing_half(mb, side, root_x, a_start, le, chord, z0, dih, span_ref, chord_ref, top_region, bot_region, name_tip=False)
                self.wing_half(mb, side, a_start, half, le, chord, z0, dih, span_ref, chord_ref, top_region, bot_region, cut=(0.0, 0.74))
            else:
                self.wing_half(mb, side, root_x, half, le, chord, z0, dih, span_ref, chord_ref, top_region, bot_region)
            objs.append(mb.build(f'Wing_{which}_{side}', parent, smooth=True, sharp_angle=60, recalc=True))
            if ailerons:
                am = MB(['Livery_WingTop', 'Livery_WingBottom'])
                self.wing_half(am, side, a_start + 0.01, half, le, chord, z0, dih, span_ref, chord_ref, top_region, bot_region, cut=(0.74, 1.0))
                sgn = 1 if side == 'R' else -1
                hx = (a_start + half) / 2
                hinge = (sgn * hx, le - 0.74 * chord, z0 + hx * math.tan(math.radians(dih)))
                objs.append(am.build(f'Aileron_{side}', parent, origin=hinge, smooth=True, sharp_angle=60, recalc=True))
        return objs

    def wing_z(self):
        """Return dict of wing root z's and LEs by name."""
        yl = self.lowerLE - self.lchord * 0.5
        yu = self.upperLE - self.chord * 0.5
        W = {}
        if self.layout == 'monoplane':
            W['Main'] = (self.fuselage_top(yu) - 0.12, self.upperLE, self.chord, self.span)
        elif self.layout == 'parasol':
            W['Main'] = (self.fuselage_top(yu) + self.g['gap'], self.upperLE, self.chord, self.span)
        elif self.layout == 'triplane':
            zl = self.fuselage_bot(yl) + 0.06
            gap = self.g['gap']
            W['Lower'] = (zl, self.lowerLE, self.lchord, self.g['lowerSpan'])
            W['Middle'] = (zl + gap, self.midLE, self.chord, self.g['middleSpan'])
            W['Upper'] = (zl + 2 * gap, self.upperLE, self.chord, self.span)
        else:
            zl = self.fuselage_bot(yl) + 0.06
            if self.pusher:
                zl = self.fuselage_bot(yl) + 0.02
            if self.id in LOWER_WING_BELOW:
                zl = self.fuselage_bot(yl) - 0.28
            gap = self.g['gap']
            W['Lower'] = (zl, self.lowerLE, self.lchord, self.g['lowerSpan'])
            W['Upper'] = (zl + gap, self.upperLE, self.chord, self.span)
        return W

    def build_wings(self, parent):
        W = self.wing_z()
        self.wings = W
        names = list(W.keys())
        # top-most wing top surface & bottom-most wing bottom surface get the primary regions
        topmost = names[-1]
        botmost = names[0]
        objs = []
        for n in names:
            z0, le, ch, sp = W[n]
            if sp <= 0:
                continue
            if n in ('Upper', 'Main'):
                root = 0.0
            elif n == 'Middle':
                root = self.fuselage_halfw(le - ch * 0.4) * 0.92
            else:
                root = 0.0 if self.id in LOWER_WING_BELOW or self.pusher else self.fuselage_halfw(le - ch * 0.4) * 0.92
            ail = n in ('Upper', 'Main') and self.id != 'fokker_eiii'
            objs += self.build_wing(parent, n, sp, ch, le, z0, root,
                                    0.0 if n == topmost else 0.5, 0.0 if n == botmost else 0.5, ail)
        self.meta['uv_span_ref'] = self.span
        self.meta['uv_chord_ref'] = self.chord
        self.meta['uv_top_wing_chord'] = W[topmost][2]
        self.meta['uv_bottom_wing_chord'] = W[botmost][2]
        self.meta['uv_bottom_wing_span'] = W[botmost][3]
        return objs

    # ------------------------------------------------------------ struts
    def wing_surface_z(self, name, x, y):
        z0, le, ch, sp = self.wings[name]
        f = max(0.0, min(1.0, (le - y) / ch))
        zu, zl = airfoil(f, self.thick)
        dz = abs(x) * math.tan(math.radians(self.g['dihedralDeg']))
        return z0 + dz + zu * ch * 0.8, z0 + dz + zl * ch * 0.8

    def build_struts(self, parent):
        mb = MB(['Wood', 'Metal'])
        wm = MB(['Metal'])
        W = self.wings
        lay = self.layout
        fs, rs = 0.18, 0.68  # spar chord fractions

        def spar_y(name, f):
            z0, le, ch, sp = W[name]
            return le - f * ch

        # Cabane struts: fuselage top -> upper wing centre
        top_name = 'Upper' if 'Upper' in W else 'Main'
        if lay in ('biplane', 'sesquiplane', 'triplane', 'parasol') and not self.pusher:
            for f in (fs, rs):
                yu = spar_y(top_name, f)
                zt = self.fuselage_top(yu) - 0.03
                hw = self.fuselage_halfw(yu) * 0.8
                zu = self.wing_surface_z(top_name, 0.35, yu)[1]
                for s in (-1, 1):
                    xw = 0.32 if lay != 'parasol' else 0.55
                    strut(mb, (s * hw, yu - 0.05, zt), (s * xw, yu, zu + 0.01), chord=0.05, thick=0.02, mat=1 if lay != 'parasol' else 0)
                if self.layout != 'parasol':
                    # cross-bracing wires in the cabane
                    pass
        if lay == 'parasol':
            # N-struts from lower longerons to wing
            for f in (fs, rs):
                yu = spar_y('Main', f)
                zb = self.fuselage_bot(yu) + 0.08
                hw = self.fuselage_halfw(yu)
                zu = self.wing_surface_z('Main', 1.25, yu)[1]
                for s in (-1, 1):
                    strut(mb, (s * hw, yu, zb), (s * 1.25, yu, zu), chord=0.06, thick=0.022, mat=1)
        if lay == 'monoplane':
            # pyramid pylon above cockpit + wires to wings (Eindecker)
            yp = self.upperLE - self.chord * 0.3
            zt = self.fuselage_top(yp)
            apex = (0, yp, zt + 0.65)
            for s in (-1, 1):
                for dy in (0.25, -0.25):
                    strut(mb, (s * 0.2, yp + dy, zt - 0.02), apex, chord=0.035, thick=0.02, mat=1)
            z0, le, ch, sp = W['Main']
            under = (0, yp, self.fuselage_bot(yp) - 0.45)
            for s in (-1, 1):
                for fx in (0.45, 0.8):
                    for f in (fs, rs):
                        y = spar_y('Main', f)
                        zu, zl = self.wing_surface_z('Main', sp / 2 * fx, y)
                        tube(wm, [apex, (s * sp / 2 * fx, y, zu)], radius=0.0045, sides=3)
                        tube(wm, [under, (s * sp / 2 * fx, y, zl)], radius=0.0045, sides=3)
        # Interplane struts
        if lay in ('biplane', 'sesquiplane', 'triplane'):
            lower = 'Lower'
            upper = 'Upper'
            lsp = W[lower][3] / 2
            stations = [0.82]
            if self.id in TWO_BAY:
                stations = [0.45, 0.85]
            if lay == 'triplane':
                stations = [0.84 if self.id == 'fokker_dri' else 0.8]
            for s in (-1, 1):
                for st in stations:
                    x = lsp * st
                    if lay == 'sesquiplane':
                        # V-strut: single lower spar point to upper front/rear spars
                        yl = spar_y(lower, 0.35)
                        zl = self.wing_surface_z(lower, x, yl)[0]
                        for f in (fs, rs):
                            yu = spar_y(upper, f)
                            zu = self.wing_surface_z(upper, x + 0.15, yu)[1]
                            strut(mb, (s * x, yl, zl), (s * (x + 0.15), yu, zu), chord=0.07, thick=0.025, mat=0)
                    elif lay == 'triplane':
                        f = 0.4
                        yl = spar_y(lower, f)
                        yu = spar_y(upper, f)
                        zl = self.wing_surface_z(lower, x, yl)[0]
                        zu = self.wing_surface_z(upper, x, yu)[1]
                        wide = 0.26 if self.id == 'fokker_dri' else 0.3
                        strut(mb, (s * x, yl, zl), (s * x, yu, zu), chord=wide, thick=0.03, mat=0)
                    else:
                        pts = []
                        for f in (fs, rs):
                            yl = spar_y(lower, f)
                            yu = spar_y(upper, f)
                            zl = self.wing_surface_z(lower, x, yl)[0]
                            zu = self.wing_surface_z(upper, x, yu)[1]
                            strut(mb, (s * x, yl, zl), (s * x, yu, zu), chord=0.075, thick=0.026, mat=0)
                            pts.append(((s * x, yl, zl), (s * x, yu, zu)))
                        if self.id in N_STRUTS:
                            strut(mb, pts[0][1], pts[1][0], chord=0.06, thick=0.024, mat=0)
                        if self.id in INTERMEDIATE_STRUTS:
                            xi = x * 0.5
                            for f in (fs, rs):
                                yl = spar_y(lower, f)
                                yu = spar_y(upper, f)
                                zl = self.wing_surface_z(lower, xi, yl)[0]
                                zu = self.wing_surface_z(upper, xi, yu)[1]
                                strut(mb, (s * xi, yl, zl), (s * xi, yu, zu), chord=0.035, thick=0.015, mat=0)
            # Rigging wires (flying + landing wires, crossing in the bay)
            if self.id not in NO_WIRES:
                for s in (-1, 1):
                    inner_x = self.fuselage_halfw(spar_y(lower, 0.3)) if not self.pusher else 0.6
                    xs = [inner_x] + [lsp * st for st in stations]
                    for f in (fs + 0.02, rs - 0.02):
                        yl = spar_y(lower, f)
                        yu = spar_y(upper, f)
                        for a, b in zip(xs[:-1], xs[1:]):
                            la = (s * a, yl, self.wing_surface_z(lower, a, yl)[0])
                            ub = (s * b, yu, self.wing_surface_z(upper, b, yu)[1])
                            ua = (s * max(a, 0.35), yu, self.wing_surface_z(upper, max(a, 0.35), yu)[1])
                            lb = (s * b, yl, self.wing_surface_z(lower, b, yl)[0])
                            tube(wm, [la, ub], radius=0.004, sides=3)
                            tube(wm, [ua, lb], radius=0.004, sides=3)
        # Pusher tail booms
        if self.pusher:
            tail_y = self.postY
            for s in (-1, 1):
                for name in ('Upper', 'Lower'):
                    y = spar_y(name, rs)
                    x = 1.2
                    zu, zl = self.wing_surface_z(name, x, y)
                    z = zl if name == 'Upper' else zu
                    strut(mb, (s * x, y, z), (s * 0.25, tail_y + 0.2, 0.25 if name == 'Upper' else 0.02), chord=0.04, thick=0.03, mat=1)
                # interplane struts near the booms
                for f in (fs, rs):
                    y1 = spar_y('Lower', f)
                    y2 = spar_y('Upper', f)
                    strut(mb, (s * 1.2, y1, self.wing_surface_z('Lower', 1.2, y1)[0]), (s * 1.2, y2, self.wing_surface_z('Upper', 1.2, y2)[1]), chord=0.06, thick=0.022, mat=0)
            # boom cross struts
            strut(mb, (-0.25, tail_y + 0.2, 0.25), (0.25, tail_y + 0.2, 0.25), chord=0.03, thick=0.02, mat=1)
        if self.id in LOWER_WING_BELOW:
            # Bristol: lower wing hangs below fuselage on short struts
            for f in (fs, rs):
                y = spar_y('Lower', f)
                zb = self.fuselage_bot(y)
                zl = self.wing_surface_z('Lower', 0.35, y)[0]
                for s in (-1, 1):
                    strut(mb, (s * 0.35, y, zb + 0.02), (s * 0.35, y, zl), chord=0.05, thick=0.02, mat=1)
        objs = [mb.build('Struts', parent, smooth=False)]
        if wm.f:
            objs.append(wm.build('Wires', parent, smooth=False))
        return objs

    # ------------------------------------------------------------ tail
    def tail_outlines(self):
        ts = self.g['tailShape']
        hs = self.tailSpan / 2
        hinge = self.postY
        stabLE = hinge + self.stabChord
        eTE = hinge - self.elevChord
        n = 8
        # Horizontal stabiliser (right half outline in x,y from root LE -> tip -> root hinge)
        if ts == 'triangular' or ts == 'comma':
            stab = [(0, stabLE)] + [(hs * 0.92 * k / n, stabLE - (stabLE - hinge) * (k / n) ** 1.3) for k in range(1, n + 1)] + [(0, hinge)]
            stab = [(0, stabLE), (hs * 0.92, hinge + 0.04), (hs * 0.92, hinge), (0, hinge)]
            if ts == 'comma':
                stab = [(0, stabLE)] + [(hs * 0.88 * math.sin(math.pi / 2 * k / n), stabLE - (stabLE - hinge) * (1 - math.cos(math.pi / 2 * k / n))) for k in range(1, n + 1)] + [(0, hinge)]
        elif ts == 'squared':
            stab = [(0, stabLE), (hs * 0.8, stabLE - 0.06), (hs * 0.95, hinge + 0.12), (hs * 0.95, hinge), (0, hinge)]
        else:  # rounded
            stab = [(0, stabLE)] + [(hs * 0.95 * math.sin(math.pi / 2 * k / n), hinge + (stabLE - hinge) * math.cos(math.pi / 2 * k / n)) for k in range(1, n + 1)] + [(0, hinge)]
        # Elevator (full span, both halves), with a cut-out for the rudder
        ec = 0.07
        if ts == 'squared':
            half_e = [(hs * 0.95, hinge), (hs * 0.95, eTE + 0.1), (hs * 0.85, eTE)]
        else:
            half_e = [(hs * 0.95 * math.cos(math.pi / 2 * k / n * 0.9), hinge - self.elevChord * math.sin(math.pi / 2 * k / n)) for k in range(0, n + 1)]
            half_e[0] = (hs * 0.95, hinge)
        elev = [(ec, hinge)] + half_e + [(ec, eTE)]
        elev_full = elev + [(-x, y) for x, y in reversed(elev)]
        return stab, elev_full, stabLE, eTE

    def build_tail(self, parent):
        stab, elev, stabLE, eTE = self.tail_outlines()
        hinge = self.postY
        zt = self.fuselage_top(hinge) - 0.02 if not self.pusher else 0.25
        tail_chord = stabLE - eTE
        hs = self.tailSpan / 2
        uvh = lambda p: (0.5 + p[0] / self.tailSpan, 0.5 + 0.5 * (stabLE - p[1]) / tail_chord)
        objs = []
        for side in (1, -1):
            mb = MB(['Livery_Tail'])
            outline = [(side * x, y, zt) for x, y in stab]
            if side < 0:
                outline.reverse()
            plate(mb, outline, 'z', 0.035, uvh)
            objs.append(mb.build(f'Stabilizer_{"R" if side > 0 else "L"}', parent, smooth=False, recalc=True))
        em = MB(['Livery_Tail'])
        plate(em, [(x, y, zt) for x, y in elev], 'z', 0.03, uvh)
        objs.append(em.build('Elevator', parent, origin=(0, hinge, zt), smooth=False, recalc=True))
        # Vertical: fin + rudder in (y, z)
        ts = self.g['tailShape']
        rc = self.rudderChord
        rh = max(0.75, min(1.25, 0.1 * self.span + (0.1 if self.two else 0.0)))
        zb = self.fuselage_bot(hinge) if not self.pusher else -0.15
        ztop = zt + rh * 0.95
        rud = []
        n = 10
        if ts == 'comma':
            # Fokker comma: no fin, balanced rounded rudder
            cx, cz, r = hinge - rc * 0.35, zt + rh * 0.55, rh * 0.48
            rud = [(hinge + 0.02, zb + 0.05)]
            for k in range(n + 1):
                a = -math.pi * 0.35 + math.pi * 1.5 * k / n
                rud.append((cx - math.cos(a) * rc * 0.9 * (0.9 if a < math.pi / 2 else 1.25), cz + math.sin(a) * r))
            rud = [(hinge + 0.02, zb + 0.05), (hinge - rc * 0.9, zb + 0.1), (hinge - rc * 1.0, zt + rh * 0.35)] + \
                  [(hinge - rc * 0.45 + math.cos(math.pi * k / n) * -rc * 0.55, zt + rh * 0.55 + math.sin(math.pi * k / n) * rh * 0.42) for k in range(n + 1)] + \
                  [(hinge + 0.12, zt + rh * 0.5), (hinge + 0.05, zt)]
            fin = None
        else:
            if ts == 'triangular':
                rud = [(hinge, zb + 0.05), (hinge - rc * 0.8, zb + 0.12)] + [(hinge - rc * 0.55 - rc * 0.45 * math.cos(math.pi / 2 * k / n), zt + (rh * 0.9) * math.sin(math.pi / 2 * k / n)) for k in range(n + 1)] + [(hinge + 0.08, zt + rh * 0.95), (hinge, zt + rh * 0.5)]
                fin = [(hinge, zt), (hinge + 0.55, zt), (hinge, zt + rh * 0.5)]
            elif ts == 'squared':
                rud = [(hinge, zb + 0.02), (hinge - rc, zb + 0.08), (hinge - rc, zt + rh * 0.75), (hinge - rc * 0.8, ztop), (hinge, ztop)]
                fin = [(hinge, zt), (hinge + 0.9, zt), (hinge + 0.25, zt + rh * 0.55), (hinge, ztop - 0.02)]
            else:
                rud = [(hinge, zb + 0.03), (hinge - rc * 0.85, zb + 0.08)] + [(hinge - rc * math.cos(math.pi / 2 * k / n) * 0.95, zt + rh * 0.35 + (ztop - zt - rh * 0.35) * math.sin(math.pi / 2 * k / n)) for k in range(n + 1)] + [(hinge, ztop)]
                fl = 0.55 + 0.05 * self.span / 8
                fin = [(hinge, zt), (hinge + fl, zt)] + [(hinge + fl * math.cos(math.pi / 2 * k / 6), zt + (ztop - zt) * 0.97 * math.sin(math.pi / 2 * k / 6) ** 0.8) for k in range(1, 7)]
        zs = [p[1] for p in rud] + ([p[1] for p in fin] if fin else [])
        zmin, zmax = min(zs), max(zs)
        fin_front = max(p[0] for p in fin) if fin else hinge
        rud_back = min(p[0] for p in rud)
        rud_front = max(p[0] for p in rud)
        vh = lambda z: 0.5 * (zmax - z) / (zmax - zmin)
        if fin:
            fm = MB(['Livery_Tail'])
            plate(fm, [(0, y, z) for y, z in fin], 'x', 0.035, lambda p: (0.4 * (fin_front - p[1]) / max(0.01, fin_front - hinge), vh(p[2])))
            objs.append(fm.build('Fin', parent, smooth=False, recalc=True))
        rm = MB(['Livery_Tail'])
        plate(rm, [(0, y, z) for y, z in rud], 'x', 0.035, lambda p: (0.4 + 0.6 * (rud_front - p[1]) / max(0.01, rud_front - rud_back), vh(p[2])))
        objs.append(rm.build('Rudder', parent, origin=(0, hinge, zt), smooth=False, recalc=True))
        self.meta.update({
            'uv_tail_span': self.tailSpan, 'uv_tail_chord': tail_chord,
            'uv_rudder_chord': rud_front - rud_back, 'uv_fin_chord': (fin_front - hinge) if fin else 0.0,
            'uv_vtail_height': zmax - zmin,
        })
        self.skid_y = hinge + 0.15
        self.skid_ztop = self.fuselage_bot(hinge + 0.15) if not self.pusher else -0.1
        return objs

    # ------------------------------------------------------------ engine / prop
    def build_engine(self, parent, prop):
        objs = []
        if self.pusher:
            # rotary at the back of the nacelle
            y = self.nacelleEnd - 0.05
            mb = MB(['Metal'])
            cylinder(mb, (0, y, 0.05), (0, 1, 0), 0.14, 0.2, sides=12)
            for k in range(9):
                a = TAU * k / 9
                cylinder(mb, (math.sin(a) * 0.26, y, 0.05 + math.cos(a) * 0.26), (math.sin(a), 0, math.cos(a)), 0.06, 0.26, sides=8)
            objs.append(mb.build('RotaryEngine', prop, smooth=True, sharp_angle=40))
            return objs
        if self.rotary:
            R = self.Rc
            y0 = self.noseY - 0.02
            cl = self.cowlLen
            mb = MB(['Livery_Cowling'])
            rings, uvs = [], []
            prof = [(y0, R * 0.7), (y0 + 0.01, R * 0.82), (y0 - 0.03, R * 0.95), (y0 - 0.12, R), (y0 - cl * 0.6, R * 1.0), (y0 - cl, R * 0.98)]
            N = 24
            zc = 0.0
            for (y, r) in prof:
                rings.append([(r * math.sin(TAU * j / N), y, zc + r * math.cos(TAU * j / N)) for j in range(N)])
                uvs.append([(j / N, (y0 - y) / cl) for j in range(N + 1)])
            loft(mb, rings, closed=True, uvs=uvs)
            objs.append(mb.build('Cowling', parent, smooth=True, sharp_angle=50))
            # inner dark engine face + rotating cylinders
            em = MB(['Metal'])
            cylinder(em, (0, y0 - 0.2, 0), (0, 1, 0), 0.13, 0.22, sides=12)
            for k in range(9):
                a = TAU * k / 9
                cylinder(em, (math.sin(a) * (0.13 + R * 0.28), y0 - 0.18, math.cos(a) * (0.13 + R * 0.28)), (math.sin(a), 0, math.cos(a)), 0.055, R * 0.56, sides=8)
            objs.append(em.build('RotaryEngine', prop, smooth=True, sharp_angle=40))
            # back plate so you can't see into the fuselage
            bp = MB(['Metal'])
            cylinder(bp, (0, y0 - cl + 0.03, 0), (0, 1, 0), R * 0.96, 0.02, sides=16)
            objs.append(bp.build('Firewall', parent, smooth=False))
        else:
            mb = MB(['Metal', 'Livery_Cowling'])
            y0 = self.noseY
            rad = RADIATOR_FRONT.get(self.id)
            w, top, bot, _, _ = self.profile(0.0)
            if rad == 'box':
                box(mb, (0, y0 + 0.01, (top + bot) / 2), (w * 1.9, 0.06, (top - bot) * 0.92), mat=0)
            elif rad == 'round':
                cylinder(mb, (0, y0 + 0.01, 0), (0, 1, 0), max(self.W, self.H) * 0.47, 0.05, sides=20, mat=0)
            if self.id in EXPOSED_HEADS:
                for k in range(6):
                    y = y0 - 0.15 - k * 0.14
                    box(mb, (0.0, y, self.fuselage_top(y) + 0.05), (0.13, 0.11, 0.12), mat=0)
                # exhaust manifold (right side)
                yy = [y0 - 0.1 - k * 0.14 for k in range(6)]
                pts = [(self.fuselage_halfw(y) + 0.07, y, self.fuselage_top(y) - 0.05) for y in yy]
                tube(mb, pts + [(pts[-1][0] + 0.05, pts[-1][1] - 0.25, pts[-1][2] + 0.15)], radius=0.035, sides=6)
            else:
                # exhaust stubs both sides
                for s in (-1, 1):
                    for k in range(4 if self.id != 'spad_xiii' else 1):
                        y = y0 - 0.2 - k * 0.13
                        x = s * (self.fuselage_halfw(y) + 0.02)
                        z = (self.fuselage_top(y) + self.fuselage_bot(y)) / 2
                        cylinder(mb, (x, y, z), (s * 0.3, -1, -0.4), 0.025, 0.25 if self.id != 'spad_xiii' else 0.8, sides=6)
            if self.id == 're8':
                for s in (-1, 1):
                    tube(mb, [(s * 0.3, y0 - 0.3, self.fuselage_top(y0 - 0.3)), (s * 0.35, y0 - 0.5, self.fuselage_top(y0) + 1.3)], radius=0.05, sides=6)
            if self.id in WING_RADIATOR and 'Upper' in self.wings:
                z0, le, ch, sp = self.wings['Upper']
                box(mb, (0.3, le - ch * 0.35, z0 + 0.02), (0.55, 0.45, 0.07), mat=0)
            if mb.f:
                objs.append(mb.build('Engine', parent, smooth=False))
        return objs

    def build_propeller(self, parent):
        R = 1.3 if not self.two else 1.45
        if self.id in ('fokker_eiii', 'nieuport_11', 'sopwith_pup'):
            R = 1.25
        if self.pusher:
            hub = (0, self.nacelleEnd - 0.25, 0.05)
            direction = -1
        else:
            hub = (0, self.noseY + 0.12, 0.0)
            direction = 1
        prop = empty('Propeller', hub, parent)
        mb = MB(['Wood', 'Metal', 'Livery_Accent'])
        for blade in (1, -1):
            rings = []
            n = 9
            for i in range(n + 1):
                q = i / n
                r = 0.08 + (R - 0.08) * q
                c = (0.06 + 0.16 * math.sin(math.pi * min(1, q * 1.15) * 0.85)) * (1 - 0.6 * q ** 6)
                t = 0.045 * (1 - q) + 0.012
                beta = math.atan2(2.3, TAU * max(r, 0.15))
                sec = [(0.5, 0), (0.2, 0.5), (-0.3, 0.45), (-0.5, 0), (-0.3, -0.35), (0.2, -0.3)]
                ring = []
                for a, b in sec:
                    ca, cb = a * c, b * t
                    # rotate section by pitch angle: chord in the (x, y) plane
                    x = ca * math.cos(beta) * direction
                    y = ca * math.sin(beta) + cb * math.cos(beta)
                    y += 0
                    ring.append((x * blade, y, blade * r))
                rings.append(ring)
            loft(mb, rings, closed=True, mats=lambda i, j: 0, cap_end=True)
        cylinder(mb, (0, 0, 0), (0, 1, 0), 0.08, 0.18, sides=10, mat=1)
        if self.id in SPINNER:
            rings = []
            for k in range(6):
                q = k / 5
                r = 0.21 * math.sqrt(max(0.0, 1 - q * q)) + 0.001
                rings.append([(r * math.sin(TAU * j / 12), -0.08 + q * 0.32, r * math.cos(TAU * j / 12)) for j in range(12)])
            loft(mb, rings, closed=True, mats=lambda i, j: 2, cap_start=True)
        verts = [(x + hub[0], y + hub[1], z + hub[2]) for x, y, z in mb.v]
        mb.v = verts
        mb.build('PropBlades', prop, smooth=True, sharp_angle=50)
        self.meta['prop_radius'] = R
        self.meta['prop_hub'] = [hub[0], hub[2], -hub[1]]
        return prop

    # ------------------------------------------------------------ gear
    def build_gear(self, parent):
        mb = MB(['Metal', 'Wood'])
        wh = MB(['Rubber', 'Livery_Accent'])
        r = 0.33 if not self.two else 0.38
        track = self.g['wheelTrack']
        axleY = self.lowerLE + 0.25 if not self.pusher else self.upperLE - 0.1
        yb = self.fuselage_bot(axleY)
        gearH = 0.62 if not self.two else 0.78
        if self.id in LOWER_WING_BELOW:
            gearH = 0.85
        axleZ = yb - gearH
        hw = self.fuselage_halfw(axleY) * 0.8 if not self.pusher else 0.25
        ax = track / 2
        for s in (-1, 1):
            strut(mb, (s * hw, axleY + 0.45, yb + 0.03), (s * ax * 0.55, axleY, axleZ + 0.02), chord=0.05, thick=0.03, mat=0)
            strut(mb, (s * hw, axleY - 0.45, yb + 0.03), (s * ax * 0.55, axleY, axleZ + 0.02), chord=0.05, thick=0.03, mat=0)
            # wheel
            cx = s * ax
            N = 16
            rings = []
            for k, (dx, rr) in enumerate(((-0.065, r * 0.55), (-0.065, r * 0.88), (-0.05, r), (0.05, r), (0.065, r * 0.88), (0.065, r * 0.55))):
                rings.append([(cx + dx, axleY + rr * math.sin(TAU * j / N), axleZ + rr * math.cos(TAU * j / N)) for j in range(N)])
            loft(wh, rings, closed=True, mats=lambda i, j: 0)
            for dx in (-0.066, 0.066):
                c = wh.vert((cx + dx * 1.08, axleY, axleZ))
                ring = [wh.vert((cx + dx, axleY + r * 0.56 * math.sin(TAU * j / N), axleZ + r * 0.56 * math.cos(TAU * j / N))) for j in range(N)]
                for j in range(N):
                    wh.face([c, ring[j], ring[(j + 1) % N]], None, 1)
        cylinder(mb, (0, axleY, axleZ), (1, 0, 0), 0.025, track, sides=6)
        if self.id in AXLE_WING:
            box(mb, (0, axleY - 0.1, axleZ), (track * 0.85, 0.42, 0.06), mat=1)
        # tail skid
        skidY = self.skid_y
        ground_angle = math.radians(11)
        wheel_bottom = axleZ - r
        skid_bottom = wheel_bottom + (axleY - skidY) * math.tan(ground_angle)
        top = self.skid_ztop
        if skid_bottom > top - 0.08:
            skid_bottom = top - 0.08
        strut(mb, (0, skidY + 0.25, top + 0.02), (0, skidY - 0.1, skid_bottom), chord=0.05, thick=0.03, mat=1)
        if self.id == 'fokker_dri' and 'Lower' in self.wings:
            z0, le, ch, sp = self.wings['Lower']
            for s in (-1, 1):
                x = sp / 2 * 0.93
                tube(mb, [(s * x, le - 0.1, z0 - 0.02), (s * x, le - 0.35, z0 - 0.22), (s * x, le - 0.7, z0 - 0.03)], radius=0.018, sides=5)
        objs = [mb.build('Undercarriage', parent, smooth=False), wh.build('Wheels', parent, smooth=True, sharp_angle=50)]
        self.contacts = {
            'Contact_WheelL': (-ax, axleY, wheel_bottom),
            'Contact_WheelR': (ax, axleY, wheel_bottom),
            'Contact_Skid': (0, skidY - 0.1, skid_bottom),
        }
        return objs

    # ------------------------------------------------------------ guns
    def gun_mesh(self, mb, gtype, muzzle, length, mat=0, drum=False):
        mx, my, mz = muzzle
        if gtype in ('vickers', 'spandau'):
            cylinder(mb, (mx, my - length * 0.35, mz), (0, 1, 0), 0.045, length * 0.7, sides=8, mat=mat)
            box(mb, (mx, my - length * 0.83, mz - 0.01), (0.075, length * 0.3, 0.095), mat=mat)
            cylinder(mb, (mx, my + 0.02, mz), (0, 1, 0), 0.02, 0.06, sides=6, mat=mat)
        else:  # lewis / parabellum
            cylinder(mb, (mx, my - length * 0.3, mz), (0, 1, 0), 0.05 if gtype == 'lewis' else 0.035, length * 0.55, sides=8, mat=mat)
            cylinder(mb, (mx, my - length * 0.05, mz), (0, 1, 0), 0.015, length * 0.12, sides=6, mat=mat)
            box(mb, (mx, my - length * 0.72, mz), (0.06, length * 0.35, 0.09), mat=mat)
            if drum or gtype == 'lewis':
                cylinder(mb, (mx, my - length * 0.62, mz + 0.07), (0, 0, 1), 0.12, 0.05, sides=12, mat=mat)
            box(mb, (mx, my - length * 1.0, mz - 0.05), (0.04, 0.2, 0.12), mat=mat)

    def build_guns(self, parent, cockpit):
        mb = MB(['Metal'])
        flex = None
        for i, gm in enumerate(self.spec['guns']):
            bx, by, bz = gm['position']
            mount = gm['mount']
            gt = gm['type']
            if mount == 'fixed-synchronized':
                muzzle_y = min(-bz, (self.noseY - (0.3 if self.rotary else 0.2)))
                if self.rotary:
                    muzzle_y = min(muzzle_y, self.noseY - self.cowlLen + 0.02)
                x = bx
                if len([g for g in self.spec['guns'] if g['mount'] == 'fixed-synchronized']) == 1 and abs(bx) < 1e-3:
                    x = -0.12 if self.id in ('se5a',) else 0.0
                    if self.id in ('spad_vii', 'nieuport_17', 'sopwith_pup', 'sopwith_triplane', 'halberstadt_clii', 'rumpler_civ', 'bristol_f2b', 're8', 'dh4', 'fokker_eiii'):
                        x = 0.0 if self.id not in ('nieuport_17', 'sopwith_triplane') else 0.05
                length = max(1.0, muzzle_y - (self.cpY + 0.45))
                z = self.fuselage_top(muzzle_y - 0.3) + 0.06
                if self.id in HUMP:
                    z = self.fuselage_top(muzzle_y - 0.5) - 0.02
                if self.id in ('bristol_f2b', 'dh4', 're8', 'rumpler_civ', 'halberstadt_clii') and abs(x) < 0.01:
                    x = 0.0
                muzzle = (x, muzzle_y, z)
                self.gun_mesh(mb, gt, muzzle, min(1.15, length))
            elif mount == 'fixed-overwing':
                top_name = 'Upper' if 'Upper' in self.wings else 'Main'
                z0, le, ch, sp = self.wings[top_name]
                z = self.wing_surface_z(top_name, 0, le - ch * 0.3)[0] + 0.13
                muzzle = (0.0, le + 0.3, z)
                self.gun_mesh(mb, 'lewis', muzzle, 1.25, drum=True)
                if self.id == 'se5a':
                    # Foster mount rail curving down to the cockpit
                    pts = [(0.0, le - ch * 0.5 + 0.3 * (1 - math.cos(a)), z - 0.05 - 0.45 * math.sin(a)) for a in [k * 0.25 for k in range(6)]]
                    tube(mb, pts, radius=0.012, sides=4)
                else:
                    strut(mb, (0, le - 0.4, z - 0.12), (0, le - 0.4, z - 0.02), chord=0.06, thick=0.02)
            elif mount == 'fixed-pusher':
                y = self.noseY - 0.05
                muzzle = (0.0, y + 0.4, self.fuselage_top(y + 0.2) - 0.05 if False else self.profile(0.1)[1] - 0.05)
                self.gun_mesh(mb, 'lewis', muzzle, 1.2, drum=True)
            else:  # flexible
                ring_z = self.fuselage_top(self.gunY) + 0.04
                fm = MB(['Metal'])
                gy = self.gunY
                muzzle = (0.0, gy + 0.9, ring_z + 0.32)
                self.gun_mesh(fm, gt, muzzle, 1.1, drum=True)
                tube(fm, [(0, gy - 0.1, ring_z), (0, gy + 0.05, ring_z + 0.3)], radius=0.02, sides=4)
                # Scarff ring
                pts = [(0.43 * math.sin(TAU * k / 20), gy + 0.43 * math.cos(TAU * k / 20), ring_z) for k in range(20)]
                tube(mb, pts, radius=0.025, sides=5, closed_path=True)
                flex = fm.build('Gun_Flexible', parent, origin=(0, gy, ring_z), smooth=False)
                self.muzzles.append((i, muzzle, 'Gun_Flexible'))
                continue
            self.muzzles.append((i, muzzle, None))
        objs = [mb.build('Guns', parent, smooth=True, sharp_angle=35)] if mb.f else []
        if flex:
            objs.append(flex)
        return objs

    # ------------------------------------------------------------ pilot & cockpit
    def build_crew(self, root):
        pilot = empty('Pilot', (0, 0, 0), root)
        top = self.fuselage_top(self.cpY)
        ez = top + 0.3
        ey = self.cpY - 0.06
        # Keep the eye below the top wing when the pilot sits under it (Bristol, Albatros...).
        for name in ('Upper', 'Main'):
            if name in self.wings:
                z0, le, ch, sp = self.wings[name]
                if z0 > top and le + 0.1 >= ey >= le - ch - 0.1:
                    under = self.wing_surface_z(name, 0.3, max(le - ch, min(le, ey)))[1]
                    ez = min(ez, under - 0.09)
        ez = max(ez, top + 0.14)
        self.eye = (0.0, ey, ez)
        self._figure(pilot, 'Pilot', (0, ey - 0.08, ez - 0.03), facing=1)
        if self.two:
            gtop = self.fuselage_top(self.gunY)
            g = empty('Gunner', (0, 0, 0), root)
            self._figure(g, 'Gunner', (0, self.gunY - 0.05, gtop + 0.27), facing=1)
        return pilot

    def _figure(self, parent, name, head, facing=1):
        mb = MB(['Pilot', 'Skin', 'Glass', 'Cloth'])
        hx, hy, hz = head
        ellipsoid(mb, (hx, hy, hz), (0.1, 0.115, 0.12), mat=0)
        ellipsoid(mb, (hx, hy + 0.075 * facing, hz - 0.03), (0.075, 0.05, 0.07), mat=1)
        for s in (-1, 1):
            cylinder(mb, (hx + s * 0.042, hy + 0.115 * facing, hz + 0.01), (0, 1, 0), 0.028, 0.03, sides=8, mat=2)
        tube(mb, [(hx + 0.1 * math.sin(a), hy + 0.1 * math.cos(a), hz + 0.02) for a in [k * TAU / 12 for k in range(12)]], radius=0.008, sides=3, closed_path=True, mat=0)
        ellipsoid(mb, (hx, hy - 0.02, hz - 0.3), (0.21, 0.14, 0.17), mat=0)
        tube(mb, [(hx + 0.075 * math.sin(a), hy + 0.075 * math.cos(a), hz - 0.15) for a in [k * TAU / 10 for k in range(10)]], radius=0.03, sides=5, closed_path=True, mat=3)
        mb.build(name + '_Figure', parent, smooth=True)

    def build_cockpit(self, root):
        ck = empty('Cockpit', (0, 0, 0), root)
        mb = MB(['Wood', 'Leather', 'Metal'])
        cy = self.cpY
        top = self.fuselage_top(cy)
        bot = self.fuselage_bot(cy)
        hw = self.fuselage_halfw(cy)
        panelY = cy + 0.3
        ptop = self.fuselage_top(panelY) - 0.03
        phw = self.fuselage_halfw(panelY) * 0.92
        pbot = self.fuselage_bot(panelY) + 0.1
        box(mb, (0, panelY, (ptop + pbot) / 2), (phw * 1.8, 0.02, ptop - pbot), mat=0)  # panel + bulkhead
        box(mb, (0, cy, bot + 0.12), (hw * 1.6, 1.1, 0.02), mat=0)  # floor
        box(mb, (0, cy - 0.3, bot + 0.3), (0.42, 0.35, 0.05), mat=1)  # seat
        box(mb, (0, cy - 0.47, bot + 0.52), (0.42, 0.05, 0.45), mat=1)  # seat back
        tube(mb, [(0, cy + 0.08, bot + 0.14), (0, cy + 0.12, top - 0.28)], radius=0.015, sides=5, mat=2)  # stick
        cylinder(mb, (0, cy + 0.12, top - 0.26), (0, 0, 1), 0.025, 0.08, sides=6, mat=1)
        box(mb, (0, cy + 0.36, bot + 0.18), (0.55, 0.05, 0.04), mat=2)  # rudder bar
        mb.build('CockpitInterior', ck, smooth=False)
        gm = MB(['Gauge'])
        gz = ptop - 0.14
        rpm_unit = 0.045
        gauges = [('Gauge_RPM', -0.14, gz, 0.05), ('Gauge_Speed', 0.14, gz, 0.045), ('Gauge_Alt', 0.0, gz - 0.02, 0.045),
                  ('Gauge_Compass', 0.0, gz - 0.13, 0.04), ('Gauge_Fuel', -0.2, gz - 0.12, 0.03)]
        for name, x, z, r in gauges:
            if abs(x) + r > phw:
                x = math.copysign(phw - r - 0.01, x)
            g = MB(['Gauge'])
            N = 20
            c = g.vert((x, panelY - 0.013, z))
            ring = [g.vert((x + r * math.sin(TAU * j / N), panelY - 0.013, z + r * math.cos(TAU * j / N))) for j in range(N)]
            for j in range(N):
                j2 = (j + 1) % N
                g.face([c, ring[j2], ring[j]], [(0.5, 0.5), (0.5 + 0.5 * math.sin(TAU * j2 / N), 0.5 - 0.5 * math.cos(TAU * j2 / N)), (0.5 + 0.5 * math.sin(TAU * j / N), 0.5 - 0.5 * math.cos(TAU * j / N))], 0)
            # bezel
            b = MB(['Metal'])
            tube(b, [(x + r * math.sin(TAU * j / 16), panelY - 0.012, z + r * math.cos(TAU * j / 16)) for j in range(16)], radius=0.006, sides=4, closed_path=True)
            b.build(name + '_Bezel', ck, smooth=True)
            g.build(name, ck, origin=(x, panelY - 0.013, z), smooth=False, recalc=False)
        return ck

    # ------------------------------------------------------------ assemble
    def build(self):
        root = empty(f'Aircraft_{self.id}', (0, 0, 0))
        ext = empty('Exterior', (0, 0, 0), root)
        self.build_fuselage(ext)
        self.build_coaming(ext)
        self.build_wings(ext)
        self.build_struts(ext)
        self.build_tail(ext)
        prop = self.build_propeller(ext)
        self.build_engine(ext, prop)
        self.build_gear(ext)
        self.build_guns(ext, None)
        self.build_crew(root)
        self.build_cockpit(root)
        empty('EyePoint', self.eye, root)
        for name, p in self.contacts.items():
            empty(name, p, root)
        for i, m, holder in self.muzzles:
            par = bpy.data.objects.get(holder) if holder else root
            empty(f'Muzzle_{i}', m, par)
        for k, v in self.meta.items():
            root[k] = v
        root['aircraft_id'] = self.id
        return root


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
