# M0 completion report (2026-10-16)

## Done
- Repo created and pushed: github.com/Stephen-Ch/pastimerivals. GitHub Actions CI builds and runs tests on every push (first run passed).
- Solution layout: Engine, Pipeline, Api, plus Engine.Tests and Api.Tests.
- `/api/health` endpoint returns status and engine version. Live on staging: https://lessonwriter-001-site12.ltempurl.com/api/health returns `{"status":"ok","engineVersion":"0.1.0"}`.
- SmarterASP has the .NET 10 runtime, so the small framework-dependent publish works (no 107 MB self-contained build needed).
- Push script (`tools/push.ps1`), FTPS deploy script (`tools/deploy.py`), backup bundles after each commit in `../_backups/`.

## Tests
- 2 tests, both passing locally and in CI.

## Found and fixed
- Temporary URL is ltempurl.com (lowercase L), not itempurl.
- Error 500.34: the shared app pool mixes hosting models. Fixed by publishing out-of-process (`AspNetCoreHostingModel=OutOfProcess`) and recycling pool lessonwriter-001.

## Known gaps and changes to the plan
- Deploys run through Stephen's Beyond Compare FTP session for now; the PC shell's network allowlist only passes web traffic, so FTP (port 21) and SQL Server (port 1433) cannot be reached from it.
- Consequence for M1: the stats database cannot be loaded over a direct SQL connection. Proposed: a key-protected HTTPS import endpoint on the server (decision D22, needs approval).
- Angular app scaffold moved from M0 to the start of M3 to keep M0 small.
