"""Plan 55: tests for the SABR rules. python3 tools/test_tone_sabr.py"""
import importlib.util, json, os, tempfile, csv
spec = importlib.util.spec_from_file_location('ts', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tone-sabr.py'))
ts = importlib.util.module_from_spec(spec); spec.loader.exec_module(ts)

# blocking words and team-name cleaning
assert ts.blocked('He played for the Chicago White Sox and the Cuban Stars.') == []
assert ts.blocked('His mother was part Cherokee.') == ['cherokee']
assert ts.blocked('The family was of Portuguese descent.') == ['portuguese']
assert ts.blocked('He hit .300 for the Cleveland Indians.') == []
assert ts.blocked('His grandmother was an American Indian.') == ['american indian']
assert ts.blocked('{"mejs.spanish":"Spanish","mejs.japanese":"Japanese"} He was born in Ohio.') == []
assert ts.blocked('He served in the Korean War and survived the Spanish flu, then played for Sioux City.') == []
assert ts.blocked('Research on ancestry.com shows the family arrived in 1880.') == []
# sentences need a heritage word; team-only matches are dropped
assert ts.sentences('He signed with the White Sox in 1950. He was traded later.') == []
s = ts.sentences('He grew up in Ohio. His parents were of Polish ancestry. They ran a store.')
assert len(s) == 1 and 'Polish ancestry' in s[0] and 'Ohio' in s[0] and 'store' in s[0], s
assert ts.has_tone_word('both of Italian ancestry') and not ts.has_tone_word('He signed with the Chicago White Sox')
assert ts.has_tone_word('He was an African American outfielder')
# answer check: whole family, tone word in the quote
assert ts.ok_answer({'whole_family': 'yes', 'art': 'light', 'quote': 'The family was of English, Irish and Scottish ancestry.'})
assert not ts.ok_answer({'whole_family': 'no', 'art': 'light', 'quote': 'A great-grandfather was of Italian descent.'})
assert not ts.ok_answer({'whole_family': 'yes', 'art': 'light', 'quote': 'He was born in Ohio.'})
# identity: name compare ignores accents and case
assert ts.norm('José Peña') == ts.norm('Jose Pena')

# agreement rule and control throw-out
d = tempfile.mkdtemp(); ts.CACHE = d; ts.TONE = d
rv = {'p1': {'name': 'P One', 'url': 'u1', 'sentences': ['His parents were of German ancestry.']},
      'p2': {'name': 'P Two', 'url': 'u2', 'sentences': ['The family was of Irish descent.']},
      'p3': {'name': 'P Three', 'url': 'u3', 'sentences': ['A grandfather was Swedish.']}}
json.dump(rv, open(os.path.join(d, 'review-main.json'), 'w'))
json.dump({'c1': {'name': 'C', 'url': 'c', 'sentences': ['x']}}, open(os.path.join(d, 'review-controls.json'), 'w'))
json.dump({'controls': {'c1': 'light'}, 'plan': {'A': [{'packet': 'packet-A01.txt', 'cells': ['p1', 'c1', 'p2', 'p3']}],
                                                  'B': [{'packet': 'packet-B01.txt', 'cells': ['p3', 'p2', 'c1', 'p1']}]}}, open(os.path.join(d, 'packets.json'), 'w'))
L = lambda q, art='light', wf='yes': {'whole_family': wf, 'art': art, 'quote': q}
a = {'packet-A01.txt': {'1': L('His parents were of German ancestry.'), '2': L('x'), '3': L('The family was of Irish descent.'), '4': L('A grandfather was Swedish.', wf='no')}}
b = {'packet-B01.txt': {'1': L('A grandfather was Swedish.'), '2': L('The family was of Irish descent.', art='blank'), '3': L('x'), '4': L('His parents were of German ancestry.')}}
json.dump(a, open(os.path.join(d, 'A.json'), 'w')); json.dump(b, open(os.path.join(d, 'B.json'), 'w'))
out = {o['id']: o['tone'] for o in ts.decide(os.path.join(d, 'A.json'), os.path.join(d, 'B.json'))}
assert out == {'p1': 'light'}, out
b['packet-B01.txt']['3'] = L('x', art='darkbrown')   # control given the opposite tone: whole packet thrown out
json.dump(b, open(os.path.join(d, 'B.json'), 'w'))
assert ts.decide(os.path.join(d, 'A.json'), os.path.join(d, 'B.json')) == []
print('tone-sabr tests ok')
