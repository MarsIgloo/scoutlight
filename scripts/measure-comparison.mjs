import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// Read-only phase measurement, using the same full-cap workload before and after a repair.
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
try {
  const { generateSeededMission } = await server.ssrLoadModule('/src/experiments/seeded-mission.ts');
  const { runBaseline } = await server.ssrLoadModule('/src/experiments/relay-placement.ts');
  const { ComparisonRunner } = await server.ssrLoadModule('/src/app/comparison-runner.ts');
  const { serializeSnapshot, hashSnapshot } = await server.ssrLoadModule('/src/engine/snapshot.ts');
  const { evaluateRun } = await server.ssrLoadModule('/src/experiments/metrics.ts');
  const scenario = generateSeededMission(12345);
  const sites = ['site-a', 'site-b'];
  const measure = fn => {
    const start = performance.now();
    const value = fn();
    return { value, ms: performance.now() - start };
  };
  const references = measure(() => sites.map(site => runBaseline(scenario, site, 160)));
  let runner;
  const advance = measure(() => {
    runner = new ComparisonRunner(scenario);
    for (let tick = 0; tick < 160; tick++) runner.step();
    return runner.getSnapshot();
  });
  const assertions = measure(() => {
    for (const [index, site] of sites.entries()) {
      const actual = advance.value.runs[site];
      const expected = references.value[index];
      assert.deepStrictEqual(actual.metrics, expected.metrics);
      assert.deepStrictEqual(actual.history.map(serializeSnapshot), expected.snapshots.map(serializeSnapshot));
      assert.deepStrictEqual(actual.history.map(hashSnapshot), expected.hashes);
    }
  });
  const finalEvaluation = measure(() => {
    for (const site of sites) {
      assert.deepStrictEqual(evaluateRun(scenario, advance.value.runs[site].history), advance.value.runs[site].metrics);
    }
  });
  runner.dispose();
  const totalMs = references.ms + advance.ms + assertions.ms;
  console.log(JSON.stringify({
    label: process.argv[2], node: process.version, platform: process.platform, arch: process.arch,
    nodeOptions: process.env.NODE_OPTIONS ?? '', seed: 12345, ticks: 160, sites,
    headlessMs: references.ms, pairedAdvanceMs: advance.ms, historyHashAssertionsMs: assertions.ms,
    finalBatchEvaluationMs: finalEvaluation.ms, totalComparisonMs: totalMs,
    headroomTo30000Ms: 30000 - totalMs,
  }, null, 2));
} finally {
  await server.close();
}
