# Incremental playback metrics measurement

Measured 2026-10-20 on the same local macOS ARM64 environment, Node 26.0.0, with no `NODE_OPTIONS` override or overlapping heavyweight job. One before and one after observation; these are local measurements, not CI predictions. The before source is `04bb1e94f28ad235c56f01e4367ceac26b6be036`.

Reproduce the workload with `node scripts/measure-comparison.mjs after`. The same measurement body was run before and after the source change. Vite loads the existing TypeScript modules without a web listener. Seed 12345, sites A/B, all 160 ticks: generate two independent headless references, advance the paired runner, then compare complete serialized histories, hashes and final metrics using Node strict assertions. A separate final batch-evaluation timing evaluates both completed histories once and checks their metrics. It is outside the comparison total.

| Phase | Before | After |
| --- | ---: | ---: |
| Headless references | 4.400 s | 4.430 s |
| Paired advancement, including initialization | 10.223 s | 2.938 s |
| Full-history/hash/final-metric assertions | 4.120 s | 4.200 s |
| Comparison total | 18.743 s | 11.568 s |
| Headroom to the unchanged 30-second test budget | 11.257 s | 18.432 s |
| Both final histories evaluated once, separately | 0.118 s | 0.127 s |

Paired advancement fell by 71.3%; the measured total fell by 38.3%. Node assertions and local scheduling differ from Vitest on the hosted runner. Actual CI results and test headroom must be checked separately.

The batch evaluator is unchanged. Each playback run now validates and retains its static observer context once, then validates only the newly appended snapshot. Facts are staged before commit; paired playback prepares both appends before either commits, and publishes one matching-tick view. Metrics publications copy their coverage rows, arrays and counters. Ground-truth evaluation remains outside planning. Existing complete-history, hash, speed, timer, cap and final-metric assertions and their 30-second budgets are retained.

Independent read-only review found no blocking defects in metric semantics, immutable publication, paired reset/isolation or information boundaries; correctness/readability was rated 9/10. Runtime and CI verification are reported separately in the README.
