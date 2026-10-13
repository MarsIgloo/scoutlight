import { describe, expect, it } from 'vitest';
import { DEFAULT_MISSION_SEED, MAX_MISSION_SEED } from '../experiments/seeded-mission';
import { missionHref, missionSearch, nextMissionSeed, parseMissionRequest } from './mission-url';

describe('mission URL', () => {
  it('uses the public default without an invalid-link notice on a first visit', () => {
    expect(parseMissionRequest('')).toStrictEqual({
      seed: DEFAULT_MISSION_SEED, usedDefault: false, canonicalSearch: '?seed=12345&v=1',
    });
    expect(parseMissionRequest('?compare=ab')).toStrictEqual({
      seed: DEFAULT_MISSION_SEED, usedDefault: false, canonicalSearch: '?seed=12345&v=1&compare=ab',
    });
  });

  it('accepts the unsigned seed boundaries and canonicalizes the generator version', () => {
    expect(parseMissionRequest('?seed=0&v=1')).toStrictEqual({
      seed: 0, usedDefault: false, canonicalSearch: '?seed=0&v=1',
    });
    expect(parseMissionRequest(`?seed=${MAX_MISSION_SEED}`)).toStrictEqual({
      seed: MAX_MISSION_SEED, usedDefault: false, canonicalSearch: '?seed=4294967295&v=1',
    });
  });

  it.each([
    '?seed=', '?seed=-1', '?seed=1.5', '?seed=0001', '?seed=4294967296',
    '?seed=12&v=2', '?seed=abc', '?v=2',
  ])('visibly defaults invalid supplied inputs: %s', search => {
    expect(parseMissionRequest(search)).toStrictEqual({
      seed: DEFAULT_MISSION_SEED, usedDefault: true, canonicalSearch: '?seed=12345&v=1',
    });
  });

  it('generates a different seed even if entropy repeats the current one', () => {
    expect(nextMissionSeed(12345, 12345)).toBe(12346);
    expect(nextMissionSeed(MAX_MISSION_SEED, MAX_MISSION_SEED)).toBe(0);
    expect(nextMissionSeed(12345, 77)).toBe(77);
  });

  it.each([false, true])('keeps saved public mission and comparison %s reproducible across refresh and navigation', compareAB => {
    const search = `?seed=12345&v=1${compareAB ? '&compare=ab' : ''}`;
    expect(missionSearch(12345, compareAB)).toBe(search);
    expect(parseMissionRequest(search)).toStrictEqual({ seed: 12345, usedDefault: false, canonicalSearch: search });
    const saved = missionHref(`http://127.0.0.1:4173/${search}#old`, 0);
    expect(saved).toBe(`http://127.0.0.1:4173/?seed=0&v=1${compareAB ? '&compare=ab' : ''}`);
    expect(parseMissionRequest(new URL(saved).search).canonicalSearch).toBe(new URL(saved).search);
    expect(missionHref(`http://127.0.0.1:4173/${search}`, 12345, !compareAB))
      .toBe(`http://127.0.0.1:4173/?seed=12345&v=1${compareAB ? '' : '&compare=ab'}`);
  });

  it.each([false, true])('canonicalizes release-preview aliases to the same public mission, comparison %s', compareAB => {
    const alias = `?preview=release&seed=12345&v=1${compareAB ? '&compare=ab' : ''}`;
    const canonical = `?seed=12345&v=1${compareAB ? '&compare=ab' : ''}`;
    expect(parseMissionRequest(alias)).toStrictEqual({ seed: 12345, usedDefault: false, canonicalSearch: canonical });
    expect(missionHref(`http://127.0.0.1:4173/${alias}`, 0))
      .toBe(`http://127.0.0.1:4173/?seed=0&v=1${compareAB ? '&compare=ab' : ''}`);
  });

  it.each([false, true])('preserves the Pages project path across map and mode navigation, comparison %s', compareAB => {
    const href = `https://marsigloo.github.io/scoutlight/?seed=9&v=1${compareAB ? '&compare=ab' : ''}#old`;
    expect(missionHref(href, 12345))
      .toBe(`https://marsigloo.github.io/scoutlight/?seed=12345&v=1${compareAB ? '&compare=ab' : ''}`);
    expect(missionHref(href, 9, !compareAB))
      .toBe(`https://marsigloo.github.io/scoutlight/?seed=9&v=1${compareAB ? '' : '&compare=ab'}`);
  });

  it('retains development mission review context only when explicitly selected', () => {
    const review = '?review=missions&seed=9&v=1&compare=ab';
    expect(parseMissionRequest(review, 'review').canonicalSearch).toBe(review);
    expect(missionHref(`http://127.0.0.1:5173/${review}#old`, 10, true, 'review'))
      .toBe('http://127.0.0.1:5173/?review=missions&seed=10&v=1&compare=ab');
    expect(parseMissionRequest('?review=missions', 'review').usedDefault).toBe(true);
    expect(parseMissionRequest(review).canonicalSearch).toBe('?seed=9&v=1&compare=ab');
  });

  it('canonicalizes fallbacks and removes alternate comparison encodings', () => {
    expect(parseMissionRequest('?preview=release&review=west-room&seed=9&v=2&compare=ab').canonicalSearch)
      .toBe('?seed=12345&v=1&compare=ab');
    expect(parseMissionRequest('?seed=9&compare=other&mode=ab').canonicalSearch)
      .toBe('?seed=9&v=1');
  });
});
