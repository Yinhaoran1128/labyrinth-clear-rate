import test from 'node:test';
import assert from 'node:assert/strict';
import {clearTimeInterval} from '../clear-time-interval.mjs';
const api = await import('../progressive-sampling.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const create = options => {
  assert.equal(typeof api.createProgressiveSampler, 'function', 'progressive sampler is missing');
  return api.createProgressiveSampler(options);
};

// Independent per-battle oracle, deliberately using a two-pass centered sum.
function summary(rows, seed = 1) {
  const n = rows.length, k = rows.reduce((s, r) => s + r[1], 0);
  const total = rows.reduce((s, r) => s + r[0], 0), mean = total / n;
  return {trials:n,completedTrials:n,statisticalTrials:n,successes:k,failures:n-k,
    failedByDeath:rows.filter(r => !r[1] && r[0] < 120).length,
    failedByTimeout:rows.filter(r => !r[1] && r[0] === 120).length,
    terminalDeaths:rows.filter(r => !r[1] && r[0] < 120).length,
    terminalTimeouts:rows.filter(r => !r[1] && r[0] === 120).length,
    totalSpentSeconds:total,durationSquaredSeconds:rows.reduce((s,r)=>s+r[0]**2,0),
    successSpentSeconds:rows.reduce((s,r)=>s+r[0]*r[1],0),durationMeanSeconds:mean,
    durationM2SecondsSquared:rows.reduce((s,r)=>s+(r[0]-mean)**2,0),
    durationSuccessComomentSeconds:rows.reduce((s,r)=>s+(r[0]-mean)*(r[1]-k/n),0),
    minElapsedSeconds:Math.min(...rows.map(r=>r[0])),maxElapsedSeconds:Math.max(...rows.map(r=>r[0])),
    clearChance:k/n,expectedSecondsPerClear:k?total/k:Infinity,simulatedSeconds:total,
    firstRunDebug:{seed,elapsedMs:n/2,requestedTrials:n,completedTrials:n,
      completedTrialsRecorded:n,targetBattles:n,completedSeconds:total,fullCompletedSeconds:total,
      simulatedTime:total*1e9,lastEncounterFinishTime:total*1e9,encounters:n,deaths:{player1:n-k}}};
}
const config = {monsterHrid:'/monsters/test',mazeDifficulty:100,playerDto:{level:80,buffs:[1,2]},mazeCrateItemHrids:[]};
const near = (actual,expected,tolerance=1e-9) => assert.ok(Object.is(actual,expected) || Math.abs(actual-expected)<tolerance, `${actual} != ${expected}`);

test('300 → 1000 → 3000 adds 300, 700, 2000 battles and reuses the largest cached count', async () => {
  const calls=[],progress=[];
  const sampler=create({keyPrefix:'engine-v1',run:async (params,onProgress)=>{
    calls.push(params);
    onProgress(params.trials/2,params.trials);onProgress(params.trials,params.trials);
    return summary(Array.from({length:params.trials},(_,i)=>[i%2?120:20,i%2?0:1]),params.seed);
  }});
  for (const trials of [300,1000,3000,1000,3000]) {
    const out=await sampler.ensure({...config,trials},(done,target)=>progress.push([done,target]));
    assert.equal(out.trials,Math.max(trials,calls.reduce((s,p)=>s+p.trials,0)));
  }
  assert.deepEqual(calls.map(p=>p.trials),[300,700,2000]);
  assert.equal(new Set(calls.map(p=>p.seed)).size,3);
  assert.ok(progress.some(([done,target])=>done===300 && target===1000));
  assert.ok(progress.some(([done,target])=>done===650 && target===1000));
  assert.ok(progress.some(([done,target])=>done===2000 && target===3000));
  const out=await sampler.ensure({...config,trials:300});
  assert.equal(out.clearChance,.5);
  assert.equal(out.expectedSecondsPerClear,140);
  assert.equal(out.totalSpentSeconds,210000);
  assert.equal(out.firstRunDebug.requestedTrials,3000);
  assert.equal(out.firstRunDebug.completedTrials,3000);
  assert.equal(out.firstRunDebug.elapsedMs,1500);
  assert.deepEqual(out.firstRunDebug.batches.map(b=>[b.startTrials,b.trials]),[[0,300],[300,700],[1000,2000]]);
  assert.equal(out.clearTimeInterval.status,'bounded');
});

test('merges centered variance and covariance with between-batch correction, then recomputes intervals', async () => {
  const groups=[[[10,1],[20,1]],[[120,0],[40,0],[30,1]],[[80,0]]];
  let i=0;
  const sampler=create({run:async params=>summary(groups[i++],params.seed)});
  for (const trials of [2,5,6]) await sampler.ensure({...config,trials});
  const out=await sampler.ensure({...config,trials:6}),expected=summary(groups.flat());
  for (const key of ['trials','successes','failures','failedByDeath','failedByTimeout','terminalDeaths',
    'terminalTimeouts','totalSpentSeconds','durationSquaredSeconds','successSpentSeconds',
    'durationMeanSeconds','durationM2SecondsSquared','durationSuccessComomentSeconds',
    'clearChance','expectedSecondsPerClear','minElapsedSeconds','maxElapsedSeconds']) near(out[key],expected[key]);
  const ci=clearTimeInterval(expected);
  near(out.clearTimeInterval.lower,ci.lower);
  near(out.clearTimeInterval.upper,ci.upper);
  assert.equal(out.firstRunDebug.simulatedTime,300e9);
  assert.deepEqual(out.firstRunDebug.deaths,{player1:3});
});

test('retains tiny centered variance without subtracting large raw moments', async () => {
  const sampler=create({run:async params=>({
    ...summary([[100,1],[100,0]],params.seed),
    durationM2SecondsSquared:2e-16,durationSuccessComomentSeconds:1e-8,
  })});
  await sampler.ensure({...config,trials:2});
  const out=await sampler.ensure({...config,trials:4});
  near(out.durationM2SecondsSquared,4e-16,1e-25);
  near(out.durationSuccessComomentSeconds,2e-8,1e-20);
});

test('last-success debug timestamp includes intervening failures and survives a batch without wins', async () => {
  const groups=[[[10,1],[120,0]],[[120,0],[20,1],[120,0]],[[120,0]]];
  const lastSuccess=[10e9,140e9,0];let i=0;
  const sampler=create({run:async p=>{
    const row=summary(groups[i],p.seed);
    row.firstRunDebug.lastEncounterFinishTime=lastSuccess[i++];
    return row;
  }});
  await sampler.ensure({...config,trials:2});
  const middle=await sampler.ensure({...config,trials:5});
  assert.equal(middle.firstRunDebug.lastEncounterFinishTime,270e9);
  const last=await sampler.ensure({...config,trials:6});
  assert.equal(last.firstRunDebug.lastEncounterFinishTime,270e9);
  assert.equal(last.firstRunDebug.simulatedTime,510e9);
});

test('keys all battle settings canonically; seeds reproduce across fresh samplers', async () => {
  const calls=[];
  const run=async p=>{calls.push(p);return summary(Array.from({length:p.trials},()=>[20,1]),p.seed);};
  const a=create({run,keyPrefix:'engine-v1'});
  await a.ensure({...config,trials:2});
  await a.ensure({trials:2,...config,playerDto:{buffs:[1,2],level:80}});
  assert.equal(calls.length,1,'object property order must not split the cache');
  await a.ensure({...config,trials:4});
  const firstSeeds=calls.map(p=>p.seed);
  const b=create({run,keyPrefix:'engine-v1'});
  await b.ensure({...config,trials:2});await b.ensure({...config,trials:4});
  assert.deepEqual(calls.slice(2).map(p=>p.seed),firstSeeds);
  for(const change of [{mazeDifficulty:101},{monsterHrid:'other'},{playerDto:{level:81}},
    {mazeCrateItemHrids:['tea']},{roomDurationSeconds:90}]) await a.ensure({...config,...change,trials:2});
  assert.equal(calls.length,9);
  const c=create({run,keyPrefix:'engine-v2'});await c.ensure({...config,trials:2});
  assert.notEqual(calls.at(-1).seed,firstSeeds[0]);
});

test('failed or incomplete batches never commit and retries use the same missing range', async () => {
  const calls=[];let mode='ok';
  const sampler=create({run:async p=>{
    calls.push(p);
    if(mode==='error')throw new Error('engine failure');
    return summary(Array.from({length:mode==='short'?1:p.trials},()=>[120,0]),p.seed);
  }});
  await sampler.ensure({...config,trials:2});
  mode='error';await assert.rejects(sampler.ensure({...config,trials:5}),/engine failure/);
  mode='short';await assert.rejects(sampler.ensure({...config,trials:5}),/场数|batch/i);
  mode='ok';const out=await sampler.ensure({...config,trials:5});
  assert.deepEqual(calls.map(p=>p.trials),[2,3,3,3]);
  assert.equal(new Set(calls.slice(1).map(p=>p.seed)).size,1);
  assert.equal(out.trials,5);assert.equal(out.successes,0);
  assert.equal(out.expectedSecondsPerClear,Infinity);
  assert.equal(out.clearTimeInterval.status,'no_success');
  assert.equal(out.firstRunDebug.batches.length,2);
});

test('cancellation rejects late results, preserves committed samples, and permits a clean retry', async () => {
  let release;let delay=false;const calls=[];
  const sampler=create({run:async p=>{
    calls.push(p);
    if(delay)await new Promise(resolve=>{release=resolve;});
    return summary(Array.from({length:p.trials},()=>[20,1]),p.seed);
  }});
  await sampler.ensure({...config,trials:2});delay=true;
  const pending=sampler.ensure({...config,trials:5});
  await Promise.resolve();sampler.cancel();release();
  await assert.rejects(pending,/取消|cancel/i);
  delay=false;const out=await sampler.ensure({...config,trials:5});
  assert.deepEqual(calls.map(p=>p.trials),[2,3,3]);
  assert.equal(out.trials,5);assert.equal(out.firstRunDebug.batches.length,2);
  assert.equal(out.clearTimeInterval.method,'hoeffding-binomial');
});

test('concurrent requests for one configuration cannot count overlapping batches twice', async () => {
  const calls=[];
  const sampler=create({run:async p=>{
    calls.push(p);await new Promise(resolve=>setTimeout(resolve,1));
    return summary(Array.from({length:p.trials},()=>[20,1]),p.seed);
  }});
  const out=await Promise.all([sampler.ensure({...config,trials:2}),sampler.ensure({...config,trials:5}),
    sampler.ensure({...config,trials:5})]);
  assert.deepEqual(calls.map(p=>p.trials),[2,3]);
  assert.deepEqual(out.map(row=>row.trials),[2,5,5]);
  assert.equal(out[2].firstRunDebug.batches.length,2);
});
