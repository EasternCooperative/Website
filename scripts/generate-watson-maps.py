"""Redraws the Watson facility map and per-room overlays as SVG (565x206 user units)."""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/maps'  # run from repo root
os.makedirs(OUT, exist_ok=True)
font = TTFont('/usr/share/fonts/TTF/Roboto-Regular.ttf')
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
hmtx = font['hmtx']
CAP = font['OS/2'].sCapHeight

def text_width(s, size):
    return sum(hmtx[cmap[ord(c)]][0] for c in s) * size / upm

def text_path(s, cx, cy, size, fill='#222', bg=False):
    """Outline of s centred on cx horizontally and cy on the cap-height midline."""
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
BIG = 99 / text_width('Dining Room', 1)
SMALL = 49.3 / text_width('Stairs to Rec', 1)
LH = 11.3  # small-label line height

ROOMS = {
  # key: (shape, label lines, label centre x, first-line centre y, size)
  'elm':      ('M10 32H62V71H10Z',               ['Elm', 'Room'],                36,    45.3, SMALL),
  'dining':   ('M134 31H311V146H134Z',           ['Dining Room'],                223.7, 86.7, BIG),
  'martin':   ('M258 156H311V196H258Z',          ['Martin', 'Room'],             283.7, 171,  SMALL),
  'chapel':   ('M446 10H555V40H446Z',            ['Chapel'],                     502,   25,   SMALL),
  'chapel_a': ('M502 51H555V84H502Z',            ['Chapel A'],                   528,   67.5, SMALL),
  'library':  ('M502 94H555V129H502Z',           ['Library'],                    528,   111,  SMALL),
  'stairs':   ('M401 111H436V139H492V171H401Z',  ['Stairs to Rec', 'and Craft Rooms'], 447, 148.7, SMALL),
}
HALL = 'M446 51H492V129H446Z'
CORRIDORS = ['M10 83H123V95H10Z', 'M322 83H435V95H322Z']
WALLS = ['M0 22H72V73H0Z', 'M0 73H134V105H0Z', 'M124 21H321V156H124Z', 'M248 146H321V206H248Z',
         'M321 73H437V105H321Z', 'M391 101H502V181H391Z', 'M436 0H565V138H436Z']

def labels(key, bg=False):
    shape, lines, cx, cy, size = ROOMS[key]
    return ''.join(text_path(l, cx, cy + i * LH, size, bg=bg) for i, l in enumerate(lines)) if size == SMALL else \
        ''.join(text_path(l, cx, cy, size, bg=bg) for l in lines)

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="565" height="206" viewBox="0 0 565 206">'

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

open(f'{OUT}/watson_layout.svg', 'w').write(base())
names = {'elm':'elm_room','dining':'dining_room','martin':'martin_room','chapel':'chapel','chapel_a':'chapel_a','library':'library','stairs':'stairs'}
for k, n in names.items():
    open(f'{OUT}/watson_layout_{n}.svg', 'w').write(overlay(k))
print('ok', BIG, SMALL)
