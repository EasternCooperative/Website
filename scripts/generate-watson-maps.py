"""Redraws the Watson facility map and per-room overlays as SVG (565x206 user units)."""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/maps'  # run from repo root
os.makedirs(OUT, exist_ok=True)
FACES = {}
for nm, f in (('reg', 'Roboto-Regular'), ('med', 'Roboto-Medium')):
    t = TTFont(f'/usr/share/fonts/TTF/{f}.ttf')
    FACES[nm] = (t, t.getGlyphSet(), t.getBestCmap(), t['hmtx'])
font = FACES['reg'][0]; upm = font['head'].unitsPerEm; CAP = font['OS/2'].sCapHeight
FACE = 'reg'

def text_width(s, size):
    _, _, cmap, hmtx = FACES[FACE]
    return sum(hmtx[cmap[ord(c)]][0] for c in s) * size / upm

def text_path(s, cx, cy, size, fill='#222', bg=False):
    """Outline of s centred on cx horizontally and cy on the cap-height midline."""
    _, gs, cmap, hmtx = FACES[FACE]
    sc = size / upm
    x0 = cx - text_width(s, size) / 2
    base = cy + CAP * sc / 2
    d = ''
    x = x0
    for ch in s:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
        # font y is up, svg y is down
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, x, base)))
        d += pen.getCommands()
        x += hmtx[g][0] * sc
    out = f'<path d="{d}" fill="{fill}"/>'
    if bg:  # white plate behind the line so it stays readable over the hatch
        w = text_width(s, size); padx, pady = 2.2, 1.6
        top = base - CAP * sc - pady; bot = base + 0.2 * size + pady
        out = f'<rect x="{cx - w/2 - padx:.2f}" y="{top:.2f}" width="{w + 2*padx:.2f}" height="{bot - top:.2f}" fill="#fff"/>' + out
    return out

# Sizes fitted to the original raster: "Dining Room" ~99 wide, small labels ~49 for "Stairs to Rec".
BIG = 108 / text_width('Dining Room', 1)
SMALL = 10.2  # room-label size in map units (about 9pt on the printed page)
LH = 12.4  # small-label line height

ROOMS = {
  # key: (shape, label lines, label centre x, first-line centre y, size)
  'elm':      ('M5 27H67V77H5Z',               ['Elm', 'Room'],                36,    45.3, SMALL),
  'dining':   ('M129 26H316V151H129Z',           ['Dining Room'],                223.7, 86.7, BIG),
  'martin':   ('M253 151H316V201H253Z',          ['Martin', 'Room'],             283.7, 171,  SMALL),
  'chapel':   ('M441 5H560V45.5H441Z',            ['Chapel'],                     502,   25,   SMALL),
  'chapel_a': ('M497 45.5H560V89H497Z',            ['Chapel A'],                   528,   67.5, SMALL),
  'library':  ('M497 89H560V134H497Z',           ['Library'],                    528,   111,  SMALL),
  'stairs':   ('M396 100H441V134H497V176H396Z',  ['Stairs to Rec', 'and Craft Rooms'], 447, 148.7, SMALL),
}
HALL = 'M441 45.5H497V134H441Z'
CORRIDORS = ['M5 77H129V100H5Z', 'M316 77H441V100H316Z']
WALLS = ['M0 22H72V73H0Z', 'M0 73H134V105H0Z', 'M124 21H321V156H124Z', 'M248 146H321V206H248Z',
         'M321 73H437V105H321Z', 'M391 101H502V181H391Z', 'M436 0H565V138H436Z']

def labels(key, bg=False, fill='#222'):
    shape, lines, cx, cy, size = ROOMS[key]
    return ''.join(text_path(l, cx, cy + i * LH, size, fill=fill, bg=bg) for i, l in enumerate(lines)) if size == SMALL else \
        ''.join(text_path(l, cx, cy, size, fill=fill, bg=bg) for l in lines)

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="565" height="206" viewBox="0 0 565 206">'

R = 2.4
def rrect(d_rect):
    return d_rect

WALL = 1.2   # every wall, highlighted rooms included, is exactly this thick

def bbox(d):
    import re
    n = [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
    xs, ys = n[0::2], n[1::2]
    return min(xs), min(ys), max(xs), max(ys)

def wall_segments(paths):
    """Union of every axis-aligned edge of the given shapes, so a wall shared by several
    shapes (or traced twice) is drawn exactly once and renders at one thickness."""
    import re
    horiz, vert = {}, {}
    for d in paths:
        toks = re.findall(r'[MHVZ]|-?\d+\.?\d*', d)
        pts, i, x, y = [], 0, 0.0, 0.0
        while i < len(toks):
            t = toks[i]
            if t == 'M': x, y = float(toks[i + 1]), float(toks[i + 2]); pts.append((x, y)); i += 3
            elif t == 'H': x = float(toks[i + 1]); pts.append((x, y)); i += 2
            elif t == 'V': y = float(toks[i + 1]); pts.append((x, y)); i += 2
            else: i += 1
        for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
            if ay == by: horiz.setdefault(ay, []).append(tuple(sorted((ax, bx))))
            elif ax == bx: vert.setdefault(ax, []).append(tuple(sorted((ay, by))))
    def merge(iv):
        out = []
        for lo, hi in sorted(iv):
            if out and lo <= out[-1][1]: out[-1][1] = max(out[-1][1], hi)
            else: out.append([lo, hi])
        return out
    fmt = lambda v: ('%.2f' % v).rstrip('0').rstrip('.')
    d = ''
    for y, iv in sorted(horiz.items()):
        for lo, hi in merge(iv): d += f'M{fmt(lo)} {fmt(y)}H{fmt(hi)}'
    for x, iv in sorted(vert.items()):
        for lo, hi in merge(iv): d += f'M{fmt(x)} {fmt(lo)}V{fmt(hi)}'
    return d

def base_outline():
    rooms = [r[0] for r in ROOMS.values()] + [HALL]
    pieces = rooms + CORRIDORS
    out = HEAD
    out += ''.join(f'<path d="{d}" fill="#fff"/>' for d in pieces)
    # every wall segment once, one stroke weight; square caps give clean corners and T-joints
    out += f'<path d="{wall_segments(pieces)}" fill="none" stroke="#222" stroke-width="{WALL}" stroke-linecap="square"/>'
    out += ''.join(labels(k) for k in ROOMS)
    return out + '</svg>'

def overlay_outline(key):
    """Highlighted room: solid dark fill with reversed (white) lettering. A thin white margin
    inside the wall keeps adjacent highlighted rooms visibly separate, and the wall itself
    stays the same weight as every other wall."""
    global FACE
    shape = ROOMS[key][0]
    FACE = 'med'
    lab = labels(key, fill='#fff')
    FACE = 'reg'
    margin = WALL + 1.0  # white stroke width centred on the edge; clipped to the inside half
    return (HEAD +
      f'<defs><clipPath id="c_{key}"><path d="{shape}"/></clipPath></defs>'
      f'<path d="{shape}" fill="#222"/>'
      f'<g clip-path="url(#c_{key})"><path d="{shape}" fill="none" stroke="#fff" stroke-width="{2 * margin:.2f}" stroke-linejoin="miter"/></g>'
      f'<path d="{shape}" fill="none" stroke="#222" stroke-width="{WALL}" stroke-linejoin="miter"/>' + lab + '</svg>')

def base():
    s = HEAD
    s += ''.join(f'<path d="{w}" fill="#000"/>' for w in WALLS)
    s += ''.join(f'<path d="{r[0]}" fill="#fff"/>' for r in ROOMS.values())
    s += f'<path d="{HALL}" fill="#fff"/>' + ''.join(f'<path d="{c}" fill="#fff"/>' for c in CORRIDORS)
    s += ''.join(labels(k) for k in ROOMS)
    return s + '</svg>'

def overlay(key):
    shape = ROOMS[key][0]
    return (HEAD +
      '<defs><pattern id="h" width="5.6" height="5.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      '<path d="M0 0V5.6M0 0H5.6" stroke="#8a8a8a" stroke-width="0.6" fill="none"/></pattern></defs>'
      f'<path d="{shape}" fill="#fff"/><path d="{shape}" fill="url(#h)"/>' + labels(key, bg=True) + '</svg>')

open(f'{OUT}/watson_layout.svg', 'w').write(base_outline())
names = {'elm':'elm_room','dining':'dining_room','martin':'martin_room','chapel':'chapel','chapel_a':'chapel_a','library':'library','stairs':'stairs'}
for k, n in names.items():
    open(f'{OUT}/watson_layout_{n}.svg', 'w').write(overlay_outline(k))
print('ok', BIG, SMALL)
