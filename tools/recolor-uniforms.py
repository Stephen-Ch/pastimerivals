"""Plan 59 Round 4: recolor uniforms on sheets and cards to one palette per era.
Reads art/sprites/recolor/palette.json and regions.json; writes art/sprites/recolor/out/<image>.png (git-ignored).
Masks: SAM 2 point prompts (cached in art/sprites/recolor/masks/<image>.npz) for named parts and the face/skin
check mask; parts are cut further by a colour gate in Lab, so belt, shoes, skin, bat and ink are never touched.

  python3 tools/recolor-uniforms.py masks <image>...    # run SAM for the prompts (needs ultralytics + sam2.1_b.pt)
  python3 tools/recolor-uniforms.py build <image>...    # recolor from cached masks (no SAM needed)
  python3 tools/recolor-uniforms.py check <image>...    # tests 2-5 of the Round 4 card, prints a report
Run from the repo root."""
import json, os, sys
import numpy as np
from PIL import Image
from skimage.color import rgb2lab, lab2rgb, deltaE_ciede2000
from scipy import ndimage as ndi

ROOT = 'art/sprites/recolor'
PALETTE = json.load(open(f'{ROOT}/palette.json')) if os.path.exists(f'{ROOT}/palette.json') else {}
REGIONS = json.load(open(f'{ROOT}/regions.json')) if os.path.exists(f'{ROOT}/regions.json') else {}
SAM_WEIGHTS = os.environ.get('SAM_WEIGHTS', 'sam2.1_b.pt')


# ---------- image access ----------
def load(cfg):
    """RGBA uint8 array and the cell width (cards: one cell = whole image, alpha 255)."""
    im = Image.open(cfg['src'])
    a = np.asarray(im.convert('RGBA')).copy()
    n = cfg.get('frames', 1)
    return a, a.shape[1] // n, n


def figure(a, cfg):
    """Figure pixels. Sheets: alpha > 0. Cards: the SAM 'figure' mask (opaque background)."""
    return a[..., 3] > 0


# ---------- colour gates ----------
def gate(lab, g):
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(A, B)
    m = np.ones(L.shape, bool)
    for k, v in g.items():
        if k == 'L_min': m &= L >= v
        elif k == 'L_max': m &= L <= v
        elif k == 'a_min': m &= A >= v
        elif k == 'a_max': m &= A <= v
        elif k == 'b_min': m &= B >= v
        elif k == 'b_max': m &= B <= v
        elif k == 'C_min': m &= C >= v
        elif k == 'C_max': m &= C <= v
        elif k == 'a_minus_b_min': m &= (A - B) >= v
        elif k == 'a_minus_b_max': m &= (A - B) <= v
        else: raise SystemExit(f'unknown gate key {k}')
    return m


def ink(lab, alpha):
    """Thin dark strokes (L < 20, chroma < 8, at most 3 px wide). Wider dark areas are not ink."""
    dark = (lab[..., 0] < 20) & (np.hypot(lab[..., 1], lab[..., 2]) < 8) & (alpha > 0)
    wide = ndi.binary_opening(dark, structure=np.ones((4, 4), bool))
    return dark & ~wide


# ---------- SAM masks ----------
def run_sam(name):
    from ultralytics import SAM
    cfg = REGIONS[name]; a, cw, n = load(cfg)
    if 'masks_from' in cfg: print(name, 'uses the masks of', cfg['masks_from']); return
    model = SAM(SAM_WEIGHTS)
    out = {}
    for f in range(n):
        cell = a[:, f * cw:(f + 1) * cw]
        rgb = np.where(cell[..., 3:] > 0, cell[..., :3], 205).astype(np.uint8)
        for part, pts in cfg['prompts'].get(str(f), {}).items():
            if isinstance(pts, dict):   # {"poly": [[x, y], ...]}: hand-drawn zone where SAM can't split same-colour parts
                from PIL import ImageDraw
                z = Image.new('L', (cw, a.shape[0]), 0); ImageDraw.Draw(z).polygon([tuple(q) for q in pts['poly']], fill=1)
                full = np.zeros(a.shape[:2], bool); full[:, f * cw:(f + 1) * cw] = np.asarray(z, bool)
                out[part] = out.get(part, np.zeros(a.shape[:2], bool)) | full
                continue
            P = [p[:2] for p in pts]; Lb = [p[2] if len(p) > 2 else 1 for p in pts]
            r = model.predict(rgb, points=[P], labels=[Lb], verbose=False)[0]
            mk = r.masks.data.cpu().numpy().any(0)
            full = np.zeros(a.shape[:2], bool); full[:, f * cw:(f + 1) * cw] = mk
            out[part] = out.get(part, np.zeros(a.shape[:2], bool)) | full
    os.makedirs(f'{ROOT}/masks', exist_ok=True)
    np.savez_compressed(f'{ROOT}/masks/{name}.npz', **{k: np.packbits(v) for k, v in out.items()}, shape=np.array(a.shape[:2]))
    print(name, 'masks:', {k: int(v.sum()) for k, v in out.items()})


def sam_masks(name):
    name = REGIONS.get(name, {}).get('masks_from', name)   # copies of one source sheet share its masks
    z = np.load(f'{ROOT}/masks/{name}.npz'); sh = tuple(z['shape'])
    return {k: np.unpackbits(z[k])[:sh[0] * sh[1]].reshape(sh).astype(bool) for k in z.files if k != 'shape'}


# ---------- regions ----------
def regions(name, a=None, lab=None):
    """{part: mask} for every recolor part, plus 'skin' and 'protected' for the checks."""
    cfg = REGIONS[name]
    if a is None: a, _, _ = load(cfg)
    if lab is None: lab = rgb2lab(a[..., :3] / 255.0)
    sm = sam_masks(name); fig = figure(a, cfg)
    if 'figure' in sm: fig &= sm['figure']
    thin = ink(lab, a[..., 3])
    gates = cfg['gates']
    parts = {}
    for p in cfg['parts']:
        m = fig & ~thin
        g = np.zeros(m.shape, bool)
        for gn in p['gate'] if isinstance(p['gate'], list) else [p['gate']]: g |= gate(lab, gates[gn])
        m &= g
        if 'sam' in p: m &= sm[p['sam']]
        if 'below' in p: m[:p['below']] = False   # a part that only exists below a row (pants under the belt)
        if p['to'] == 'keep' and 'sam' not in p and 'below' not in p:
            raise SystemExit(f'{name}: keep part {p["name"]} needs a sam mask or a below row (else it hides missed pixels)')
        for o in p.get('minus', []):
            m &= ~(sm[o] if o in sm else parts[o])
        for o in p.get('minus_sam', []): m &= ~sm[o]
        parts[p['name']] = m
    changed = np.zeros(fig.shape, bool)
    for p in cfg['parts']:
        if p['to'] != 'keep': changed |= parts[p['name']]
    for p in cfg['parts']:   # keep parts never overlap a part that changes colour
        if p['to'] == 'keep': parts[p['name']] &= ~changed
    used = np.zeros(fig.shape, bool)
    for m in parts.values(): used |= m
    skin = sm.get('skin', np.zeros(fig.shape, bool)) & fig & ~thin & gate(lab, cfg.get('skin_gate', {'a_min': 5, 'b_min': 8}))
    return parts, skin, fig & ~used, thin


# ---------- recolor ----------
def fit_gamut(lab):
    """Lower chroma until lab2rgb lands inside sRGB (no per-channel clamp)."""
    out = lab.copy()
    for _ in range(12):
        rgb = lab2rgb(out[None])[0]
        bad = ((rgb < -1e-4) | (rgb > 1 + 1e-4)).any(-1)
        if not bad.any(): break
        out[bad, 1:] *= 0.85
    return np.clip(lab2rgb(out[None])[0], 0, 1)


def recolor(name):
    cfg = REGIONS[name]; a, cw, n = load(cfg)
    lab = rgb2lab(a[..., :3] / 255.0)
    parts, _, _, _ = regions(name, a, lab)
    pal = PALETTE[cfg['era']]
    out = a.copy()
    for p in cfg['parts']:
        m = parts[p['name']]
        if not m.any() or p['to'] == 'keep': continue
        t = np.array(pal[p['to']], float)
        src = lab[m]
        med = np.median(src[:, 0])
        sd_s = max(np.std(src[:, 0]), 1e-3)
        sd_t = p.get('sd', 8.0 if t[0] > 55 else 6.0)
        k = float(np.clip(sd_t / sd_s, 0.4, 1.2))
        new = np.empty_like(src)
        new[:, 0] = np.clip(t[0] + (src[:, 0] - med) * k, 0, 100)
        new[:, 1] = t[1]; new[:, 2] = t[2]
        rgb = fit_gamut(new)
        out[m, :3] = np.round(rgb * 255).astype(np.uint8)
    os.makedirs(f'{ROOT}/out', exist_ok=True)
    Image.fromarray(out, 'RGBA').save(f'{ROOT}/out/{name}.png', optimize=False)
    return out


# ---------- checks (card tests 2-5) ----------
def check(name, out=None, parts_override=None):
    """Returns a dict of results; ok False if any hard check fails."""
    cfg = REGIONS[name]; a, cw, n = load(cfg)
    if out is None: out = np.asarray(Image.open(f'{ROOT}/out/{name}.png').convert('RGBA'))
    lab = rgb2lab(a[..., :3] / 255.0); olab = rgb2lab(out[..., :3] / 255.0)
    parts, skin, rest, thin = regions(name, a, lab)
    approved = parts   # source colours come from the approved masks, even when a test plants a missed part
    if parts_override: parts = {**parts, **parts_override}
    region = np.zeros(a.shape[:2], bool)
    for m in parts.values(): region |= m
    r = {'image': name, 'fails': []}
    # 2. untouched pixels identical; alpha identical; ink stays dark; white paper outside white regions unchanged
    if not np.array_equal(a[..., 3], out[..., 3]): r['fails'].append('alpha changed')
    keep = np.zeros(a.shape[:2], bool)
    for q in cfg['parts']:
        if q['to'] == 'keep': keep |= parts[q['name']]
    if not np.array_equal(a[~region | keep], out[~region | keep]): r['fails'].append('pixels outside regions (or in keep parts) changed')
    if (olab[thin, 0] >= 30).any(): r['fails'].append('ink lightened')
    white = (lab[..., 0] > 95) & (np.hypot(lab[..., 1], lab[..., 2]) < 3) & (a[..., 3] > 0)
    white_regions = [p['name'] for p in cfg['parts'] if p.get('src_white')]
    allowed = np.zeros(white.shape, bool)
    for w in white_regions: allowed |= parts[w]
    if not np.array_equal(a[white & ~allowed], out[white & ~allowed]): r['fails'].append('white paper changed')
    # 3. skin check on SOURCE pixels (skipped for paper-skin images)
    if not cfg.get('paper_skin') and skin.any():
        sk = np.median(lab[skin], 0)
        for pn, m in parts.items():
            if not m.any(): continue
            d = deltaE_ciede2000(lab[m], np.broadcast_to(sk, lab[m].shape))
            share = float((d < 10).mean())
            r[f'skin_near_{pn}'] = round(share * 100, 2)
            if share > 0.005: r['fails'].append(f'skin-like source pixels in {pn}: {share*100:.2f}%')
    # 4. leftover: figure pixels outside regions that still look like a source uniform colour
    pal_ = PALETTE[cfg['era']]
    srcs = []   # only parts that really change colour: a no-op trim (navy to navy) has no visible leftover
    for p in cfg['parts']:
        m = approved[p['name']]
        if m.sum() <= 50 or p['to'] == 'keep': continue
        c = np.median(lab[m], 0)
        if deltaE_ciede2000(c[None], np.array(pal_[p['to']], float)[None])[0] >= 10: srcs.append(c)
    sm = sam_masks(name)
    fig = figure(a, cfg)
    if 'figure' in sm: fig &= sm['figure']   # cards: the player, not the painted background
    outside = fig & ~region & ~thin & ~skin & (a[..., 3] >= 128)   # the soft outer halo is not uniform
    for q in cfg['parts']:   # inside a no-op part's SAM mask (navy cap staying navy) the source colour is meant to stay
        if 'sam' in q and q['to'] != 'body' and parts[q['name']].sum() > 50 and (q['to'] == 'keep' or deltaE_ciede2000(
                np.median(lab[parts[q['name']]], 0)[None], np.array(pal_[q['to']], float)[None])[0] < 10):
            outside &= ~sm[q['sam']]
    for x in cfg.get('leftover_ignore', []): outside &= ~sm[x]   # e.g. pants kept gray when gray sleeves turn navy
    if 'leftover_ignore_below' in cfg: outside[cfg['leftover_ignore_below']:] = False   # cards: gray pants below the belt stay gray
    left = np.zeros(outside.shape, bool)
    for c in srcs:
        d = deltaE_ciede2000(olab, np.broadcast_to(c, olab.shape)); left |= outside & (d < cfg.get('leftover_de', 8))
    worst = 0.0   # per frame: a whole missed part in one frame must not hide in the sheet total
    for f in range(n):
        fm = np.zeros(fig.shape, bool); fm[:, f * cw:(f + 1) * cw] = True
        worst = max(worst, float((left & fm).sum() / max((fig & fm).sum(), 1)))
    r['leftover_pct'] = round(worst * 100, 2)
    if worst > 0.01: r['fails'].append(f'leftover source colour {worst*100:.2f}% of a frame')
    # a missed patch is one blob; scattered flecks are not (an 80 px square missed on a card is only 0.25% of it)
    lbl, k = ndi.label(ndi.binary_closing(left, structure=np.ones((3, 3), bool)))
    blob = int(np.bincount(lbl.ravel())[1:].max()) if k else 0
    r['leftover_blob'] = blob
    if blob > cfg.get('blob_max', 300): r['fails'].append(f'leftover patch of {blob} px')
    # 5. smoke: palette vs region median per frame
    pal = PALETTE[cfg['era']]; de = []
    for p in cfg['parts']:
        if p['to'] == 'keep': continue
        t = np.array(pal[p['to']], float)
        for f in range(n):
            m = parts[p['name']].copy(); m[:, :f * cw] = False; m[:, (f + 1) * cw:] = False
            if m.sum() < 30: continue
            d = float(deltaE_ciede2000(np.median(olab[m], 0)[None], t[None])[0])
            de.append(d)
            if d >= 10: r['fails'].append(f'{p["name"]} frame {f} dE {d:.1f}')
    r['smoke_max_dE'] = round(max(de), 2) if de else None
    # 5b. area check: each part's share of the figure per frame within 50% of its median share (n > 1 frames).
    # 30% (card v4) failed on real pose changes (swing, back view: up to 43%); wrong-part masks are off by 100%+.
    if n > 1:
        for p in cfg['parts']:
            if p.get('area_check') is False: continue
            sh = []
            for f in range(n):
                fm = fig.copy(); fm[:, :f * cw] = False; fm[:, (f + 1) * cw:] = False
                sh.append(parts[p['name']][fm].mean() if fm.any() else 0.0)
            med = float(np.median(sh))
            if med < 0.01: continue
            bad = [f for f, v in enumerate(sh) if abs(v - med) > cfg.get('area_tol', 0.5) * med]
            r[f'area_{p["name"]}'] = [round(v * 100, 1) for v in sh]
            if bad: r['fails'].append(f'{p["name"]} area off in frames {bad}')
    r['ok'] = not r['fails']
    return r


if __name__ == '__main__':
    cmd, names = sys.argv[1], sys.argv[2:] or list(REGIONS)
    for nm in names:
        if cmd == 'masks': run_sam(nm)
        elif cmd == 'build': recolor(nm); print(nm, 'built')
        elif cmd == 'check': print(json.dumps(check(nm)))
        else: raise SystemExit(__doc__)
