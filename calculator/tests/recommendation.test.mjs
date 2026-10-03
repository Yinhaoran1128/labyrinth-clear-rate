import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../recommendation.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const fit = rows => {
  assert.equal(typeof api.fitDecreasingWinRates, 'function', 'weighted monotone fitting is missing');
  return api.fitDecreasingWinRates(rows);
};
const search = options => {
  assert.equal(typeof api.findCombatRecommendation, 'function', 'fitted combat recommendation is missing');
  return api.findCombatRecommendation(options);
};
const observation = (roomLevel, chance, trials = 100) => ({roomLevel, clearChance: chance,
  result: {clearChance: chance, combatMeta: {trials, successes: chance * trials}}});

// Catch equal weighting, the wrong monotone direction, and missing cascading merges.
test('weights by actual completed statistics and pools cascading reversals', () => {
  const rows = [observation(120, .9), observation(100, .8), observation(110, .6, 10)];
  const out = fit(rows);
  assert.deepEqual(out.map(x => x.roomLevel), [100, 110, 120]);
  for (const row of out) assert.ok(Math.abs(row.fittedChance - 176 / 210) < 1e-12);
  assert.equal(rows[0].fittedChance, undefined, 'must not overwrite raw simulation results');
});
test('keeps an already decreasing curve and handles empty input', () => {
  assert.deepEqual(fit([]), []);
  assert.deepEqual(fit([observation(1, 1), observation(2, .7), observation(3, 0)])
    .map(x => x.fittedChance), [1, .7, 0]);
});
// Catch retaining the old integer-percent or minimum-target selection rules.
test('chooses the closest unrounded fitted probability, including below target', () => {
  assert.equal(typeof api.selectNearestFittedSample, 'function');
  const out = api.selectNearestFittedSample(fit([observation(10, .704), observation(11, .698)]), .7);
  assert.equal(out.roomLevel, 11);
  assert.equal(out.clearChance, .698);
});
test('breaks equal-distance and pooled-plateau ties toward the higher level', () => {
  assert.equal(typeof api.selectNearestFittedSample, 'function');
  assert.equal(api.selectNearestFittedSample(fit([observation(10, .72), observation(11, .68)]), .7).roomLevel, 11);
  const pooled = fit([observation(10, .8), observation(11, .6, 10), observation(12, .9, 10)]);
  assert.equal(api.selectNearestFittedSample(pooled, .7).roomLevel, 12);
});
// Use an analytic curve as the expensive simulator boundary; expectations are hand-derived.
test('locates and verifies the nearest integer level on a decreasing curve', async () => {
  const calls = [];
  const out = await search({effectiveLevel: 100, targetChance: .7, minDelta: -300, maxDelta: 300,
    evaluate: async (level, budget) => {
      calls.push({level, budget});
      return observation(level, Math.max(0, Math.min(1, .7 - (level - 150) * .01)), budget * 2);
    }});
  assert.equal(out.roomLevel, 150);
  assert.equal(out.levelDelta, 50);
  assert.ok(Math.abs(out.fittedChance - .7) < 1e-12);
  assert.ok(calls.some(x => x.level === 150 && x.budget > 30), 'finalist must be verified beyond the coarse budget');
  assert.ok(calls.every(x => x.level >= 1 && x.level <= 400));
  assert.ok(calls.length < 80, 'must not exhaustively simulate the entire range');
});
test('finds a crossing below the baseline and clamps room levels to one', async () => {
  const seen = [];
  const out = await search({effectiveLevel: 4.5, targetChance: .7, minDelta: -300, maxDelta: 300,
    evaluate: async (level, budget) => {
      seen.push(level);
      return observation(level, Math.max(0, .7 - (level - 2) * .1), budget);
    }});
  assert.equal(out.roomLevel, 2);
  assert.equal(out.levelDelta, -2);
  assert.ok(seen.every(x => x >= 1));
});
test('returns the closest range endpoint for an unattainable target', async () => {
  const out = await search({effectiveLevel: 100, targetChance: .7, minDelta: -300, maxDelta: 300,
    evaluate: async (level, budget) => observation(level, 1, budget)});
  assert.equal(out.roomLevel, 400);
  assert.equal(out.fittedChance, 1);
});
test('preserves simulator failures instead of treating them as zero wins', async () => {
  await assert.rejects(() => search({effectiveLevel: 100, targetChance: .7,
    evaluate: async () => {throw new Error('engine unavailable');}}), /engine unavailable/);
});
test('rejects missing or empty statistics instead of giving them arbitrary fit weight', async () => {
  assert.throws(() => fit([observation(10, .7, 0)]), /场次数/);
  await assert.rejects(() => search({effectiveLevel: 100, targetChance: .7,
    evaluate: async () => null}), /未返回结果/);
});
test('relocates after a coarse sample wrongly sends the search downward', async () => {
  const out = await search({effectiveLevel: 100, targetChance: .7,
    evaluate: async (level, budget) => observation(level,
      level === 100 && budget === 30 ? .3 : Math.max(0, Math.min(1, .7 - (level - 100) * .01)), budget)});
  assert.equal(out.roomLevel, 100);
  assert.equal(out.budget, 1000);
});
test('finds the highest level of a wide plateau matching the target', async () => {
  let calls = 0;
  const out = await search({effectiveLevel: 100, targetChance: .7,
    evaluate: async (level, budget) => {
      calls++;
      return observation(level, level <= 300 ? .7 : .4, budget);
    }});
  assert.equal(out.roomLevel, 300);
  assert.ok(calls < 80, 'flat curves must not degenerate into scanning each level');
});
test('finds the high end of the nearest plateau when it lies below the target', async () => {
  let calls = 0;
  const out = await search({effectiveLevel: 100, targetChance: .7,
    evaluate: async (level, budget) => {
      calls++;
      return observation(level, level <= 100 ? .8 : level <= 300 ? .69 : .4, budget);
    }});
  assert.equal(out.roomLevel, 300);
  assert.ok(Math.abs(out.fittedChance - .69) < 1e-12);
  assert.ok(calls < 80);
});
test('handles zero and full target probabilities without out-of-range extrapolation', async () => {
  const evaluate = async (level, budget) => observation(level, level <= 110 ? 1 : .95, budget);
  const full = await search({effectiveLevel: 100, targetChance: 1, evaluate});
  const zero = await search({effectiveLevel: 100, targetChance: 0, evaluate});
  assert.equal(full.roomLevel, 110);
  assert.equal(zero.roomLevel, 400);
});
test('returns every completed simulation round including replaced coarse samples for plotting', async () => {
  let calls = 0;
  const out = await search({effectiveLevel: 100, targetChance: .7,
    evaluate: async (level, budget) => {
      calls++;
      return observation(level, Math.max(0, Math.min(1, .7 - (level - 150) * .01)), budget * 2);
    }});
  assert.ok(out.recommendationChart, 'recommendation chart trace is missing');
  const trace = out.recommendationChart;
  assert.equal(trace.observations.length, calls);
  assert.equal(trace.targetChance, .7);
  assert.equal(trace.recommendedLevel, 150);
  assert.deepEqual(trace.observations.filter(row => row.roomLevel === 150).map(row => row.budget), [30, 100, 300, 1000]);
  assert.equal(trace.observations.filter(row => row.isLatest).length, trace.curve.length);
  const final = trace.observations.find(row => row.roomLevel === 150 && row.isLatest);
  assert.equal(final.trials, 2000);
  assert.equal(final.confidenceInterval.confidenceLevel, .95);
  assert.ok(final.confidenceInterval.lower < .7 && final.confidenceInterval.upper > .7);
});
