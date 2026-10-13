import { createHash } from 'node:crypto';
import { createServer } from 'vite';

// Fixed before inspecting outcomes; report weak or incomplete runs as-is.
const seeds = [0, 12345, 0xffff_ffff];
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
try {
  const { generateSeededMission } = await server.ssrLoadModule('/src/experiments/seeded-mission.ts');
  const { runBaseline, EXPERIMENT_TICK_CAP } = await server.ssrLoadModule('/src/experiments/relay-placement.ts');
  console.log('| Seed | Terrain SHA-256 prefix | Relay | Fleet % | Relay % | Tick to 90% | Duplicates |');
  console.log('| ---: | --- | --- | ---: | ---: | ---: | ---: |');
  const terrain = new Set();
  for (const seed of seeds) {
    const scenario = generateSeededMission(seed);
    const cells = scenario.groundTruth.cells.join('');
    terrain.add(cells);
    const fingerprint = createHash('sha256').update(cells).digest('hex').slice(0, 12);
    for (const site of ['site-a', 'site-b', 'site-c']) {
      const run = runBaseline(scenario, site, EXPERIMENT_TICK_CAP);
      const coverage = run.metrics.coverage.at(-1);
      console.log(`| ${seed} | ${fingerprint} | ${site} | ${coverage.fleetCoverage.toFixed(2)} | ${coverage.relayCoverage.toFixed(2)} | ${run.metrics.timeTo90 ?? '—'} | ${run.metrics.duplicateDiscoveries} |`);
    }
  }
  console.log(`Distinct terrain layouts: ${terrain.size}/${seeds.length}`);
} finally {
  await server.close();
}
