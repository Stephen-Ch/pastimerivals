"""Plan 47 B3: turns data/audio/pools.csv (exported by PoolsExportTests from the API's own pool code) into
data/audio/name-priority.csv (rank,id,voice,tier,weight): the order the recorder makes name clips in.
Draw weight of a season in a pool = 1 / (live eras * seasons in its era) (Rules.DrawRandom: random era, then random season).
Pools counted: level 1 twice (computer level 1 + quick pick), level 2 twice (random matchup + computer level 2), levels 3 and 4 once.
Modern clip: weight of all the player's pool seasons. Classic clip: only seasons before 1960; only players with a pre-1960 season get one.
Tier 1: first-visit pair, both Top50 lists, level 3 and 4 pools, Test 2 players. Tier 2: level 2 pools. Tier 3: rest of level 1.
Tier 4: everyone else in people.csv, by career plate appearances plus batters faced.
Usage (repo root): python3 tools/name-priority.py"""
import csv, json, os, re
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')
FIRST = ['martp001', 'ruthb101']
MULT = {1: 2, 2: 2, 3: 1, 4: 1}
CLASSIC_BEFORE = 1960

people = {r['id']: f"{r['first']} {r['last']}" for r in csv.DictReader(open(os.path.join(D, 'outall', 'people.csv'), encoding='utf-8'))}
career = defaultdict(int); pre = set()
for f in ('batters.csv', 'pitchers.csv'):
    for r in csv.DictReader(open(os.path.join(D, 'outall', f), encoding='utf-8')):
        career[r['id']] += int(r['pa'] or 0)
        if int(r['year']) < CLASSIC_BEFORE: pre.add(r['id'])

w = {'modern': defaultdict(float), 'classic': defaultdict(float)}
inpool = {v: defaultdict(set) for v in w}   # voice -> id -> levels / 'top50'
for r in csv.DictReader(open(os.path.join(D, 'audio', 'pools.csv'))):
    pid, year = r['id'], int(r['year'])
    voices = ['modern'] + (['classic'] if year < CLASSIC_BEFORE else [])
    if r['list'] == 'top50':
        for v in voices: inpool[v][pid].add('top50')
        continue
    lv = int(r['level']); sw = MULT[lv] / (int(r['eras']) * int(r['era_size']))
    for v in voices:
        w[v][pid] += sw; inpool[v][pid].add(lv)

test2 = set()
rep = json.load(open(os.path.join(ROOT, '_audio', 'test2', 'report.json')))
byname = defaultdict(list)
for pid, nm in people.items(): byname[nm.replace(' ', '_').replace('.', '')].append(pid)
for v in ('classic', 'modern'):
    for k in rep.get(v, {}):
        if k.startswith('name-') and byname.get(k[5:]): test2.add(max(byname[k[5:]], key=lambda p: career[p]))

def tier(v, pid):
    s = inpool[v].get(pid, set())
    if pid in FIRST or pid in test2 or 'top50' in s or 3 in s or 4 in s: return 1
    if 2 in s: return 2
    if 1 in s: return 3
    return 4

rows = []
for pid in people:
    for v in ('modern', 'classic'):
        if v == 'classic' and pid not in pre: continue
        rows.append((tier(v, pid), 0 if pid in FIRST else 1, -w[v][pid], -career[pid], v, pid))
rows.sort()
out = os.path.join(D, 'audio', 'name-priority.csv')
with open(out, 'w', newline='') as f:
    cw = csv.writer(f); cw.writerow(['rank', 'id', 'voice', 'tier', 'weight'])
    for i, r in enumerate(rows, 1): cw.writerow([i, r[5], r[4], r[0], f'{-r[2]:.8f}'])
cnt = defaultdict(int); chars = defaultdict(int)
for r in rows: cnt[r[0]] += 1; chars[r[0]] += len(f'And now... {people[r[5]].upper()}!')
for t in sorted(cnt): print(f'Tier {t}: {cnt[t]} clips, about {chars[t]} characters')
print('Test 2 players matched:', len(test2), '| total clips:', len(rows), '| written', out)
