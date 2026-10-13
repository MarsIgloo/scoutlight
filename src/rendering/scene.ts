import { Application, Circle, Container, Graphics, Text } from 'pixi.js';
import type { Position, ScoutId } from '../engine/types';
import { SCOUT_COLORS, SCOUT_IDS, type SceneProjection } from './projection';

/** Pixi owns animation frames; this class never advances or queries simulation physics. */
export class ScoutScene {
  private readonly map = new Graphics();
  private readonly paths = new Graphics();
  private readonly effects = new Graphics();
  private readonly links = new Graphics();
  private readonly relay = new Graphics();
  private readonly relayLabel = new Text({ text: '', style: { fontFamily: 'system-ui', fontSize: 12, fill: 0xe4edf2 } });
  private readonly markers = new Map<ScoutId, { root: Container; shape: Graphics }>();
  private projection: SceneProjection | null = null;
  private generation = -1;
  private tickAt = 0;
  private running = false;
  private cell = 24;
  private left = 0;
  private top = 0;
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly resizeObserver: ResizeObserver;

  private constructor(private readonly app: Application, host: HTMLElement, select: (id: ScoutId) => void) {
    app.stage.addChild(this.map, this.paths, this.effects, this.links, this.relay, this.relayLabel);
    this.relayLabel.anchor.set(.5, 0);
    for (const id of SCOUT_IDS) {
      const root = new Container();
      const shape = new Graphics();
      const label = new Text({ text: id.slice(-1).toUpperCase(), style: { fontFamily: 'system-ui', fontSize: 12,
        fontWeight: '700', fill: SCOUT_COLORS[id] } });
      label.anchor.set(.5);
      root.addChild(shape, label);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new Circle(0, 0, 11);
      root.on('pointertap', () => select(id));
      app.stage.addChild(root);
      this.markers.set(id, { root, shape });
    }
    host.appendChild(app.canvas);
    app.canvas.setAttribute('aria-label', 'Exploration map. Scout selection is also available in the inspector.');
    app.canvas.setAttribute('role', 'img');
    this.resizeObserver = new ResizeObserver(() => {
      app.renderer.resize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
      this.draw();
    });
    this.resizeObserver.observe(host);
    app.ticker.maxFPS = 60;
    app.ticker.add(this.animate);
  }

  static async create(host: HTMLElement, select: (id: ScoutId) => void): Promise<ScoutScene> {
    const app = new Application();
    await app.init({ background: 0x0a1015, width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight),
      antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, preference: 'webgl' });
    return new ScoutScene(app, host, select);
  }

  update(projection: SceneProjection, generation: number, running: boolean): void {
    if (projection.tick !== this.projection?.tick || generation !== this.generation) this.tickAt = performance.now();
    this.projection = projection;
    this.generation = generation;
    this.running = running;
    this.draw();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.app.ticker.remove(this.animate);
    this.app.destroy(true, { children: true });
  }

  private point(position: Position): Position {
    return { x: this.left + (position.x + .5) * this.cell, y: this.top + (position.y + .5) * this.cell };
  }

  private draw(): void {
    const p = this.projection;
    if (!p) return;
    this.cell = Math.max(1, Math.min((this.app.screen.width - 28) / p.map.width, (this.app.screen.height - 28) / p.map.height));
    this.left = (this.app.screen.width - p.map.width * this.cell) / 2;
    this.top = (this.app.screen.height - p.map.height * this.cell) / 2;
    this.map.clear();
    this.paths.clear();
    this.links.clear();
    for (let i = 0; i < p.map.cells.length; i++) {
      const x = this.left + (i % p.map.width) * this.cell;
      const y = this.top + Math.floor(i / p.map.width) * this.cell;
      const cell = p.map.cells[i];
      if (cell === 'unknown') {
        this.map.circle(x + this.cell / 2, y + this.cell / 2, .8).fill({ color: 0x2b414c, alpha: .5 });
      } else {
        this.map.rect(x + 1, y + 1, this.cell - 2, this.cell - 2)
          .fill(cell === 'clear' ? 0x1b2d38 : 0x3e535f);
        if (cell === 'blocked') this.map.rect(x + 3, y + 3, this.cell - 6, this.cell - 6)
          .stroke({ color: 0x91a4ad, alpha: .4, width: 1 });
      }
    }
    for (const scout of p.scouts) {
      const color = SCOUT_COLORS[scout.id];
      for (let i = 1; i < scout.trail.length; i++) {
        const from = this.point(scout.trail[i - 1]!);
        const to = this.point(scout.trail[i]!);
        this.paths.moveTo(from.x, from.y).lineTo(to.x, to.y)
          .stroke({ color, width: 1.2, alpha: .06 + .38 * i / scout.trail.length });
      }
    }
    for (const edge of p.edges) {
      const from = this.point(edge.from), to = this.point(edge.to);
      // Recorded direct edges sit above scan effects; the dark keyline keeps them legible where rays cross.
      this.links.moveTo(from.x, from.y).lineTo(to.x, to.y)
        .stroke({ color: 0x0a1015, width: 4, alpha: .95 });
      this.links.moveTo(from.x, from.y).lineTo(to.x, to.y)
        .stroke({ color: 0xdcebf1, width: 2, alpha: .92 });
      for (const end of [from, to]) this.links.circle(end.x, end.y, 2.5)
        .fill(0x0a1015).stroke({ color: 0xdcebf1, width: 1.2, alpha: .92 });
    }
    if (p.target) {
      const at = this.point(p.target);
      const color = SCOUT_COLORS[p.scouts.find(s => s.selected)!.id];
      this.paths.rect(at.x - 4.5, at.y - 4.5, 9, 9).stroke({ color, alpha: .85, width: 1.2 });
    }
    const relay = this.point(p.relay.position);
    this.relay.clear().poly([relay.x, relay.y - 8, relay.x + 8, relay.y, relay.x, relay.y + 8, relay.x - 8, relay.y])
      .fill(0x0a1015).stroke({ color: 0xe5edf2, width: 1.8 });
    this.relay.circle(relay.x, relay.y, 2).fill(0xe5edf2);
    this.relayLabel.text = `R · ${p.relay.label}`;
    this.relayLabel.position.set(relay.x, relay.y + 11);
    for (const scout of p.scouts) {
      const { root, shape } = this.markers.get(scout.id)!;
      const at = this.point(scout.position);
      const dx = scout.offset.x * this.cell, dy = scout.offset.y * this.cell;
      root.position.set(at.x + dx, at.y + dy);
      shape.clear();
      const color = SCOUT_COLORS[scout.id];
      if (dx || dy) shape.moveTo(-dx, -dy).lineTo(0, 0).stroke({ color, alpha: .5, width: 1 });
      if (scout.selected) shape.circle(0, 0, 14).fill({ color, alpha: .08 }).circle(0, 0, 11.5).stroke({ color, alpha: .8, width: 1 });
      shape.circle(0, 0, 8.5).fill(0x0a1015).stroke({ color, width: scout.selected ? 2 : 1.7 });
      const angle = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI }[scout.heading];
      const along = (radius: number, side: number) => ({ x: Math.cos(angle) * radius - Math.sin(angle) * side,
        y: Math.sin(angle) * radius + Math.cos(angle) * side });
      const tip = along(16, 0), a = along(11, -2.5), b = along(11, 2.5);
      shape.poly([tip.x, tip.y, a.x, a.y, b.x, b.y]).fill(color);
    }
    this.animate();
  }

  private readonly animate = (): void => {
    const p = this.projection;
    if (!p) return;
    const age = performance.now() - this.tickAt;
    const fade = this.motion.matches ? .72 : this.running ? Math.max(0, 1 - age / 380) : .78;
    this.effects.clear();
    if (fade <= 0) return;
    if (!this.motion.matches) for (const highlight of p.highlights) {
      const at = this.point(highlight.position);
      this.effects.rect(at.x - this.cell / 2 + 1, at.y - this.cell / 2 + 1, this.cell - 2, this.cell - 2)
        .fill({ color: highlight.color, alpha: .15 * fade });
    }
    for (const ray of p.rays) {
      const from = this.point(ray.origin), to = this.point(ray.end), color = SCOUT_COLORS[ray.scoutId];
      this.effects.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color, width: 1, alpha: .38 * fade });
      if (ray.termination !== 'maximum-range') this.effects.circle(to.x, to.y, 1.8).fill({ color, alpha: .62 * fade });
      if (ray.index === 0) this.effects.circle(from.x, from.y, 3).stroke({ color, alpha: .55 * fade, width: 1 });
    }
  };
}
