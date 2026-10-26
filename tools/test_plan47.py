"""Plan 47 tests (recorder and name priority). Run from the repo root: python3 -m unittest tools/test_plan47.py"""
import csv, importlib.util, os, unittest
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

if __name__ == '__main__': unittest.main()
