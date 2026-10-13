import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
try {
  const { CANDIDATE_SCENARIO } = await server.ssrLoadModule('/src/experiments/candidate.ts');
  const { RELAY_BRIDGE_FIXTURE, WEST_ROOM_BRIDGE_VARIANT } = await server.ssrLoadModule('/src/experiments/route-investigation.ts');
  const { runRelayExperiment } = await server.ssrLoadModule('/src/experiments/relay-placement.ts');
  const { comparePositionRoutes } = await server.ssrLoadModule('/src/experiments/route-diagnostics.ts');
  for (const [scenario, cap] of [[CANDIDATE_SCENARIO, 160], [RELAY_BRIDGE_FIXTURE, 12], [WEST_ROOM_BRIDGE_VARIANT, 160]]) {
    const report = runRelayExperiment(scenario, cap);
    console.log(`\n${scenario.id} at tick ${cap}; repeat full states, metrics, hashes: ${report.repeatVerified ? 'verified' : 'FAILED'}`);
    console.log('| Site | Fleet % | Relay % | To 90% | Duplicates |');
    console.log('| --- | ---: | ---: | ---: | ---: |');
    for (const run of report.runs) {
      const final = run.metrics.coverage.at(-1);
      console.log(`| ${run.siteId} | ${final.fleetCoverage.toFixed(2)} | ${final.relayCoverage.toFixed(2)} | ${run.metrics.timeTo90 ?? '—'} | ${run.metrics.duplicateDiscoveries} |`);
    }
    for (let i = 0; i < report.runs.length; i++) {
      for (const other of report.runs.slice(i + 1)) {
        const first = report.runs[i];
        const route = comparePositionRoutes(first, other).filter(result => result.firstTick !== null);
        console.log(`${first.siteId} vs ${other.siteId} physical routes: ${route.length ? JSON.stringify(route) : 'identical at every tick'}`);
      }
    }
    if (scenario === CANDIDATE_SCENARIO) {
      const first = report.runs[0];
      const second = report.runs[1];
      const tick = 56;
      const a = first.snapshots[tick].scouts[1];
      const b = second.snapshots[tick].scouts[1];
      const changedCells = a.localMap.cells.flatMap((cell, index) => cell === b.localMap.cells[index] ? [] : [{
        position: { x: index % a.localMap.width, y: Math.floor(index / a.localMap.width) },
        siteA: cell, siteB: b.localMap.cells[index],
      }]);
      console.log(`Original candidate tick ${tick}, Scout B: ` + JSON.stringify({
        priorTargets: [first.snapshots[tick - 1].scouts[1].target, second.snapshots[tick - 1].scouts[1].target],
        changedCells, decisions: [a, b].map(s => ({ target: s.target, intent: s.lastMovement.intent,
          origin: s.lastMovement.origin, destination: s.position, headingBefore: s.lastMovement.headingBefore,
          headingAfter: s.heading })),
        facts: changedCells.map(({ position }) => [a, b].map(s => s.discoveries.filter(d =>
          d.position.x === position.x && d.position.y === position.y))),
        communication: [first, second].map(run => ({ site: run.siteId,
          relay: run.snapshots[tick].relay.communication,
          scoutA: run.snapshots[tick].scouts[0].communication,
          scoutB: run.snapshots[tick].scouts[1].communication })),
        firstReceiptAtSiteA: first.snapshots.findIndex(state => state.scouts[1].localMap.cells[9 * a.localMap.width] !== 'unknown'),
      }));
    }
    if (scenario === RELAY_BRIDGE_FIXTURE || scenario === WEST_ROOM_BRIDGE_VARIANT) {
      console.log(`${scenario.id} tick-one trace (A versus B):`);
      for (const run of report.runs.slice(0, 2)) {
        const state = run.snapshots[1];
        const scout = state.scouts[0];
        const bridgedCell = scenario === RELAY_BRIDGE_FIXTURE ? { x: 1, y: 2 } : { x: 3, y: 2 };
        console.log(JSON.stringify({ site: run.siteId, scout: scout.id, peers: scout.communication.peerIds,
          relayPeers: state.relay.communication.peerIds,
          observationByScoutA: scout.sensorTelemetry.observations.some(o => o.position.x === bridgedCell.x && o.position.y === bridgedCell.y),
          knowledgeAtBridge: scout.localMap.cells[bridgedCell.y * scout.localMap.width + bridgedCell.x],
          receivedFact: scout.discoveries.find(d => d.position.x === bridgedCell.x && d.position.y === bridgedCell.y),
          target: scout.target, movement: scout.lastMovement }));
      }
      if (scenario === WEST_ROOM_BRIDGE_VARIANT) {
        console.log('Variant Scout A positions/headings at ticks 0–4: ' + JSON.stringify(report.runs.slice(0, 2).map(run => ({
          site: run.siteId, steps: run.snapshots.slice(0, 5).map(state => ({ tick: state.tick,
            position: state.scouts[0].position, heading: state.scouts[0].heading })),
        }))));
      }
    }
  }
} finally {
  await server.close();
}
