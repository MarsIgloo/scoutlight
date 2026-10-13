# Historical local verification

M3A local verification (2026-09-21): `npm run check` passed strict types and
356 tests in 19 files; `npm run build` and `npm run experiment` passed. The
browser was inspected at 1440 × 900 and 1024 × 768. Manual checks covered
start/pause/step, keyboard guards, pace changes, repeated resets, site changes,
knowledge and layer switching, selecting all three overlapping scouts, and a
complete 4× run. A/B/C terminal metrics matched the experiment; the browser
console showed no errors. Reduced-motion behavior is implemented but was not
emulated in the browser check. The build emits a bundle-size warning for Pixi;
it is not a build failure.

An independent read-only review of the runnable artifact scored functionality
**9/10**, simulation correctness/readability **9/10**, interaction **8/10**,
and visual design **8/10**, passing the requested 8/8/6/6 thresholds. The
reviewer checked browser stepping, sensing, map-view changes, layer toggles,
site reset, map selection, layout, and the automated checks. Browser keyboard
behavior was verified separately during local review, not claimed as part of
their visual audit.

Field View refinement (2026-09-22): `npm run check` passed strict types and
357 tests in 19 files, including a focused regression for Space on the
inspector disclosure. `npm run build` and `npm run experiment` passed, with
the candidate's A/B/C results and identical movement sequences unchanged.
At 1440 × 900 and 1024 × 768, browser checks covered initial, exploring,
paused, expanded-inspector, overlapping-scout, and completed views; relay
selection, stepping, knowledge and layer controls, all speed buttons,
keyboard guards, and reset were exercised. A **timed** 4× Relay A run reached
tick 160 with 100.0% fleet and 41.3% relay coverage, 58.7 pp delivery gap,
432 duplicates, and 2.5% / 10.6% / 0.0% connectivity, matching the experiment
after UI rounding. The 1024px canvas host is 772px wide versus approximately
690px in the previous two-column layout; at 1440px it is 1114px versus
approximately 1064px. The extra width and reduced Pixi inset increase the
map's usable area. The production build still reports a Pixi bundle-size
warning; it is not a build failure.

An independent read-only review of the **Field View running artifact** scored
functionality **9/10**, simulation correctness/readability **9/10**,
interaction **8/10**, and visuals **8/10**. The reviewer observed both viewport
sizes, a timed 4× completion, knowledge switching, relay reset, overlap
selection, the disclosure keyboard guard, and the expanded compact inspector.
That review identified secondary text and scroll depth in the 1024px rail;
the later simplification pass below addresses the default layout. Reduced-motion
behavior remained source-reviewed in that pass:
the available browser controls did not expose preference emulation, so a
runtime reduced-motion result is not claimed.

Field View simplification (2026-09-22): `npm run check` passed strict types and
359 tests in 20 files, including two focused inspection-state tests;
`npm run build` and `npm run experiment` passed. The production bundle still
reports the Pixi size warning. Browser review at 1440 × 900 and 1024 × 768
covered initial, running, paused, expanded-details, scout-selected, and
completed states. It exercised site reset, Step, 4× timed playback, knowledge
switching, layer toggles, dismissal, the overlap-safe scout picker, and Space
on a disclosure without starting playback. A timed Relay A run again ended
at tick 160 with 100.0% explored, 41.3% received by relay, and 432 duplicates;
the experiment retained exact A/B/C results and identical movement sequences.
At 1024px, the canvas host grew from 511px to 665px high; at 1440px, from
617px to 788px. The map itself remains width-limited at compact desktop sizes.
Essential controls fit without rail scrolling, while expanded secondary details
scroll within the lower rail. Canvas styling and effects were not changed.

West-room review integration (2026-09-23): `npm run check` passed strict types
and 369 tests in 23 files; `npm run build`, `npm run experiment`, and
`npm run investigate` passed. New runner tests compare complete 160-tick
histories, scout positions, hashes, and metrics with headless runs at all three
variant relay sites, and check fresh-run isolation. Browser checks at
1440 × 900 and 1024 × 768 covered the opening A/B ticks, paused details,
knowledge switching, scout selection, normal playback, and completed views.
Timed 4× Relay B playback reached tick 160 at both sizes with 100.0% explored,
79.5% received by relay, and 743 duplicates, matching the investigation after
UI rounding. The normal development URL and an unknown review parameter still
show the original app. A production preview with `?review=west-room` also
showed the original Scout A spawn at (2,2) and no review label. No browser
console errors were observed. The first route difference is one grid cell and
can be easy to miss while moving; the relay-knowledge difference is more
immediately visible. This review tests appeal, not improved exploration.
An independent live reviewer scored functionality **9/10**, simulation
correctness/readability **8/10**, interaction **8/10**, and visual design
**8/10**. The reviewer confirmed both viewport sizes and a timed 4× completion.
The bridge link is thin beside the sensor rays, so the route's cause is hard
to infer without opening Help; later single-run motion does not explain the
relay effect on its own.

Seeded-mission review (2026-09-27): `npm run check` passed strict types and
393 tests in 25 files. The production build, original experiment, route
investigation, and `npm run missions:sample` passed. Tests cover connected
terrain, distinct clear starts/sites, boundary seeds, real terrain diversity,
repeat full histories and metrics, playback-speed independence, URL fallback,
and fresh mission/reset isolation. At 1440 × 900 and 1024 × 768, live checks
covered three preselected maps, Relay/Fleet/scout knowledge, site changes,
Reset, and New map during playback. A timed 4× run of seed 12345 at Relay A
finished at tick 160 with 100.0% explored, 45.7% received by relay, and 529
duplicates, agreeing with the headless run after UI rounding. Invalid URL
input displayed the default label and corrected the URL. The normal and
west-room development URLs retained their modes; a production preview with a
missions URL showed the original Scout A spawn at (2,2). No browser console
errors were observed. The three layouts are visibly different in division
positions and doorway placement, but all share one six-room visual grammar.
An independent live review scored functionality **9/10**, simulation
correctness/readability **8/10**, interaction **8/10**, and visual design
**8/10**. The reviewer stepped the same three seeds at both sizes and confirmed
a timed 4× completion. The map variety is visible after sensing, but Relay
terrain can look nearly empty even when Fleet is well explored (at tick 20
on seed 4294967295, Relay showed 0.0% and Fleet 77.9%). The longest seed wraps
to two lines at 1024px, and thin sensor/link geometry takes attention to read.

Readable exploration and communication (2026-09-28): Fleet now starts selected
in the normal app and both development-only reviews. New map also starts in
Fleet; Reset and relay changes preserve the current view and inspection. The
inspection reducer remembers the last Relay/Fleet choice when a Scout view is
closed or another scout is selected. Links now draw above sensor effects and
below markers, with a restrained dark keyline and neutral stroke; rays remain
scout-colored but secondary. Neither projection nor simulation geometry changed.
`npm run check` passed strict types and 394 tests in 25 files; the build,
original experiment, route investigation, and fixed mission sample passed
with their prior outcomes. Matching west-room Relay B tick-one Fleet views
were compared at 1440 × 900 and 1024 × 768. Live checks covered initial Fleet,
both restoration paths, repeated scout selection, reset/site retention, New
map, layer toggles, and 1×/4× playback. A timed 4× seed-12345 Relay A run
finished at tick 160 with 100.0% explored, 45.7% received, and 529 duplicates,
matching the fixed sample after rounding. The current browser reported reduced
motion off; its alternate behavior was source-reviewed but not runtime-emulated.
An independent live reviewer scored functionality **9/10**, correctness and
readability **9/10**, interaction **8/10**, and visuals **8/10**. The reviewer
found no hidden-terrain leak, incorrect link anchors, replay regression, or
browser error. Links are easier to distinguish at both sizes, though fine
geometry remains harder to read at 1024 × 768. The west-room route cause still
benefits from Help or a walkthrough; clearer links alone do not explain it.

Synchronized A/B review (2026-09-28): `npm run check` passed strict types and
405 tests in 26 files; build, original experiment, route investigation, and
fixed mission sample passed with unchanged outcomes. Paired tests compare full
states, hashes, and metrics against independent headless runs for the original
candidate, west-room variant, and seeds 0 and 12345. The original A/B routes
remain identical; west-room Scout A is at (3,2) with A and (4,1) with B at
tick one. Live checks at 1440 × 900 and 1024 × 768 covered A/B switching,
Fleet/Relay/Scout views, inspector and Help, shortcuts, reset during playback,
New map, and both completed states. A timed 4× paired seed-12345 run ended at
tick 160: A explored 100.0% and received 45.7% (529 duplicates); B explored
100.0% and received 100.0% (515 duplicates), matching headless results after
rounding. New map retained `compare=ab` with fresh tick-zero histories; the
normal development URL and production preview with review parameters both
showed the original single-run interface. An independent live reviewer scored
functionality **9/10**, correctness/readability **9/10**, interaction **8/10**,
and visual design **8/10**, with no blocking defects observed. The reviewer
found the wide A/B table small and distant from the shared tick; one spacing
and type adjustment brought it closer, and both sizes were visually checked
again. The comparison shows consequences at matching ticks but does not
explain their cause automatically.


## Opt-in release preview — October 12, 2026

The following report is preserved verbatim from the README before default promotion.

Release-preview verification (2026-10-12): the seeded timed-playback test now
runs as separate 1×, 2× and 4× cases with the original full-history, metrics,
completion and timer assertions and the same 30-second per-case budget. The
baseline full check passed **407 tests in 26 files**. With fixed published-v1
references and preview URL/selection regressions, the final check passed
**415 tests in 26 files**. Check, build, experiment, investigate and mission
sample ran sequentially and passed. Generator v1 and engine rules are unchanged.
The production build retains the existing Pixi bundle-size warning.

The built preview was exercised at **1440 × 900** and **1024 × 768**: direct
links and refresh, fallback canonicalization, mode changes during playback
and after completion, New map, Reset, A/B switching, Relay/Fleet/scout knowledge,
inspector and keyboard focus/activation. Essential controls fit without page
scrolling; expanded secondary information scrolls inside the rail. Timed 4×
paired seed-12345 runs reached tick 160 at both sizes. Both explored 100%;
A received **45.71% with 529 duplicates**, B received **100% with 515 duplicates**,
matching headless results (the UI displays 45.7%). The large run was observed
complete 37 seconds after Start; this is an observation bound, not an exact
completion-duration measurement. Production legacy review/comparison URLs
had the same initial control DOM as `/`; the development default matched it,
and the legacy mission/west-room reviews retained their behavior. West-room
Scout A remained at (3,2) with A and (4,1) with B at tick one. Investigation
confirmed the original candidate's physical routes remain identical. No
browser errors were observed in the tested tabs.

Independent reviews scored functionality **8.5/10** and correctness/readability
**9/10** from source/tests, and interaction **8.5/10** and visuals **8.5/10**
from a separate live production-preview review at both desktop sizes. Reviewers
found no blocking mixed histories, information leaks, stale clocks or replay
defects. No visual refinement was needed. Long secondary connectivity telemetry
remains a minor readability limit when expanded.

Reduced-motion handling was source-reviewed; available browser capabilities
offered viewport control but no motion-preference emulation, so runtime
reduced-motion verification remains a gap. Desktop sizes below 1024 × 768,
other browser engines, deployment and public-default promotion remain outside
this milestone. Comparison shows consequences and does not establish better
exploration or explain causes automatically.

