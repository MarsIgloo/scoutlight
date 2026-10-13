import { useEffect, useRef, useState } from 'react';
import type { ScoutId } from '../engine/types';
import { ScoutScene } from '../rendering/scene';
import type { SceneProjection } from '../rendering/projection';

export function SimulationCanvas({ projection, generation, running, onSelect }: {
  projection: SceneProjection; generation: number; running: boolean; onSelect: (id: ScoutId) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ScoutScene | null>(null);
  const latest = useRef({ projection, generation, running });
  latest.current = { projection, generation, running };
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ScoutScene.create(host.current!, onSelect).then(created => {
      if (cancelled) { created.destroy(); return; }
      scene.current = created;
      const value = latest.current;
      created.update(value.projection, value.generation, value.running);
    }).catch(() => { if (!cancelled) setError('The map could not start. Enable WebGL in your browser and reload.'); });
    return () => { cancelled = true; scene.current?.destroy(); scene.current = null; };
  }, [onSelect]);
  useEffect(() => { scene.current?.update(projection, generation, running); }, [projection, generation, running]);
  return <div className="canvas-host" ref={host}>{error && <p className="canvas-error" role="alert">{error}</p>}</div>;
}
