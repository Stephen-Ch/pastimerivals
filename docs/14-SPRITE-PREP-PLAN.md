# 14: Sprite sheet prep (v1, for hostile review)

Goal: turn the AI-made 8-panel strips (art/source/pitcher, art/source/batter; 2172x724, white background, figures not evenly spaced) into clean, uniform sprite sheets the app can step through.

Tool: tools/slice-sprites.py (Python + Pillow, offline; touches only art/). App code is not changed in this plan.

Steps per strip:
1. Background: pixels near white (all channels > 235) and connected to the image edge become transparent (flood fill from edges, so white uniform parts inside the outline are kept). Soft 1px edge to avoid halos.
2. Find the 8 figures: column profile of non-transparent pixels; split at the 7 widest empty gaps. Fallback when gaps are not clean (feet or the mound touching): split at the 7 lowest-coverage columns nearest the even 1/8 marks. A strip that does not yield exactly 8 is reported and skipped, never guessed.
3. The mound: keep it (it anchors the pose); crop every frame at the same baseline. Mounds that join neighbouring panels are split by the same column cuts as the figures.
4. Align: each frame placed in an equal cell (same width and height for every frame of every sheet, e.g. 300x450), bottom-anchored on the mound/feet baseline, horizontally centered on the planted foot region (bottom 10% centroid) so the body does not jitter left/right.
5. Scale: one scale factor per strip (from the tallest frame), so figures keep their relative size.
6. Output: art/sprites/{role}/{era}-{tone}.png (8 cells in a row, transparent, plus a 2x version), and art/sprites/{role}/{era}-{tone}.json (cell size, frame count, frame names: set, hands-up, kick, peak, stride, cock, release, follow; batter: stance, load, stride, swing, contact, follow, take, bail).
7. Left-handers: mirrored at runtime with CSS, not new files.
8. A contact sheet (art/sprites/_check.png) with all frames on a checkerboard and a red baseline, for my visual check and Stephen's.

Checks: every output has 8 frames; cell size identical across all sheets; no frame touches its cell edge (cropping); baseline row identical; visual check of the contact sheet.

Out of scope: matchup portraits (crop borders later), app animation code (separate plan), more skin tones.

## v2 changes from hostile review (binding)
1. Background: edge-connected near-white becomes transparent, plus enclosed near-white pockets only if they are flat pure white (mean > 248, almost no variation), so shaded cream/white uniforms survive. Checked on the contact sheet.
2. Splitting: connected pieces are found on the area above the mound band; small detached pieces (the ball) join the nearest figure. Exactly 8 main figures or the strip is skipped and reported.
3. Mound: removed (tan pixels in the bottom band below the shoes); the scene already draws its own mound, so no flicker from cut mound edges.
4. Horizontal anchor: centre of the torso band (20-50% of figure height), which moves least between frames.
5. Scale: one factor per role across all strips, fitting both width and height, so every era's figure is the same size.
6. No 2x output; cells stay at or below source resolution.
7. Defringe edge pixels (remove white matte).
8. Add an animated GIF preview at 100 ms per strip for the jitter check.
