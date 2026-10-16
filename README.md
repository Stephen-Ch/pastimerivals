# Pastime Rivals

Baseball matchup game: pick player-seasons from any era, simulate at-bats with era-adjusted odds, challenge friends.
Live site: https://pastimerivals.com (not yet live).

## Layout
- `src/PastimeRivals.Engine` simulation math (no web or database code)
- `src/PastimeRivals.Pipeline` builds the stats database from Lahman, Retrosheet and Chadwick
- `src/PastimeRivals.Api` ASP.NET Core server, also serves the app
- `tests/` automated tests
- Planning docs: `../planning/` (01 to 09; 09 is the approved build plan)

## Commands
- `dotnet test` runs all tests
- `tools/push.ps1` (Windows) pushes to GitHub

Data credit: The information used here was obtained free of charge from and is copyrighted by Retrosheet.
