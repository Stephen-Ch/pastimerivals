# Plan 52B: server accepts the three art-note events (v1.1, BUILDABLE; v1 hostile review: 2 blockers, 4 nits, all fixed)

Why: the app already sends art_note_shown, art_note_more and art_blank_why (plans 51, 52), but POST /api/events rejects unknown names with 400, so these taps are never stored. Since plan 51/52 went live, every one of them has been lost.

## Change (one line of app code)
- src/PastimeRivals.Api/PlayEndpoints.cs: add "art_note_shown", "art_note_more", "art_blank_why" to the EventNames set. Comment: plan 52B.
- Nothing else changes: same session check, same CleanSource on source ('home', 'share', 'challenge' all pass CleanSource), same rate limit, same app_events table (name NVARCHAR(40): longest new name is 14 chars).
- App code unchanged (already sends them).

## Tests
- Test helper MemoryEvents (PlayApiTests.cs) gets the 3-argument WriteAsync and a Sources list, so a stored source can be checked [B2]. Events list unchanged, so other tests are untouched.
- PlayApiTests: new test Events_accept_art_note_names: each of the three returns 204 and is stored; art_note_shown with source "home" stores source "home". Existing "hack" -> 400 test stays.
- Full API test suite passes.

## Not in scope
- The funnel readout does not report these events (it reads only name = 'open'). They are queryable in app_events. Adding them to the readout is a later choice.

## Deploy (needs Stephen's "deploy to live")
- Server-only: dotnet publish in the cloud; ship only PastimeRivals.Api.dll, plus .pdb only if one is already live (skip it otherwise) [N6] to /pastimerivals/wwwroot on SmarterASP via File Manager. Compare: only those files differ from the last publish. Keep the old dll as a downloaded copy for undo.
- The app runs OutOfProcess (web.config), so the dll is locked [B1]. Order: upload app_offline.htm, wait about 10 s, replace the dll, delete app_offline.htm. The site shows the offline page for under a minute.
- Check after: POST /api/events with name art_note_more returns 204 (was 400). Use a session id "deploycheck-52b" so test rows are identifiable. The row is left in app_events (nothing purges it; it is one row) [N4].
- Commit on the laptop via the repo-only patch route (git apply --index, commit).

## Undo
- Same three steps (app_offline.htm, old dll, delete app_offline.htm).
