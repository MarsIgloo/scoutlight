import { DEFAULT_MISSION_SEED, MAX_MISSION_SEED, MISSION_GENERATOR_VERSION } from '../experiments/seeded-mission';

export type MissionEntry = 'public' | 'review';

export interface MissionRequest {
  readonly seed: number;
  readonly usedDefault: boolean;
  readonly canonicalSearch: string;
}

export function missionSearch(seed: number, compareAB = false, entry: MissionEntry = 'public'): string {
  return `?${entry === 'review' ? 'review=missions&' : ''}seed=${seed}&v=${MISSION_GENERATOR_VERSION}${compareAB ? '&compare=ab' : ''}`;
}

/** Only canonical decimal uint32 seeds and the supported version are accepted. */
export function parseMissionRequest(search: string, entry: MissionEntry = 'public'): MissionRequest {
  const query = new URLSearchParams(search);
  const rawSeed = query.get('seed');
  const parsedSeed = rawSeed !== null && /^(0|[1-9]\d*)$/.test(rawSeed) ? Number(rawSeed) : NaN;
  const supportedVersion = query.get('v') === null || query.get('v') === String(MISSION_GENERATOR_VERSION);
  const validSeed = (rawSeed === null && entry === 'public') ||
    (Number.isInteger(parsedSeed) && parsedSeed >= 0 && parsedSeed <= MAX_MISSION_SEED);
  const valid = supportedVersion && validSeed;
  const seed = valid && rawSeed !== null ? parsedSeed : DEFAULT_MISSION_SEED;
  return { seed, usedDefault: !valid,
    canonicalSearch: missionSearch(seed, query.get('compare') === 'ab', entry) };
}

export function nextMissionSeed(current: number, entropy: number): number {
  const candidate = entropy >>> 0;
  return candidate === current ? (candidate + 1) >>> 0 : candidate;
}

export function missionHref(baseHref: string, seed: number,
  compareAB = new URL(baseHref).searchParams.get('compare') === 'ab',
  entry: MissionEntry = 'public'): string {
  const url = new URL(baseHref);
  url.search = missionSearch(seed, compareAB, entry);
  url.hash = '';
  return url.toString();
}
