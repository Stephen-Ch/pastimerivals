"""Plan 47 tests (recorder and name priority). Run from the repo root: python3 -m unittest tools/test_plan47.py"""
import csv, importlib.util, json, os, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('rec', os.path.join(ROOT, 'tools', 'record-announcer.py'))
rec = importlib.util.module_from_spec(spec); spec.loader.exec_module(rec)

class Recorder(unittest.TestCase):
    def test_budget_guard(self):
        self.assertTrue(rec.batch_allowed(10000, 9700))
        self.assertFalse(rec.batch_allowed(10000, 9701))
        self.assertFalse(rec.batch_allowed(299, 0))
    def test_fit_jobs_stops_at_first_misfit(self):   # plan 48
        self.assertEqual(rec.fit_jobs(1000, [300, 300, 500, 10], lambda j: j), [300, 300])
    def test_estimate(self):
        self.assertEqual(rec.est_chars(25), 13); self.assertEqual(rec.est_chars(100, 0.10), 55)
    def test_name_len(self):   # plan 48
        self.assertTrue(rec.name_len_ok(2.4)); self.assertTrue(rec.name_len_ok(2.5))
        self.assertFalse(rec.name_len_ok(2.51)); self.assertFalse(rec.name_len_ok(0.39))
    def test_never_reads_old_clips(self):
        src = open(os.path.join(ROOT, 'tools', 'record-announcer.py')).read().split('"""', 2)[2]
        self.assertNotIn("'clips'", src); self.assertNotIn('_old-openai-clips', src)

class NamePriority(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'audio', 'name-priority.csv'))))
        pools = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'audio', 'pools.csv'))))
        cls.top50 = {r['id'] for r in pools if r['list'] == 'top50'}
        cls.pre = set()
        for f in ('batters.csv', 'pitchers.csv'):
            for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'outall', f), encoding='utf-8')):
                if int(r['year']) < 1960: cls.pre.add(r['id'])
    def test_tier1(self):
        t1 = {r['id'] for r in self.rows if r['tier'] == '1'}
        self.assertIn('martp001', t1); self.assertIn('ruthb101', t1)
        self.assertTrue(self.top50 <= t1)
    def test_ranks_unique(self):
        ranks = [int(r['rank']) for r in self.rows]
        self.assertEqual(len(ranks), len(set(ranks)))
        self.assertEqual(len({(r['id'], r['voice']) for r in self.rows}), len(self.rows))
    def test_classic_only_pre1960(self):
        self.assertTrue(all(r['id'] in self.pre for r in self.rows if r['voice'] == 'classic'))

class Plan49(unittest.TestCase):
    T = {'cy': 'Sy', 'si': 'SIGH', 'lu': 'LOU', 'rip': 'RIPP'}
    def test_respell(self):
        self.assertEqual(rec.name_text('Cy Young', self.T), 'And now... Sy YOUNG!')
        self.assertEqual(rec.name_text('Lu Blue', self.T), 'And now... LOU BLUE!')
        for nm in ('Ty Cobb', 'Roberto Alomar', 'J.D. Martinez', 'Al Orth', 'Cyrus Smith', 'Jean-Cy Doe', 'Ken Griffey Jr.'):
            self.assertEqual(rec.name_text(nm, self.T), rec.legacy_name_text(nm))
    def test_no_table_is_legacy(self):
        self.assertEqual(rec.name_text('Cy Young'), 'And now... CY YOUNG!')
        self.assertEqual(rec.legacy_name_text('Cy Young'), 'And now... CY YOUNG!')
        self.assertEqual(rec.load_respell('/nonexistent.csv'), {})
    def test_table_file(self):
        t = rec.load_respell()
        self.assertEqual(rec.name_text('Rip Sewell', t), 'And now... RIPP SEWELL!')
    def test_import_uses_legacy(self):
        src = open(os.path.join(ROOT, 'tools', 'record-announcer.py')).read()
        imp = src.split('def do_import_names')[1].split('\nif __name__')[0]
        self.assertIn('legacy_name_text(nm)', imp); self.assertNotIn(' name_text(', imp)
    def test_logged_text_is_sent_text(self):
        sent = []
        old = (rec.tts, rec.log, rec.name_cut, rec.encode, rec.voice_ids, rec.fail)
        with tempfile.TemporaryDirectory() as d:
            oldp = (rec.EL, rec.RAW); rec.EL, rec.RAW = d, os.path.join(d, '_raw')
            try:
                rec.tts = lambda v, t, s: (sent.append(('tts', t)), b'\0' * 100)[1]
                rec.log = lambda *a, **k: sent.append(('log', k['text']))
                rec.name_cut = lambda raw: None
                rec.voice_ids = lambda: {'classic': 'x'}
                rec.fail = lambda *a: 'FAIL'
                rec.name_job('classic', 'younc102', 'Cy Young', seed=8, text='And now... SIGH YOUNG!')()
            finally:
                rec.tts, rec.log, rec.name_cut, rec.encode, rec.voice_ids, rec.fail = old; rec.EL, rec.RAW = oldp
        self.assertEqual(sent, [('tts', 'And now... SIGH YOUNG!'), ('log', 'And now... SIGH YOUNG!')])
    def test_reject_and_unskip(self):
        with tempfile.TemporaryDirectory() as d:
            oldp = (rec.EL, rec.RAW, rec.BLOG, rec.SKIP)
            rec.EL, rec.RAW, rec.BLOG, rec.SKIP = d, os.path.join(d, '_raw'), os.path.join(d, 'b.jsonl'), os.path.join(d, 'skip.txt')
            try:
                raw = os.path.join(rec.RAW, 'classic', 'names'); mp3 = os.path.join(d, 'classic', 'names')
                os.makedirs(raw); os.makedirs(mp3)
                open(os.path.join(raw, 'younc102.pcm'), 'w').write('a'); open(os.path.join(mp3, 'younc102.mp3'), 'w').write('m')
                self.assertEqual(rec.reject_name('classic', 'younc102'), 1)
                rej = os.path.join(rec.RAW, 'rejected', 'classic', 'names')
                self.assertEqual(sorted(os.listdir(rej)), ['younc102.s7.mp3', 'younc102.s7.pcm'])
                self.assertFalse(os.path.exists(os.path.join(mp3, 'younc102.mp3')))
                open(rec.BLOG, 'w').write(json.dumps({'kind': 'name', 'voice': 'classic', 'key': 'younc102', 'seed': 8}) + '\n')
                open(os.path.join(raw, 'younc102.pcm'), 'w').write('b')
                self.assertEqual(rec.reject_name('classic', 'younc102'), 2)
                self.assertEqual(open(os.path.join(rej, 'younc102.s7.pcm')).read(), 'a')
                self.assertEqual(open(os.path.join(rej, 'younc102.s8.pcm')).read(), 'b')
                open(rec.SKIP, 'w').write('classic\tyounc102\tx\nmodern\tyounc102\tx\nclassic\tnehfa101\n')
                self.assertEqual(rec.unskip({('classic', 'younc102')}), 1)
                self.assertEqual(open(rec.SKIP).read(), 'modern\tyounc102\tx\nclassic\tnehfa101\n')
            finally:
                rec.EL, rec.RAW, rec.BLOG, rec.SKIP = oldp
    def test_names_uses_table(self):
        src = open(os.path.join(ROOT, 'tools', 'record-announcer.py')).read()
        names = src.split("elif cmd == 'names':")[1].split('elif cmd')[0]
        self.assertIn('load_respell()', names); self.assertIn('text=name_text(', names)
    def test_floor_override(self):
        old = rec.remaining
        try:
            rec.remaining = lambda: 305
            ran = []
            def j(): ran.append(1)
            j.chars = 20
            self.assertEqual(rec.run_batches([j] * 3, lambda x: 10), (0, True))
            self.assertEqual(rec.run_batches([j] * 3, lambda x: 10, 250), (3, False))
            self.assertEqual(len(ran), 3)
        finally:
            rec.remaining = old

if __name__ == '__main__': unittest.main()
