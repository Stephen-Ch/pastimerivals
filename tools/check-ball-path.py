"""Plan 27: checks that no taken pitch or swinging miss touches the batter art.
Maps every batter sprite sheet into batter-panel percent space (same CSS as pitch-scene.ts:
panel 2:3, sprite height 90%, aspect 364/480, bottom 3%, centred at left 38%) and tests each
target box (plus ball radius and drift) against the opaque pixels of the frames he holds then.
Right-handed only: the scene mirrors the panel for left-handed batters and the targets mirror with it.
Usage: python3 tools/check-ball-path.py [art dir]   Exit 1 on any overlap."""
import glob, os, sys
from PIL import Image

ART = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "src", "PastimeRivals.Api", "wwwroot", "art")
H_PER_W = 1.5                       # panel is 2 wide by 3 tall
SPR_H = 90.0                        # % of panel height
SPR_W = SPR_H * H_PER_W * 364 / 480 # % of panel width
SPR_LEFT = 38.0 - SPR_W / 2
SPR_TOP = 100 - 3 - SPR_H
BALL_D = 4.5                        # % of panel width at arrival
DRIFT = 2.0

# (name, frames he shows when the ball is there, x0, x1, y0, y1) in panel %. Must match pitchTarget in pitch-scene.ts.
TARGETS = [
    ("look", [0], 74, 84, 46, 62),
    ("miss", [3, 5], 74, 84, 66, 70),   # under the bat: the swing frame reaches y 61 at most
    ("take-wide", [0, 6], 88, 94, 48, 62),
    ("take-high", [0, 6], 74, 84, 32, 36),
    ("take-low", [0, 6], 76, 86, 70, 73),
]

def opaque_points(frame_img):
    w, h = frame_img.size
    a = frame_img.getchannel("A").load()
    pts = []
    for py in range(0, h, 2):
        for px in range(0, w, 2):
            if a[px, py] > 40:
                pts.append((SPR_LEFT + px / w * SPR_W, SPR_TOP + py / h * SPR_H))
    return pts

bad = 0
sheets = sorted(glob.glob(os.path.join(ART, "batter-*.webp")))
if not sheets:
    print("no batter sheets in", ART); sys.exit(2)
for sheet in sheets:
    im = Image.open(sheet).convert("RGBA")
    fw = im.size[0] // 8
    frames = {f: opaque_points(im.crop((f * fw, 0, (f + 1) * fw, im.size[1]))) for f in range(8)}
    for name, fs, x0, x1, y0, y1 in TARGETS:
        rx = BALL_D / 2 + DRIFT
        ry = (BALL_D / 2) / H_PER_W + DRIFT
        hits = [(f, x, y) for f in fs for (x, y) in frames[f] if x0 - rx <= x <= x1 + rx and y0 - ry <= y <= y1 + ry]
        if hits:
            bad += 1
            f, x, y = hits[0]
            print(f"OVERLAP {os.path.basename(sheet)} {name}: frame {f} pixel at x {x:.1f} y {y:.1f} ({len(hits)} pts)")
    # Report the body extent for the stance frame, for the record.
    xs = [x for x, y in frames[0]]
    print(f"{os.path.basename(sheet)}: stance x {min(xs):.0f}-{max(xs):.0f}%")
print("overlaps:", bad)
sys.exit(1 if bad else 0)
