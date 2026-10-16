# M1 completion report (2026-10-16)

## Done
- Source: Retrosheet yearly CSVs for 1901 to 2025 (125 zips, 719 MB, SHA-256 sums in data/raw/SHA256SUMS.txt), Retrosheet biofile and TEAMABR. Commercial use allowed with the Retrosheet credit line.
- Pipeline (`src/PastimeRivals.Pipeline`, C#):
  - `build`: player-season tables for batters (100,662) and pitchers (46,584), league-season tables (AL, NL, FL; 504 rows), people (19,278).
  - League batting norms exclude pitchers batting; pitching norms use every batter faced.
  - Traded players are one season with plate appearances split by league.
  - Unknown strikeouts tracked per game; missing batters faced estimated as outs + H + BB + HBP.
  - Quality grades: A (play-by-play for 90%+ of games), B (box scores), C (estimated or missing fields). Batters A 91,221 / B 5,832 / C 3,609; pitchers A 43,363 / B 2,629 / C 592.
  - `platoon`: outcome counts by same-hand vs opposite-hand matchup per season, plus each player's same-hand exposure (126,023 rows), from play-by-play.
  - Validation report: 0 red, 16 amber (docs/reports/M1-validation.md). Amber items are early-1900s strikeout gaps and small batter vs batters-faced gaps in years with estimated batters faced.
- Hand-checked seasons (all within 2 of official totals): Ruth 1927, Gehrig 1927, Williams 1941, Mantle 1956, Bonds 2001, Ohtani 2023 (batting); Pedro 1999, Koufax 1965, Gibson 1968, W. Johnson 1913 (pitching). Retrosheet differs from official totals by 1 or 2 in a few cells (e.g. Ruth 1927 K 90 vs 89).
- Loaded into SQL Server through the key-protected import endpoint; every table's row count matches its file.

## Tests
- 55 tests passing (Pipeline 47, Api 7, Engine 1). Golden-season tests run only where raw data exists (Stephen's PC).

## Decisions taken during M1 (need Stephen's sign-off)
- D22: stats are loaded through a key-protected HTTPS import page, because the build PC cannot reach SQL Server's port.
- D23: Retrosheet is the main source for all years, replacing Lahman. Lahman's download is on Box (not reachable) and its license is unconfirmed; Retrosheet's terms are clear and its counts matched official totals in every hand check. Seasons before 1901 are left out.
- D24: park factors are cut from v1 (the plan named them first to cut). The sim plays in a neutral park.

## Known gaps
- Federal League 1914 to 1915 is included as a major league; Negro Leagues excluded (D7).
- Platoon data before about 1910 is thin; the engine should borrow factors from later years.
- `secrets/deploy.local.json` now also holds the import key.
