"""Plan 59 Round 5 test 8: the CF art check passes on the real files and fails on planted faults."""
import importlib.util, os, shutil
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('make_cf_art', os.path.join(os.path.dirname(__file__), 'make-cf-art.py'))
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)


def test_real_files_pass():
    assert cf.check()


def _planted(tmp_path, monkeypatch, name, fault):
    d = tmp_path / 'cf'; shutil.copytree('art/sprites/cf', d)
    im = Image.open(d / name).convert('RGBA'); a = np.asarray(im).copy(); fault(a)
    Image.fromarray(a).save(d / name)
    monkeypatch.setattr(cf, 'OUT', str(d))
    return cf.check()


def test_planted_feet_off_the_baseline_fail(tmp_path, monkeypatch):
    def lift(a): a[:, :360] = np.roll(a[:, :360], -20, axis=0)
    assert not _planted(tmp_path, monkeypatch, 'back-1990-light.png', lift)


def test_planted_colour_in_a_line_strip_fails(tmp_path, monkeypatch):
    def paint(a):
        m = a[..., 3] > 128; a[m, 0] = 200; a[m, 1] = 120; a[m, 2] = 90
    assert not _planted(tmp_path, monkeypatch, 'front-1990-line.png', paint)


def test_planted_wrong_height_fails(tmp_path, monkeypatch):
    def shrink(a):
        for i in range(8):
            c = Image.fromarray(a[:, i * 360:(i + 1) * 360]); s = c.resize((360, 400))
            out = Image.new('RGBA', (360, 480)); out.paste(s, (0, 80)); a[:, i * 360:(i + 1) * 360] = np.asarray(out)
    assert not _planted(tmp_path, monkeypatch, 'back-1990-light.png', shrink)


def test_planted_hole_in_the_jersey_fails(tmp_path, monkeypatch):
    def hole(a):
        ys, xs = np.nonzero(a[:, :360, 3] > 128); cy, cx = int(ys.mean()), int(xs.mean())
        a[cy - 20:cy + 20, cx - 12:cx + 12, 3] = 0
    assert not _planted(tmp_path, monkeypatch, 'back-1970-light.png', hole)


def _src(tmp_path, third):
    """Two figure blocks on white (stance, load) plus an optional loose piece (a bat drawn apart from the hands)."""
    a = np.full((1024, 1536, 3), 255, np.uint8)
    a[150:900, 300:500] = 40; a[150:900, 1000:1200] = 40
    if third: a[60:120, 700:900] = 120
    p = tmp_path / 'src.png'; Image.fromarray(a).save(p); return str(p)


def test_side_on_two_figures_pass(tmp_path):
    assert cf.side_on(_src(tmp_path, False), '1990', 'light').width == 720


def test_side_on_loose_third_piece_stops(tmp_path):
    import pytest
    with pytest.raises(SystemExit):
        cf.side_on(_src(tmp_path, True), '1990', 'light')
