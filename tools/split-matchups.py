"""Plan 17 v2: split matchup portraits into pitcher and batter cards.
Reads art/source/matchup (never writes there). Writes art/sprites/matchup/."""
import glob, hashlib, json, os, re, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import known_bad   # plan 52: never rewrite the fixed 1901 batter card or write the broken one

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "matchup")
OUT = os.path.join(ROOT, "art", "sprites", "matchup")
CW, CH = 480, 720
NAME = re.compile(r"^(1901|1920|1946|1970|1990)-(light|olive|mediumbrown|darkbrown)-(a|b)\.png$")
# measured frame geometry (plan 17 v2 item 4)
FRAME_CHECK = {"left": [(15, 21), (710, 717)], "right": [(730, 737), (1426, 1432)], "top": (15, 22)}
CROPS_FRAMED = {"pitcher": (27, 28, 705, 1057), "batter": (743, 28, 1421, 1057)}

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

def dark_run_ok(vals, lo, hi):
    run = [i for i in range(lo, hi + 1) if vals[i] < 60]
    return 3 <= len(run) <= 8

def framed(im):
    g = im.convert("L")
    W, H = g.size
    corners = [(0, 0), (W - 8, 0), (0, H - 8), (W - 8, H - 8)]
    return all(sum(g.crop((x, y, x + 8, y + 8)).getdata()) / 64 > 245 for x, y in corners)

def confirm_frame(im):
    g = im.convert("L"); p = g.load(); W, H = g.size
    for y in (200, 400, 600, 800):
        row = [p[x, y] for x in range(W)]
        for lo, hi in FRAME_CHECK["left"] + FRAME_CHECK["right"]:
            if not dark_run_ok(row, lo, hi):
                return False
    for x in (200, 500, 900, 1200):
        col = [p[x, y] for y in range(H)]
        if not dark_run_ok(col, *FRAME_CHECK["top"]):
            return False
    return True

def split_x(im):
    g = im.convert("L"); p = g.load(); W, H = g.size
    clear = []
    for x in range(W // 2 - 150, W // 2 + 151):
        col = [p[x, y] for y in range(0, H, 2)]
        if not any(abs(col[i] - col[i - 1]) > 25 for i in range(1, len(col))):
            clear.append(x)
    return min(clear, key=lambda x: abs(x - W // 2)) if clear else None

def to_card(img):
    w, h = img.size
    if w / h > 2 / 3:  # too wide: center crop width
        nw = round(h * 2 / 3); x0 = (w - nw) // 2
        img = img.crop((x0, 0, x0 + nw, h))
    else:  # too tall: keep top
        nh = round(w * 3 / 2)
        img = img.crop((0, 0, w, nh))
    return img.resize((CW, CH), Image.LANCZOS)

def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.png")))
    before = {f: sha(f) for f in files}
    os.makedirs(os.path.join(OUT, "pitcher"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "batter"), exist_ok=True)
    index, fails, seen = [], [], set()
    for f in files:
        base = os.path.basename(f); m = NAME.match(base)
        if not m:
            fails.append((base, "bad name")); continue
        era, tone, var = m.groups(); key = f"{era}-{tone}-{var}"
        if key in seen:
            fails.append((base, "duplicate")); continue
        seen.add(key)
        im = Image.open(f).convert("RGB"); W, H = im.size
        if framed(im):
            if not confirm_frame(im):
                fails.append((base, "frame not confirmed")); continue
            boxes = CROPS_FRAMED; sx = None; layout = "framed"
        else:
            sx = split_x(im)
            if sx is None:
                fails.append((base, "figure crosses every cut")); continue
            boxes = {"pitcher": (0, 0, sx, H), "batter": (sx + 1, 0, W, H)}; layout = "fullbleed"
        rec = {"era": int(era), "tone": tone, "variant": var, "source": base, "layout": layout, "splitX": sx}
        for role, box in boxes.items():
            out = os.path.join(OUT, role, key + ".webp")
            if f"{role}/{key}" == "batter/1901-light-a":
                print("kept the hand-fixed batter/1901-light-a.webp (plan 52)"); rec[role] = {"file": f"{role}/{key}.webp", "crop": list(box), "bytes": os.path.getsize(out)}; continue
            card = to_card(im.crop(box)); known_bad.check_image(card, out)
            card.save(out, "WEBP", quality=82, method=6)
            rec[role] = {"file": f"{role}/{key}.webp", "crop": list(box), "bytes": os.path.getsize(out)}
        index.append(rec)
    after = {f: sha(f) for f in files}
    if before != after:
        print("FAIL: source files changed"); sys.exit(2)
    json.dump({"card": [CW, CH], "items": index}, open(os.path.join(OUT, "index.json"), "w"), indent=1)
    contact(index)
    print(f"ok {len(index)} sources, {2*len(index)} cards; fails: {fails}")
    sizes = [r[k]["bytes"] for r in index for k in ("pitcher", "batter")]
    if sizes: print("bytes min/avg/max", min(sizes), sum(sizes)//len(sizes), max(sizes))
    if fails: sys.exit(1)

def contact(index):
    by = {f"{r['era']}-{r['tone']}-{r['variant']}": r for r in index}
    pairs = [(k, k) for k in sorted(by)]
    mixed = [("1990-darkbrown-a", "1920-light-a"), ("1901-light-b", "1970-darkbrown-b"),
             ("1946-olive-a", "1946-mediumbrown-a"), ("1970-mediumbrown-a", "1990-olive-a"),
             ("1920-darkbrown-b", "1990-mediumbrown-a"), ("1901-olive-a", "1946-darkbrown-a")]
    pairs += [p for p in mixed if p[0] in by and p[1] in by]
    s = 0.3; cw, ch = int(CW * s), int(CH * s); gap, pad = 10, 14
    cols = 4; tw = 2 * cw + gap + 2 * pad; th = ch + 2 * pad
    rows = (len(pairs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), "white"); d = ImageDraw.Draw(sheet)
    for i, (pk, bk) in enumerate(pairs):
        ox, oy = (i % cols) * tw + pad, (i // cols) * th + pad
        for j, (role, k) in enumerate((("pitcher", pk), ("batter", bk))):
            card = Image.open(os.path.join(OUT, by[k][role]["file"])).convert("RGB").resize((cw, ch))
            x = ox + j * (cw + gap); sheet.paste(card, (x, oy))
            d.rectangle((x - 2, oy - 2, x + cw + 1, oy + ch + 1), outline="black", width=3)
        if pk != bk:
            d.rectangle((ox - 8, oy - 8, ox + 2 * cw + gap + 7, oy + ch + 7), outline="red", width=3)
    sheet.save(os.path.join(OUT, "_check.png"))

if __name__ == "__main__":
    main()
