# Relay placement and physical routes

This investigation keeps the Field View and `frontier-bfs-v1` policy unchanged.
Only the selected relay site varies within each scenario comparison. The
original `three-branches-candidate` is the control; the fixture and any authored
variants remain outside the app.

## Hypotheses recorded before runs

**Mechanism fixture.** Scouts A and B begin two cells apart, beyond direct
communication range one. At relay site B, the relay at (1,2) should join them
in one component on tick one. B's eastward scan can tell A about terrain behind
A's east-facing scan. At site A, that exchange cannot occur. The extra fact may
change A's first physical move. Site C connects only the third scout initially.
This is a test of relay-mediated planning, not a claim about efficiency.

**Candidate variant 1 — west-room bridge.** Preserve the original 25 × 16
terrain, place Scouts A and B two cells apart in its west room, and use range
one. Site B sits between them, while sites A and C remain at the original
central and southeastern relay positions. This transposes the fixture's
tested geometry into the authored map: B's eastward scan should resolve A's
unseen west-side frontier before A's tick-one plan, so site B may change A's
physical route. The surrounding walls may instead make the first steps the
same. This variant tests route sensitivity, not improved coverage or fewer
duplicates.

## Reproduce

From the repository root, run `npm run investigate`. The command runs the
unchanged control, the small fixture, and the single authored variant. For
every relay site it repeats the run and compares serialized full states,
metrics, and hashes. It then compares scout **positions** at matching ticks;
target, heading, intent, and hash differences do not count as physical routes.

## Results

Every row compares A/B/C on the same terrain, spawns, headings, range, policy,
and tick cap. Only relay site changes within a scenario. Coverage is the
percentage of reachable clear cells known at the cap; duplicates count
multiple source discoveries of terrain, including walls.

| Scenario | Cap | Relay site | Fleet % | Relay % | Tick to 90% | Duplicates |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Original control | 160 | A | 100.00 | 41.29 | — | 432 |
| Original control | 160 | B | 100.00 | 100.00 | 50 | 432 |
| Original control | 160 | C | 100.00 | 100.00 | 38 | 432 |
| Mechanism fixture | 12 | A | 100.00 | 0.00 | — | 68 |
| Mechanism fixture | 12 | B | 100.00 | 94.29 | 3 | 68 |
| Mechanism fixture | 12 | C | 100.00 | 80.00 | — | 68 |
| West-room variant | 160 | A | 100.00 | 28.79 | — | 530 |
| West-room variant | 160 | B | 100.00 | 79.55 | — | 743 |
| West-room variant | 160 | C | 100.00 | 69.32 | — | 608 |

Each entry below gives a scout's first different-position tick and total
number of different-position ticks. Reconvergence means the positions match
again at that tick; a later interval may diverge again.

| Scenario / sites | Position differences at matching ticks |
| --- | --- |
| Original A–B, A–C, B–C | None for any scout through tick 160. |
| Fixture A–B | Scout A: first tick 1, 3 ticks apart, reconverges at tick 4. B/C identical. |
| Fixture A–C | None through tick 12. |
| Fixture B–C | Scout A: first tick 1, 3 ticks apart, reconverges at tick 4. B/C identical. |
| Variant A–B | A: tick 1, 158 ticks apart, briefly rejoins at 2 and 102; B: tick 4, 156 ticks apart, rejoins at 74; C: tick 34, 127 ticks apart. All three are apart at cap. |
| Variant A–C | A: tick 81, 80 ticks apart; B: tick 19, 99 ticks apart, rejoins at 38 and separates again at 81; C: tick 34, 127 ticks apart. All three are apart at cap. |
| Variant B–C | A: tick 1, 158 ticks apart, briefly rejoins at 2 and 85; B: tick 4, 156 ticks apart, rejoins at 74; C: tick 70, 91 ticks apart. All three are apart at cap. |

The original candidate has a real information difference but no route
difference. On tick 56 Scout A discovers blocked cell (0,9). With relay B,
both scouts join the relay's component and Scout B receives that fact before
planning; with relay A, they are disconnected and B receives it at tick 57.
B had retained (0,9), so its target changes to (0,3) at site B. At both sites,
however, B is at (4,10), heads north, chooses a north move, and reaches (4,9).
The two targets share that first corridor step. No later position differs.
The policy retains an unknown target while it remains reachable; new facts
need to change that target or its path to redirect movement. Here the extra
fact invalidated the target in time, but both plans still chose north. Site A
received the fact on tick 57, and no later position differs. The 432 duplicate
discoveries also remain identical.
The earlier range-changing planner test is separate evidence that knowledge
can affect planning; it does not establish a relay-placement effect.

## Causal trace for the route-changing variant

The west room of the original terrain, cropped to row 2 at tick zero:

```text
x         1  2  3  4  5  6  7
row 2     .  B  R  A  .  .  .
heading      →     →
```

Scouts A and B both start facing east at (4,2) and (2,2). At range one they
cannot contact each other directly. On tick one, B's normal eastward scan
observes (3,2) as clear; A's scan does not see that cell. Relay site B at (3,2)
has direct links to both scouts, so component exchange gives A B's record
(`sourceId=scout-b`, discovered and received at tick 1) **before** A plans.
At site A, neither scout links to the relay, and (3,2) stays unknown to A.

| Relay site | A's tick-one knowledge of (3,2) | Target | Intent and physical move |
| --- | --- | --- | --- |
| A | Unknown | (3,2) | West, (4,2) → (3,2); heading becomes west. |
| B | Clear from Scout B via relay | (4,0) | North, (4,2) → (4,1); heading becomes north. |

At tick two both are at (3,1), but their headings differ (north versus west).
Heading changes subsequent scans; by tick three their positions separate
again. Thus the tick-one exchange causally establishes the first route
difference, while later differences include downstream sensing and retained
target effects. It would overstate the trace to attribute every later move
to that single cell without a separate counterfactual study.

A **planner-only** counterfactual in the regression test strengthens the
first-turn attribution: adding just B's actually observed (3,2)=clear fact to
the isolated A map changes its intent west→north; removing just that fact from
the bridged A map changes north→west. Neither natural simulation run is edited
or seeded with privileged terrain for this check.

The variant demonstrates route sensitivity, **not improved exploration**:
fleet coverage is 100% at every site by tick 160. Site B has more relay
knowledge than A, but also more duplicate discoveries (743 versus 530);
none of the sites reaches 90% relay coverage. It has not been promoted into
the app.

An independent read-only review reproduced the results and found no causal,
hidden-information, or reproducibility defect. It specifically checked that
the scan/exchange order and one-cell counterfactual support the first-turn
claim, while later path differences are presented as downstream effects.

## Decision for review

Visually review the west-room variant as a separate next step before deciding
whether its route differences are an appealing portfolio behavior. Keep the
current app scenario and Field View unchanged until that review.
