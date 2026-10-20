# Scoutlight: decentralized exploration under partial communication

Scoutlight lets a visitor run three scouts through an unknown grid, change a
fixed relay's position, and inspect how discoveries spread. A saved seed makes
the same mission repeatable; paired A/B runs show consequences at matching
ticks. The question is concrete: **what can a group explore, and what does its
relay actually receive when communication is intermittent?**

[Try the live demo](https://marsigloo.github.io/scoutlight/) · [Browse the source](https://github.com/MarsIgloo/scoutlight)

## Architecture and information boundaries

The TypeScript engine owns simulation state and tick transitions. React provides
controls; Pixi draws a projection of recorded snapshots. Separate single-run
and comparison runners own playback clocks and histories. Headless experiment
commands use the same engine and metric definitions as the browser.

Each scout begins with an unknown local map. Its forward sensor rays reveal
clear cells and walls, stopping at obstacles or the map boundary. A local map
contains that scout's sensing plus information received through communication.
The relay stores received discoveries. Fleet view is the observer's union of
scout maps; it is not a shared global map handed to every scout. Terrain
projection receives knowledge maps, not the hidden map. Scout markers, rays,
and links are explicitly observer telemetry.

A communication graph has four nodes: three scouts and the relay. An edge
requires both distance within range and unobstructed line of sight. Connected
components describe which nodes can exchange information through direct or
indirect links. The implementation shares all discoveries throughout a
component in the same tick, with no bandwidth limit or delay per hop. A
record preserves its original scout and discovery tick, and each recipient's
first receipt tick. “Relay reachable” means a path exists; it need not be a
direct scout-to-relay edge.

A tick clones the previous state, scans at pre-movement positions, records
local facts, builds that communication graph, exchanges discoveries, plans
all scouts, then applies movement. Rays and links retain their recorded
pre-movement geometry even though the snapshot also contains the scouts'
new positions. Coverage uses reachable clear cells from a separate external
evaluator; that hidden-map denominator never enters planning.

## The implemented policy

All scouts use the same handwritten `frontier-bfs-v1` rule. Breadth-first
search (BFS) walks only known-clear cells to find reachable approaches to
unknown frontier cells. A scout keeps its previous target if that target is
still a reachable frontier. Otherwise it chooses the nearest candidate.
Equal distances break ties by target cell order, then approach cell order;
equal paths follow north, east, south, west neighbor order. It moves one
cardinal cell, or stays if no frontier remains. Physics rejects blocked or
out-of-bounds movement.

The planner receives its own position, heading, local map, target, tick, and
communication metadata. It receives no hidden terrain, other scout positions,
relay map, evaluator metrics, or sensing telemetry. The current rule chooses
from the map, position, and retained target. There is no learned policy, global
assignment of targets, or guarantee of optimal exploration.

## Meaningful computer-science challenges

- **Enforcing partial knowledge:** planner inputs and rendering projections
  make information boundaries explicit, with tests against hidden-map leakage.
- **Discrete geometry:** sensing and line of sight handle exact grid corners
  conservatively; recorded origins keep overlays consistent with tick order.
- **Reproducible decisions:** stable BFS ties, canonical snapshot serialization,
  and fixed random draw order make behavior independent of playback speed.
- **Safe replay:** snapshots are deeply detached so later changes cannot mutate
  history. Tests compare complete states, histories, and metrics with headless
  runs. Small non-security hashes aid comparison; equality checks provide the
  stronger evidence.
- **Clock lifecycle:** comparison publishes two matched ticks from one clock
  while retaining separate histories. Reset and disposal invalidate pending
  callbacks; switching Viewing A/B changes only presentation.
- **Incremental observation:** playback validates each new snapshot once and
  retains discovery facts and the survey denominator per run. It stages changes
  before committing them, so rejected input cannot partly change the metrics.
  Both comparison ticks are prepared before publication. Detached metric rows
  keep earlier views stable; the unchanged batch evaluator checks equivalence.

Generator v1 uses a fixed 32-bit linear congruential sequence to construct a
connected 25 × 16, six-room map, doors, starts, headings, and relay sites.
Seed/version URLs replay that construction. Literal compatibility references
pin seeds 0, 12345, and 4294967295; they are not computed from the generator
under test. Mode navigation intentionally starts fresh rather than attempting
to migrate histories between runner types.

## Evidence and its limits

The original candidate is a negative control: relay coverage differs, but
all A/B/C physical routes and duplicate totals are identical. West-room is a
development-only mechanism demonstration: at tick one Scout A is at (3,2)
with Relay A and (4,1) with Relay B. Route sensitivity does not establish
improved exploration; all sites reach 100% explored at tick 160, and B has
more duplicates than A there.

The preselected mission sample includes seeds 0, 12345, and 4294967295 at all
three sites without filtering outcomes. Seed 12345 has 100% explored at every
site at tick 160; relay receipt is 45.71% / 100% / 76.07% for A/B/C, with
529 / 515 / 529 duplicates. Duplicate discoveries count additional distinct
scout sources for the same observed cell, including walls; repeated scans by
one scout do not add duplicates. These examples show differing consequences,
not a generally superior relay or automatic causal explanation. Current
verification results are recorded in the [README](../README.md); earlier
reports remain in the [archive](verification-history.md).

## Design tradeoffs and remaining work

The quiet Field View uses one map, a compact comparison table, and collapsed
secondary controls. Relay/Fleet/scout views separate exploration from delivery;
the inspector provides keyboard access when markers overlap. Speed affects
pacing only. Full navigation on mode or map changes favors predictable fresh
state over preserving progress.

The model has perfect integer-grid positions, static terrain, truthful sensing,
and instantaneous component-wide exchange. Full detached snapshots and a
160-tick cap favor traceable replay. Playback metrics process new snapshots
instead of reevaluating old history; [measured phase costs](metrics-performance.md)
document the improvement and remaining timeout headroom. Long-run performance
is still untuned.
The generator varies one rooms-and-passages family and need not give unique
terrain for every seed. There is one deterministic policy and no arbitrary
relay placement or timeline control. Snapshot import is not schema-validated.

This is an abstract software simulation, not real robotics, SLAM, machine
learning, optimal exploration, or a production distributed system. The static
demo is published on GitHub Pages after automated checks and a build, with no
backend. Hosted interactions were verified at 1440 × 900 and 1024 × 768, including
a full paired 4× seed-12345 run matching headless results; current CI and hosted
evidence are in the [README](../README.md). Desktop layouts below 1024 × 768, other
browser engines, and runtime reduced-motion behavior remain verification limits.
