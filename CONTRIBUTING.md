# How work is done here

1. Every change follows the approved plan (`../planning/09-BUILD-PLAN.md`). New scope needs a plan update and a hostile review first.
2. Small steps on a branch. Write the test first, see it fail, then write the code.
3. All tests pass before a commit. No commit with failing tests.
4. After each commit, write a backup bundle to `../_backups/`.
5. Each milestone ends with a completion report: what changed, test output, known gaps.
6. Never put passwords or keys in the repo. They live in `secrets/` (git-ignored) on Stephen's PC.
7. Do not modify the 2017 legacy folders.
