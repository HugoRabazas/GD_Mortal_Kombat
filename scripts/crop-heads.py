"""Cut each fighter's head square out of the full picture in art/fighters
and save it, losslessly, to client/src/fighters - the only part the game
uses, so the page does not carry the rest of every picture.

The square comes from `head` in shared/fighters.js (centre x, y and radius
r in the picture's pixels). Run it again after changing a picture or a
head circle:  python3 scripts/crop-heads.py   (needs Pillow)
"""
import re
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
roster = (root / 'shared' / 'fighters.js').read_text()
for fid, x, y, r in re.findall(r"id: '(\w+)'.*?head: \{ x: (\d+), y: (\d+), r: (\d+) \}", roster, re.S):
    x, y, r = int(x), int(y), int(r)
    img = Image.open(root / 'art' / 'fighters' / f'{fid}.png')
    head = img.crop((x - r, y - r, x + r, y + r))
    out = root / 'client' / 'src' / 'fighters' / f'{fid}.png'
    head.save(out, optimize=True)
    print(f'{fid}: {img.size} -> {head.size}, {out.stat().st_size} bytes')
