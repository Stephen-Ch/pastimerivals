# M2 completion report (2026-10-16)

## Done
- Engine (`src/PastimeRivals.Engine`, engine version 0.1.0), server-side C#:
  - Eight outcomes (K, BB, HBP, 1B, 2B, 3B, HR, out in play), always summing to 1.
  - Shrinkage toward the player's own league with per-outcome constants (02 section 3.4), rescaled after shrinking.
  - Rate-ratio matchup against a neutral 1990 to 2019 environment (D4), with a soft limit on extreme ratios (threshold 2.5, power 0.5).
  - Platoon: each player's real same-hand exposure is divided out using his own era's factors; the matchup's handedness is applied once using neutral-era factors.
  - SplitMix64 seeded random generator written out in code, golden value cross-checked with an independent Python version.
  - Explanation steps for every outcome (observed, shrunk, league, ratio, platoon, final).
  - StatsCatalog turns pipeline rows into engine inputs; traded players get a PA-weighted league; zero-PA seasons are not selectable.

## Tests
- Engine 20, Pipeline 49 (incl. era checks on real data), Api 7: all passing.
- Identity (average vs average = neutral), sum to 1, Monte Carlo (200,000 draws within 0.4 points), determinism, golden vector.
- Era checks: Ruth 1920 above Ruth 1927 on HR; Bonds 2001 more than twice average; Ruth 1927 under 15% HR; Pedro 1999 strikes Ruth out over 1.5x as often as an average pitcher and allows fewer HR.

## Backtest (log loss per plate appearance, lower is better)
Predicting real plate appearances from each player's earlier season.

| Test | League average | Model, no era adjustment | Model |
|---|---|---|---|
| Same era, 2016 to 2024 from prior season | 1.49391 | 1.47636 | **1.47531** |
| Era shift, 1993 to 2001 from 4 seasons earlier | 1.46206 | 1.44983 | **1.44757** |
| Dead ball to live ball, 1920 to 1925 from 4 earlier | 1.24229 | 1.24887 | **1.23361** |
| Mound lowered, 1969 to 1972 from 4 earlier | 1.36654 | 1.36053 | **1.35205** |

The improvement over league average (about 0.017 in the same-era test) is the same size published studies report. Across big environment changes, ignoring the era makes predictions worse than plain league average, while the era-adjusted model still wins. This is the best available evidence for the product's core claim.

## Findings for Stephen
- Cravath 1915 comes out level with Ruth 1927 on home run odds. Cravath hit 7.5 times his league's home run rate, walked far less, and faced mostly same-hand pitchers. That is the era-relative model doing its job, but fans may question it; the explanation panel should show the "times his league" number.

## Deferred
- Comparing the odds-ratio and tree forms (planned in T2.6) is not done; the rate-ratio form already clears every test. Revisit if calibration problems show up.
- Shrinkage and soft-limit constants are untuned starting values.
