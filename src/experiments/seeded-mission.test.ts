import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine/initial-state';
import { serializeSnapshot } from '../engine/snapshot';
import type { GroundTruthGrid, Position } from '../engine/types';
import { EXPERIMENT_TICK_CAP, runBaseline } from './relay-placement';
import { generateSeededMission, MAX_MISSION_SEED } from './seeded-mission';

// Fixed before inspecting outcomes; no seed search or rejection loop.
const STRUCTURE_SEEDS = [0, 1, 42, 12345, 0x8000_0000, MAX_MISSION_SEED] as const;
const REPEAT_PAIRS = [
  [0, 'site-a'], [12345, 'site-b'], [MAX_MISSION_SEED, 'site-c'],
] as const;

// Published v1 references captured before release-preview URL/selection changes.
// Store the complete terrain rows, starts, headings and sites explicitly.
const PUBLISHED_V1 = [
  { seed: 0, terrain: `#########################
#.......#........#......#
#.......#........#......#
#.......#........#......#
#.......#...............#
#................#......#
#................#......#
#.......#........#......#
#####.#########.#####.###
#.......#........#......#
#.......#........#......#
#.......#...............#
#.......#........#......#
#................#......#
#.......#........#......#
#########################`,
    scouts: [[6, 3, 'north'], [16, 11, 'east'], [20, 5, 'south']], sites: [[14, 2], [7, 11], [19, 9]] },
  { seed: 12345, terrain: `#########################
#........#......#.......#
#........#......#.......#
#...............#.......#
#........#......#.......#
#........#..............#
#........#......#.......#
#........#......#.......#
#........#......#.......#
###.#######.######.######
#........#......#.......#
#.......................#
#........#......#.......#
#........#......#.......#
#........#......#.......#
#########################`,
    scouts: [[6, 1, 'west'], [10, 10, 'north'], [23, 7, 'east']], sites: [[12, 8], [3, 13], [23, 10]] },
  { seed: 4294967295, terrain: `#########################
#........#......#.......#
#........#......#.......#
#........#......#.......#
#........#......#.......#
#...............#.......#
#........#......#.......#
#........#..............#
#........#......#.......#
#####.#######.#######.###
#........#......#.......#
#........#......#.......#
#...............#.......#
#........#..............#
#........#......#.......#
#########################`,
    scouts: [[4, 7, 'east'], [12, 14, 'south'], [20, 5, 'west']], sites: [[10, 6], [1, 12], [20, 11]] },
] as const;

function reachableClearCount(grid: GroundTruthGrid, start: Position): number {
  const startIndex = start.y * grid.width + start.x;
  const seen = new Set<number>([startIndex]);
  const queue = [startIndex];
  for (const index of queue) {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!;
      const ny = y + dy!;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;
      const neighbor = ny * grid.width + nx;
      if (grid.cells[neighbor] === 'clear' && !seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return seen.size;
}

describe('seeded rooms mission v1', () => {
  it.each(PUBLISHED_V1)('preserves the published v1 mission for seed $seed', reference => {
    const scenario = generateSeededMission(reference.seed);
    expect(scenario.version).toBe(1);
    expect([scenario.groundTruth.width, scenario.groundTruth.height]).toStrictEqual([25, 16]);
    expect(scenario.groundTruth.cells).toStrictEqual(
      [...reference.terrain.replaceAll('\n', '')].map(cell => cell === '#' ? 'blocked' : 'clear'));
    expect(scenario.scouts.map(scout => [scout.position.x, scout.position.y, scout.heading])).toStrictEqual(reference.scouts);
    expect(scenario.relaySites.map(site => [site.position.x, site.position.y])).toStrictEqual(reference.sites);
    expect(scenario.scouts.map(scout => scout.id)).toStrictEqual(['scout-a', 'scout-b', 'scout-c']);
    expect(scenario.relaySites.map(site => site.id)).toStrictEqual(['site-a', 'site-b', 'site-c']);
  });

  it.each(STRUCTURE_SEEDS)('makes one connected valid 25×16 scenario for seed %s', seed => {
    const scenario = generateSeededMission(seed);
    expect(scenario).toStrictEqual(generateSeededMission(seed));
    expect(scenario).toMatchObject({ id: `seeded-rooms-v1-${seed}`, version: 1, communicationRange: 6 });
    const grid = scenario.groundTruth;
    expect([grid.width, grid.height]).toStrictEqual([25, 16]);
    const clearCount = grid.cells.filter(cell => cell === 'clear').length;
    expect(clearCount).toBeGreaterThan(0);
    expect(reachableClearCount(grid, scenario.scouts[0].position)).toBe(clearCount);
    for (let x = 0; x < grid.width; x++) {
      expect(grid.cells[x]).toBe('blocked');
      expect(grid.cells[(grid.height - 1) * grid.width + x]).toBe('blocked');
    }
    for (let y = 0; y < grid.height; y++) {
      expect(grid.cells[y * grid.width]).toBe('blocked');
      expect(grid.cells[y * grid.width + grid.width - 1]).toBe('blocked');
    }
    const occupied = [...scenario.scouts.map(scout => scout.position), ...scenario.relaySites.map(site => site.position)];
    expect(new Set(occupied.map(position => `${position.x},${position.y}`)).size).toBe(6);
    for (const site of scenario.relaySites) {
      const state = createInitialState(scenario, site.id);
      expect(state.tick).toBe(0);
      expect(state.scouts.every(scout => scout.localMap.cells.every(cell => cell === 'unknown'))).toBe(true);
      expect(state.relay.sharedMap.cells.every(cell => cell === 'unknown')).toBe(true);
    }
  });

  it('varies actual terrain across the predetermined seeds', () => {
    const terrain = STRUCTURE_SEEDS.map(seed => generateSeededMission(seed).groundTruth.cells.join(''));
    expect(new Set(terrain).size).toBeGreaterThanOrEqual(4);
  });

  it('rejects values outside the documented unsigned seed domain', () => {
    for (const seed of [-1, MAX_MISSION_SEED + 1, 1.5, NaN, Infinity]) {
      expect(() => generateSeededMission(seed)).toThrow(RangeError);
    }
  });

  it.each(REPEAT_PAIRS)('replays full states and metrics for seed %s at %s', (seed, site) => {
    const original = runBaseline(generateSeededMission(seed), site, EXPERIMENT_TICK_CAP);
    const repeated = runBaseline(generateSeededMission(seed), site, EXPERIMENT_TICK_CAP);
    expect(repeated.metrics).toStrictEqual(original.metrics);
    expect(repeated.hashes).toStrictEqual(original.hashes);
    expect(repeated.snapshots.map(serializeSnapshot)).toStrictEqual(original.snapshots.map(serializeSnapshot));
  }, 30_000);
});
