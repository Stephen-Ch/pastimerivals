"""Plan 53: tests for the category rule and the mixed-heritage check. python3 tools/test_tone_wiki.py"""
import importlib.util, os
spec = importlib.util.spec_from_file_location('tw', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tone-wiki-lookup.py'))
tw = importlib.util.module_from_spec(spec); spec.loader.exec_module(tw)

assert tw.is_hit(['African-American baseball players', 'Boston Red Sox players']) == 'African-American baseball players'
assert tw.is_hit(['21st-century African-American sportsmen', 'Major League Baseball outfielders', 'Chicago Cubs players']) is None   # v1.2: exact category only
assert tw.is_hit(['21st-century African-American sportsmen', 'American football running backs']) is None   # no baseball-players category
assert tw.is_hit(['History of African-American baseball']) is None
assert tw.is_hit(['Major League Baseball players from the Dominican Republic', 'Boston Red Sox players']) is None   # birthplace never sets a tone
assert tw.mixed('He was born to an African-American father and a white mother.') == ['parent sentence: white', 'white mother']
assert tw.mixed('Biracial outfielder') == ['biracial']
assert tw.mixed('An American baseball player.') == []
assert tw.mixed('His father is African-American and his mother is Japanese.') == ['parent sentence: japanese']
assert tw.mixed('His father worked in a steel mill.') == []
info = {'cit': ['Q786'], 'items': ['Q1']}
assert tw.latin(info, []) is True
assert tw.latin({'cit': ['Q30']}, ['Major League Baseball players from Puerto Rico']) is True
assert tw.latin({'cit': ['Q30']}, ['Boston Red Sox players']) is False
print('tone-wiki tests ok')
