import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecommendationChartData} from '../chart-data.mjs';
const api = await import('../chart-data.mjs');
const interval = (p, n) => {
  assert.equal(typeof api.binomialWinRateInterval, 'function', '95% binomial interval is missing');
  return api.binomialWinRateInterval(p, n);
};
test('Wilson 95% intervals use actual n and asymmetric binomial bounds', () => {
  const out = interval(.7, 100);
  assert.ok(Math.abs(out.lower - .6041514536665333) < 1e-12);
  assert.ok(Math.abs(out.upper - .7810511470506724) < 1e-12);
  assert.equal(out.confidenceLevel, .95);
  assert.equal(out.method, 'wilson');
  const larger = interval(.7, 400);
  assert.ok(larger.upper - larger.lower < out.upper - out.lower);
});
test('zero and full observed wins retain nonzero uncertainty within probability bounds', () => {
  const zero = interval(0, 100), full = interval(1, 100);
  assert.equal(zero.lower, 0);
  assert.ok(Math.abs(zero.upper - .03699349820698568) < 1e-12);
  assert.equal(full.upper, 1);
  assert.ok(Math.abs(full.lower - .9630065017930143) < 1e-12);
});
test('invalid statistical denominators cannot produce misleading error bars', () => {
  assert.throws(() => interval(.7, 0), /统计/);
  assert.throws(() => interval(.7, NaN), /统计/);
  assert.throws(() => interval(1.1, 100), /胜率/);
});
test('trace records all rounds but fits only the latest round per level', () => {
  const history = [
    {id:1,roomLevel:100,budget:30,trials:40,successes:20,clearChance:.5},
    {id:2,roomLevel:110,budget:30,trials:100,successes:40,clearChance:.4},
    {id:3,roomLevel:100,budget:300,trials:400,successes:280,clearChance:.7},
  ];
  const fit = [{roomLevel:100,fittedChance:.7},{roomLevel:110,fittedChance:.4}];
  const out = createRecommendationChartData({history,fit,targetChance:.7,recommendedLevel:100});
  assert.equal(out.observations.length, 3);
  assert.deepEqual(out.observations.map(x => x.isLatest), [false,true,true]);
  assert.ok(out.observations[0].confidenceInterval.lower < .5);
  assert.ok(out.observations[0].confidenceInterval.upper > .5);
  assert.ok(out.observations[2].confidenceInterval.upper < .75);
  assert.deepEqual(out.curve, fit);
  assert.equal(out.levelCount, 2);
  assert.equal(history[0].isLatest, undefined);
});
