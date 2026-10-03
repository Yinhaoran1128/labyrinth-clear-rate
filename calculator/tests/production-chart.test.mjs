import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../production-chart.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const chart = options => {
  assert.equal(typeof api.createProductionChartData, 'function', 'full-range production chart is missing');
  return api.createProductionChartData(options);
};
const computed = (level, type = 'skilling') => ({clearChance: level <= 10 ? .81 : .69,
  result: {skillingPreview: {type,successChance:.8,doubleChance:.1,attempts:12,
    effectiveProgressPerSuccess:100,workPower:100.5,targetLevel:type === 'enhancing' ? 5 : undefined}}});

test('calculates every integer level, preserves exact probabilities and compacts formula details', async () => {
  const calls = [], input = computed(10);
  const out = await chart({effectiveLevel:10.5,minDelta:-2,maxDelta:2,targetChance:.7,recommendedLevel:11,
    evaluate:async level=>{calls.push(level);return level===10 ? input : computed(level);}});
  assert.deepEqual(calls,[8,9,10,11,12]);
  assert.equal(out.kind,'production');
  assert.equal(out.levelCount,5);
  assert.equal(out.recommendedLevel,11);
  assert.equal(out.targetChance,.7);
  assert.deepEqual(out.curve.map(row=>row.clearChance),[.81,.81,.81,.69,.69]);
  const row=out.observations.find(row=>row.roomLevel===11);
  assert.equal(row.neededUnits,2);
  assert.equal(row.targetProgress,110);
  assert.equal(row.progressPerSuccess,100);
  assert.equal(row.successChance,.8);
  assert.equal(row.doubleChance,.1);
  assert.equal(row.attempts,12);
  for(const key of ['confidenceInterval','budget','trials','fittedChance','result'])assert.equal(row[key],undefined);
  assert.equal(input.id,undefined,'must not mutate calculator output');
});
test('clips the lower bound to one and computes each level only once', async () => {
  const calls=[];
  const out=await chart({effectiveLevel:2.5,minDelta:-300,maxDelta:3,targetChance:.7,recommendedLevel:1,
    evaluate:async level=>{calls.push(level);return computed(level);}});
  assert.deepEqual(calls,[1,2,3,4,5]);
  assert.equal(out.levelCount,5);
});
test('enhancing records its target without inventing ordinary progress requirements', async () => {
  const out=await chart({effectiveLevel:10,minDelta:0,maxDelta:0,targetChance:.7,recommendedLevel:10,
    evaluate:async level=>computed(level,'enhancing')});
  assert.equal(out.observations[0].type,'enhancing');
  assert.equal(out.observations[0].targetLevel,5);
  assert.equal(out.observations[0].neededUnits,null);
  assert.equal(out.observations[0].targetProgress,null);
});
test('does not plot missing or invalid formula results as zero wins', async () => {
  const params={effectiveLevel:1,minDelta:0,maxDelta:0,targetChance:.7,recommendedLevel:1};
  await assert.rejects(()=>chart({...params,evaluate:async()=>null}),/结果/);
  await assert.rejects(()=>chart({...params,evaluate:async()=>({...computed(1),clearChance:NaN})}),/胜率/);
});
