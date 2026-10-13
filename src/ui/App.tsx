import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { SimulationRunner, type PlaybackSpeed, type RunView } from '../app/runner';
import { ComparisonRunner, selectComparedRun, type CompareSite } from '../app/comparison-runner';
import { handleShortcut, isShortcutControl } from '../app/keyboard';
import { selectAppScenario } from '../app/scenario-selection';
import { missionHref, nextMissionSeed } from '../app/mission-url';
import { EXPERIMENT_TICK_CAP } from '../experiments/relay-placement';
import type { RelaySiteId, ScoutId } from '../engine/types';
import { nodeLabel, projectInspector, projectScene, SCOUT_IDS, type ViewOptions } from '../rendering/projection';
import { SimulationCanvas } from './SimulationCanvas';
import { initialInspection, inspectionReducer } from './inspection';
import './styles.css';

const SITES = ['site-a', 'site-b', 'site-c'] as const;
const COMPARE_SITES = ['site-a', 'site-b'] as const;
const pct = (value: number) => `${value.toFixed(1)}%`;
const letter = (id: string) => id.slice(-1).toUpperCase();

export function App() {
  const [appScenario] = useState(() => selectAppScenario(window.location.search, import.meta.env.DEV));
  const [runner] = useState(() => appScenario.compareAB
    ? new ComparisonRunner(appScenario.scenario) : new SimulationRunner(appScenario.scenario));
  const run = useSyncExternalStore(runner.subscribe, () => runner.getSnapshot());
  const [viewingSite, setViewingSite] = useState<CompareSite>('site-a');
  const compared = 'runs' in run ? run : null;
  const viewedRun = compared ? selectComparedRun(compared, viewingSite) : run as RunView;
  const [{ selected, inspected, knowledge }, dispatchInspection] = useReducer(inspectionReducer, initialInspection);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inspectorMoreOpen, setInspectorMoreOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [layers, setLayers] = useState({ trails: true, rays: true, links: true });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const options: ViewOptions = useMemo(() => ({ selected, knowledge, ...layers }), [selected, knowledge, layers]);
  const projection = useMemo(() => projectScene(viewedRun.state, viewedRun.history, options),
    [viewedRun.state, viewedRun.history, options]);
  const inspector = projectInspector(viewedRun.state, selected);
  const metrics = viewedRun.metrics;
  const coverage = metrics.coverage.at(-1)!;
  const site = viewedRun.state.config.relaySiteId;
  const status = run.complete ? 'Complete' : run.running ? 'Running' : viewedRun.state.tick ? 'Paused' : 'Ready';
  const knownCells = projection.map.cells.filter(cell => cell !== 'unknown').length;
  const viewName = knowledge === 'fleet' ? 'Fleet' : knowledge === 'relay' ? 'Relay' : nodeLabel(selected);
  const targetColor = `#${inspector.color.toString(16).padStart(6, '0')}`;

  useEffect(() => () => runner.dispose(), [runner]);
  useEffect(() => {
    if (appScenario.mission && window.location.search !== appScenario.mission.canonicalSearch) {
      // The captured scenario already uses this seed; only make its URL reproducible.
      window.history.replaceState(null, '', missionHref(window.location.href, appScenario.mission.seed,
        appScenario.compareAB, appScenario.missionEntry));
    }
  }, [appScenario]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleShortcut(event, isShortcutControl(event.target), runner);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runner]);

  const inspect = useCallback((id: ScoutId) => {
    dispatchInspection({ type: 'inspect', scout: id });
    setPickerOpen(false);
    setInspectorMoreOpen(false);
  }, []);
  const dismissInspector = () => {
    dispatchInspection({ type: 'dismiss' });
    setInspectorMoreOpen(false);
  };
  const reset = (nextSite?: RelaySiteId) => {
    if (runner instanceof ComparisonRunner) runner.reset();
    else runner.reset(nextSite);
  };
  const newMap = () => {
    if (!appScenario.mission) return;
    const entropy = new Uint32Array(1);
    window.crypto.getRandomValues(entropy);
    window.location.assign(missionHref(window.location.href,
      nextMissionSeed(appScenario.mission.seed, entropy[0]!), appScenario.compareAB, appScenario.missionEntry));
  };
  const changeMode = (compareAB: boolean) => {
    if (!appScenario.mission || compareAB === appScenario.compareAB) return;
    runner.pause();
    window.location.assign(missionHref(window.location.href, appScenario.mission.seed, compareAB, appScenario.missionEntry));
  };

  return <main className="workspace">
    <aside className="command-rail" aria-label="Simulation controls and scout inspector">
      <header className="rail-brand"><span className="brand-mark" aria-hidden="true">◇</span><h1>Scoutlight</h1></header>
      {appScenario.reviewLabel && <div className="review-label">{appScenario.reviewLabel}</div>}
      {appScenario.mission && appScenario.missionEntry === 'public' && <section className="run-mode-control" aria-label="Run mode">
        <div className="segmented" aria-describedby="mode-reset-note">
          <button aria-pressed={!compared} onClick={() => changeMode(false)}>Single run</button>
          <button aria-pressed={!!compared} onClick={() => changeMode(true)}>Compare A/B</button>
        </div>
        <p id="mode-reset-note">Mode changes restart this map paused at Relay A, Fleet, 1×.</p>
        <p>Try 4×, then pause and compare Relay and Fleet knowledge.</p>
      </section>}

      <section className="rail-section mission" aria-label="Mission and playback">
        <div className={`section-label ${appScenario.mission ? 'mission-site-label' : ''}`}>
          <span>{compared ? 'Viewing relay' : 'Relay site'}</span>
          {appScenario.mission && <button type="button" className="new-map-button" onClick={newMap}>New map</button>}
        </div>
        <div className="run-status" aria-live="polite"><span className={`status-dot ${run.running ? 'active' : ''}`} />
          <span>{status}{compared ? ` · tick ${compared.tick} / ${EXPERIMENT_TICK_CAP}` : ''}</span></div>
        {compared ? <div className="segmented site-picker" aria-label="Viewing relay">
          {COMPARE_SITES.map(id => <button key={id} aria-pressed={viewingSite === id}
            aria-label={`View relay ${letter(id)}`} title={`View Relay ${letter(id)} at the same tick. ${appScenario.relayRationale[id]}`}
            onClick={() => setViewingSite(id)}>Viewing {letter(id)}</button>)}
        </div> : <div className="segmented site-picker" aria-label="Relay site">{SITES.map(id => <button key={id} aria-pressed={site === id}
          aria-label={`Relay ${letter(id)}`} title={`${appScenario.relayRationale[id]} Changing sites starts a fresh run.`}
          onClick={() => reset(id)}>{letter(id)}</button>)}</div>}
        <div className="playback-row">
          <button className="primary-button" disabled={run.complete} onClick={() => run.running ? runner.pause() : runner.start()}>
            <span aria-hidden="true">{run.complete ? '✓' : run.running ? 'Ⅱ' : '▷'}</span>
            {run.complete ? 'Complete' : run.running ? 'Pause' : viewedRun.state.tick ? 'Resume' : 'Start'}</button>
          <button disabled={run.running || run.complete} onClick={() => runner.step()} title="Advance one tick (Right Arrow)">Step <span aria-hidden="true">→</span></button>
        </div>
        <div className="pace-row"><div className="segmented speed" aria-label="Playback speed">{([1, 2, 4] as PlaybackSpeed[]).map(speed =>
          <button key={speed} aria-label={`${speed}× speed`} aria-pressed={run.speed === speed}
            onClick={() => runner.setSpeed(speed)}>{speed}×</button>)}</div>
          <button className="reset-button" onClick={() => reset()}
            title={compared ? 'Reset both relay runs' : 'Reset current relay run'}>↺ Reset</button></div>
      </section>

      <section className="rail-section" aria-label="Terrain knowledge view">
        <div className="section-label">Terrain view</div>
        <div className="segmented knowledge-switch">{(['relay', 'fleet'] as const).map(view => <button key={view}
          aria-pressed={knowledge === view} onClick={() => dispatchInspection({ type: 'knowledge', view })}>
          {view === 'relay' ? 'Relay' : 'Fleet'}</button>)}</div>
      </section>

      <div className="rail-scroll">

      <section className="rail-section inspector" aria-label="Scout inspector">
        {!inspected ? <>
          <button className="text-disclosure" type="button" aria-expanded={pickerOpen} aria-controls="scout-picker"
            onClick={() => setPickerOpen(open => !open)}>Inspect scout <span aria-hidden="true">{pickerOpen ? '▴' : '▾'}</span></button>
          <div id="scout-picker" hidden={!pickerOpen} className="scout-picker">{SCOUT_IDS.map(id => <button className={id} key={id}
            onClick={() => inspect(id)} aria-label={`Inspect Scout ${letter(id)}`}><i />{letter(id)}</button>)}</div>
        </> : <>
          <div className="inspector-heading"><strong className={selected}>{inspector.name}</strong>
            <button type="button" className="close-button" aria-label="Close scout inspector" onClick={dismissInspector}>×</button></div>
          <dl className="inspector-summary"><div><dt>Relay reachable</dt><dd className={inspector.relayReachable === 'Yes' ? 'reachable' : ''}>{inspector.relayReachable}</dd></div>
            <div><dt>Target</dt><dd>{inspector.target}</dd></div></dl>
          <button className="scout-knowledge" aria-pressed={knowledge === 'scout'} onClick={() => dispatchInspection({ type: 'knowledge', view: 'scout' })}>View {inspector.name} knowledge</button>
          <button className="text-disclosure" type="button" aria-expanded={inspectorMoreOpen} aria-controls="inspector-extra"
            onClick={() => setInspectorMoreOpen(open => !open)}>Scout details <span aria-hidden="true">{inspectorMoreOpen ? '▴' : '▾'}</span></button>
          <div id="inspector-extra" className="inspector-extra" hidden={!inspectorMoreOpen}>
            <dl className="inspector-details"><div><dt>Position</dt><dd>{inspector.position}</dd></div>
              <div><dt>Heading</dt><dd>{inspector.heading}</dd></div>
              <div><dt>Component</dt><dd>{inspector.component}</dd></div>
              <div><dt>Direct peers</dt><dd>{inspector.peers}</dd></div></dl>
            <h3>Latest scan {inspector.scan && <span>from {inspector.scan.origin}</span>}</h3>
            {inspector.scan ? <div className="scan-counts">{[['Rays', inspector.scan.rays], ['Observed', inspector.scan.observed],
              ['New', inspector.scan.new], ['Blocked hits', inspector.scan.blocked]].map(([label, value]) =>
              <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div> : <p className="empty-value">No scan yet</p>}
            <h3>Latest movement</h3>
            {inspector.movement ? <dl className="inspector-details movement"><div><dt>Intent</dt><dd>{inspector.movement.intent}</dd></div>
              <div><dt>Outcome</dt><dd>{inspector.movement.outcome}</dd></div>
              <div><dt>Attempted → actual</dt><dd>{inspector.movement.attempted} → {inspector.movement.actual}</dd></div></dl>
              : <p className="empty-value">No movement yet</p>}
            <div className="scout-picker" aria-label="Choose another scout">{SCOUT_IDS.map(id => <button className={id} key={id}
              aria-pressed={selected === id} onClick={() => inspect(id)} aria-label={`Inspect Scout ${letter(id)}`}><i />{letter(id)}</button>)}</div>
          </div>
        </>}
      </section>
      <section className="rail-section disclosures" aria-label="More information and display settings">
        <button className="text-disclosure" type="button" aria-expanded={displayOpen} aria-controls="display-settings"
          onClick={() => setDisplayOpen(open => !open)}>Display settings <span aria-hidden="true">{displayOpen ? '▴' : '▾'}</span></button>
        <div id="display-settings" hidden={!displayOpen} className="disclosure-content layer-controls">{(['trails', 'rays', 'links'] as const).map(layer => <label key={layer}>
          <input type="checkbox" checked={layers[layer]}
            onChange={() => setLayers(current => ({ ...current, [layer]: !current[layer] }))} />
          {layer[0]!.toUpperCase() + layer.slice(1)}</label>)}</div>

        <button className="text-disclosure" type="button" aria-expanded={detailsOpen} aria-controls="run-details"
          onClick={() => setDetailsOpen(open => !open)}>Details <span aria-hidden="true">{detailsOpen ? '▴' : '▾'}</span></button>
        <div id="run-details" hidden={!detailsOpen} className="disclosure-content">
          <div className="detail-subtitle">Global observer telemetry</div>
          <dl className="detail-list"><div><dt>Tick</dt><dd>{viewedRun.state.tick} / {EXPERIMENT_TICK_CAP}</dd></div>
            <div><dt>Duplicates</dt><dd>{metrics.duplicateDiscoveries}</dd></div>
            <div><dt>Relay to 90%</dt><dd>{metrics.timeTo90 === null ? 'Not reached' : `Tick ${metrics.timeTo90}`}</dd></div>
            <div><dt>Delivery gap</dt><dd data-testid="communication-gap">{coverage.communicationGap.toFixed(1)} pp</dd></div>
            <div><dt>Known terrain</dt><dd>{knownCells} / {projection.map.cells.length} cells, including walls</dd></div>
            <div><dt>Connected to relay</dt><dd>{SCOUT_IDS.map(id => `${letter(id)} ${pct(metrics.connectivityFraction[id] * 100)}`).join(' / ')}</dd></div></dl>
          <p className="detail-copy">Coverage measures reachable clear cells. The known-terrain count includes walls. Links and rays use recorded pre-movement scan positions.</p>
        </div>

        <button className="text-disclosure" type="button" aria-expanded={helpOpen} aria-controls="help-content"
          onClick={() => setHelpOpen(open => !open)}>Help <span aria-hidden="true">{helpOpen ? '▴' : '▾'}</span></button>
        <div id="help-content" hidden={!helpOpen} className="disclosure-content help-content">
          {compared && <p>Pause, then switch Viewing A/B to compare the same moment.</p>}
          <p>Click a scout on the map, or use Inspect scout when markers overlap. Fleet combines terrain discovered by all scouts; Relay shows only information received by the relay. An inspected scout shows only its own knowledge. Relay reachable means a path through direct links, not necessarily direct contact or a new transfer.</p>
          <div className="canvas-legend"><span><i className="legend-cell unknown" />Unknown</span><span><i className="legend-cell clear" />Known clear</span>
            <span><i className="legend-cell blocked" />Known blocked</span><span><i className="legend-target" style={{ borderColor: targetColor }} />Target</span>
            <span><i className="legend-relay">◇</i>Relay</span>
            {SCOUT_IDS.map(id => <span key={id}><i className={`legend-scout ${id}`} />{nodeLabel(id)}</span>)}</div>
          <p><kbd>Space</kbd> play/pause · <kbd>→</kbd> step · keys 1, 2, or 4 set speed. Reset has no shortcut.</p>
          <p>{appScenario.help}</p>
        </div>
      </section>
      </div>
    </aside>

    <section className="field" aria-label="Simulation field">
      <header className={`field-header${compared ? ' comparison-header' : ''}`}>
        {compared ? <>
          <div className="compare-context"><span>Shared tick</span><strong>{compared.tick} / {EXPERIMENT_TICK_CAP}</strong>
            <span>Viewing relay {letter(viewingSite)}</span></div>
          <table className="compare-coverage" aria-label="Reachable clear-cell coverage by relay at the shared tick">
            <thead><tr><th scope="col">Relay</th><th scope="col">Explored</th><th scope="col">Received by relay</th></tr></thead>
            <tbody>{COMPARE_SITES.map(id => {
              const row = selectComparedRun(compared, id).metrics.coverage.at(-1)!;
              return <tr key={id} className={viewingSite === id ? 'viewing' : ''}><th scope="row">{letter(id)}</th>
                <td>{pct(row.fleetCoverage)}</td><td>{pct(row.relayCoverage)}</td></tr>;
            })}</tbody>
          </table>
        </> : <div className="primary-metrics" aria-label="Reachable clear-cell coverage">
          <div><span>Explored</span><strong data-testid="fleet-coverage">{pct(coverage.fleetCoverage)}</strong></div>
          <div><span>Received by relay</span><strong data-testid="relay-coverage">{pct(coverage.relayCoverage)}</strong></div>
        </div>}
      </header>
      <div className="canvas-wrap"><SimulationCanvas projection={projection} generation={run.generation} running={run.running} onSelect={inspect} /></div>
      <div className="field-caption">{compared ? `Viewing relay ${letter(viewingSite)} · ` : ''}Terrain: {viewName} knowledge · Scout markers and overlays: observer view</div>
    </section>
  </main>;
}
