"""Plan 50 export tests. Run from the repo root: python3 -m unittest tools/test_plan50.py"""
import importlib.util, json, os, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('exp', os.path.join(ROOT, 'tools', 'export-audio.py'))
exp = importlib.util.module_from_spec(spec); spec.loader.exec_module(exp)

def w(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(data)

class Export(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); d = self.t.name
        self.el, self.cr, self.out, self.man = os.path.join(d, 'el'), os.path.join(d, 'crowd'), os.path.join(d, 'web'), os.path.join(d, 'm.json')
        for v in ('classic', 'modern'):
            w(os.path.join(self.el, v, 'lead.p.mound.mp3'), b'L' + v.encode()); w(os.path.join(self.el, v, 'a.ball.1.mp3'), b'A')
            w(os.path.join(self.el, v, 'not.spoken.mp3'), b'X')
            for pid in ('ruthb101', 'badid001', 'lowid001', 'okid0001'): w(os.path.join(self.el, v, 'names', pid + '.mp3'), (pid + v).encode())
        w(os.path.join(self.cr, 'bed-1901.mp3'), b'B')
        open(os.path.join(self.el, 'names-skip.txt'), 'w').write('classic\tbadid001\tx\nmodern\tbadid001\n')
        json.dump([['classic', 'lowid001', 'Low'], ['modern', 'lowid001', 'Low'], ['modern', 'okid0001', 'Ok']], open(os.path.join(self.el, 'names-low-2026-10-26.json'), 'w'))
        open(os.path.join(self.el, 'names-ok.txt'), 'w').write('modern\tokid0001\n')
    def tearDown(self): self.t.cleanup()
    def run_export(self):
        return exp.export(self.el, self.cr, self.out, self.man, keys=['lead.p.mound', 'a.ball.1'], durf=lambda p: 1200)
    def test_hash_names_and_manifest(self):
        m, rep = self.run_export()
        h = m['phrases']['classic']['lead.p.mound']
        self.assertEqual(h, exp.h8(os.path.join(self.el, 'classic', 'lead.p.mound.mp3')))
        self.assertTrue(os.path.exists(os.path.join(self.out, 'p', 'classic', f'lead.p.mound.{h}.mp3')))
        self.assertEqual(m['dur']['classic'], {'a.ball.1': 1200})
        self.assertEqual(m['crowd'], {'bed-1901': exp.h8(os.path.join(self.cr, 'bed-1901.mp3'))})
    def test_only_spoken_keys(self):
        m, _ = self.run_export()
        self.assertNotIn('not.spoken', m['phrases']['modern'])
    def test_names_excluded(self):
        m, rep = self.run_export()
        self.assertEqual(sorted(m['names']['classic']), ['okid0001', 'ruthb101'])
        self.assertEqual(sorted(m['names']['modern']), ['okid0001', 'ruthb101'])
        self.assertEqual(rep['names_excluded'], 4)
    def test_every_entry_has_a_file_and_rerun_is_stable(self):
        m, _ = self.run_export()
        self.assertTrue(all(os.path.exists(os.path.join(self.out, f)) for f in exp.files_for(m)))
        before = open(self.man).read(); mt = os.path.getmtime(self.man)
        self.run_export()
        self.assertEqual(open(self.man).read(), before); self.assertEqual(os.path.getmtime(self.man), mt)

class RealClips(unittest.TestCase):
    def test_real_calls_have_short_fallbacks(self):
        """Every spoken call (fallback applied over 1.35 s) is 1.35 s or less; fallbacks as in pbp.ts adef()."""
        el = exp.EL
        if not os.path.isdir(el): self.skipTest('no clips here')
        src = open(os.path.join(ROOT, 'app', 'src', 'app', 'pbp.ts'), encoding='utf-8').read()
        self.assertIn("adef('a.ball.full', 'Ball three, full count.', 'a.full'", src)
        fb = lambda k: 'a.fouloff' if k == 'a.still' else 'a.full' if k.endswith('.full') else ('a.strike.' + k.split('.')[2] if k.startswith(('a.swing.', 'a.foul.')) else None)
        for v in exp.VOICES:
            for f in os.listdir(os.path.join(el, v)):
                if not f.startswith('a.') or not f.endswith('.mp3'): continue
                k = f[:-4]; d = exp.dur_ms(os.path.join(el, v, f))
                if d > 1350:
                    self.assertIsNotNone(fb(k), f'{v} {k} {d} ms has no fallback')
                    self.assertLessEqual(exp.dur_ms(os.path.join(el, v, fb(k) + '.mp3')), 1350, f'{v} fallback of {k}')

if __name__ == '__main__': unittest.main()
