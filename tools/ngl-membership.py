"""Plan 41: builds data/ngl/membership.csv (season, team, league, games) from Retrosheet's Negro Leagues season pages.
Pages: https://www.retrosheet.org/NegroLeagues/<year>Season.htm, 1933-1948. Only the two leagues the game covers:
"Negro National League" (second NNL, code NN2) and "Negro American League" (NAL). games = regular-season W+L+T.
Usage: python3 tools/ngl-membership.py <pagesDir> data/ngl/membership.csv"""
import re, sys, os, csv
LEAGUES = {'Negro National League': 'NN2', 'Negro American League': 'NAL'}
def parse(path, year):
    rows, league = [], None
    for line in open(path, encoding='latin-1'):
        h = re.search(r'<b>([^<]+)</b></td></tr>', line)
        if h:
            league = LEAGUES.get(h.group(1).strip()); continue
        if 'All Games' in line and 'Regular-Season' not in line and '<b>' not in line: league = None
        m = re.search(r'href=\./boxesetc/%d/T([A-Z0-9]{3})0%d\.htm>([^<]+)</a></td><td>(\d+)</td><td>(\d+)</td><td>(\d+)</td>' % (year, year), line)
        if m and league:
            code, name, w, l, t = m.group(1), m.group(2), int(m.group(3)), int(m.group(4)), int(m.group(5))
            rows.append((year, code, league, w + l + t, name))
    return rows
def main(pages, out):
    allrows = []
    for y in range(1933, 1949):
        r = parse(os.path.join(pages, f'{y}.htm'), y)
        print(y, {lg: sum(1 for x in r if x[2] == lg) for lg in ('NN2', 'NAL')})
        allrows += r
    with open(out, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['season', 'team', 'league', 'games', 'name'])
        w.writerows(allrows)
if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
