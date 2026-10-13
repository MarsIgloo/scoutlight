import { createServer } from 'vite';

// Use the existing pinned TypeScript toolchain without a web listener or new service.
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
try {
  const { TEST_SCENARIO } = await server.ssrLoadModule('/src/engine/scenario.ts');
  const { CANDIDATE_SCENARIO } = await server.ssrLoadModule('/src/experiments/candidate.ts');
  const { runRelayExperiment, formatExperiment } = await server.ssrLoadModule('/src/experiments/relay-placement.ts');
  for (const scenario of [TEST_SCENARIO, CANDIDATE_SCENARIO]) {
    const report = runRelayExperiment(scenario);
    console.log(formatExperiment(report) + '\n');
    if (scenario === CANDIDATE_SCENARIO && !report.passed) process.exitCode = 1;
  }
} finally {
  await server.close();
}
