import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixtureGame,fixturePlayer} from '../../comparison/tests/fixtures.mjs';
import {makeRustScenario,exportGameData,summarizeResult,MONSTERS} from '../../comparison/core.mjs';
import {WasmEngine} from '../../comparison/vendor/fastsim-js/wasm-engine.mjs';

async function fixture(onProgress=()=>{}) {
  const game=fixtureGame();
  const engine=await WasmEngine.create(fs.readFileSync(new URL('../../comparison/assets/mwi_engine.wasm',import.meta.url)),onProgress);
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  const sc=makeRustScenario(game,{playerDto:fixturePlayer(),monsterHrid:'/monsters/shadow_archer',mazeDifficulty:50,
    trials:7,seed:123,mazeCrateItemHrids:[]},{completedBattles:true});
  const run=sc=>{const out=JSON.parse(engine.run(JSON.stringify(sc),false));assert.equal(out.error,undefined);return out.result;};
  return {sc,run};
}

test('calculator requests completed battles with no global time budget; comparison retains its time mode',async()=>{
  const {sc}=await fixture();
  assert.equal(sc.labyrinthTrials,7);
  assert.equal(sc.simulationTimeLimit,undefined);
  assert.equal(sc.labyrinthLegacyTimeout,undefined);
});

test('WASM completes exactly N, reports live monotone completed/N progress and reproduces seeds',async()=>{
  const progress=[];
  const {sc,run}=await fixture((completed,target)=>progress.push([completed,target]));
  for(const n of [1,7,300,1000,3000]) {
    progress.length=0;
    const result=run({...sc,labyrinthTrials:n,simulationTimeLimit:1});
    const stats=result.labyrinthStats;
    assert.equal(stats.completedTrials,n);
    assert.equal(stats.successes+stats.failedByDeath+stats.failedByTimeout,n);
    assert.ok(Math.abs(result.simulatedTime-stats.completedSpentNs)<1);
    assert.deepEqual(progress.at(-1),[n,n]);
    assert.ok(progress.length>0 && progress.every(([done,target],i)=>target===n && done<=n && (i===0 || done>progress[i-1][0])));
    assert.deepEqual(run({...sc,labyrinthTrials:n}),result);
  }
});

test('all wins, all deaths, all timeouts and mixed outcomes have exact counts and duration moments',async()=>{
  const {sc,run}=await fixture();
  const runAt=(level,equipStats={})=>run({...sc,labyrinth:{...sc.labyrinth,roomLevel:level},
    players:[{...sc.players[0],equipStats:{...sc.players[0].equipStats,...equipStats}}],labyrinthTrials:50});
  const wins=runAt(1,{autoAttackDamage:1e6,rangedAccuracy:1e6}).labyrinthStats;
  const deaths=runAt(1000).labyrinthStats;
  const timeout=runAt(1,{autoAttackDamage:-1,armor:1e9}).labyrinthStats;
  assert.equal(wins.successes,50);
  assert.equal(deaths.failedByDeath,50);
  assert.equal(timeout.failedByTimeout,50);
  assert.equal(timeout.successes,0);
  assert.equal(timeout.minElapsedSeconds,120);
  assert.equal(timeout.maxElapsedSeconds,120);
  assert.equal(timeout.totalSpentSeconds,50*120);
  const mixed=runAt(1).labyrinthStats;
  assert.ok(mixed.successes>0 && mixed.successes<50);
  for(const s of [wins,deaths,timeout,mixed]) {
    assert.equal(s.completedTrials,50);
    assert.ok(Math.abs(s.completedSpentNs/1e9-s.totalSpentSeconds)<1e-8);
    assert.ok(Math.abs(s.durationMeanSeconds*50-s.totalSpentSeconds)<1e-8);
    assert.ok(Math.abs(s.durationSquaredSeconds-s.durationM2SecondsSquared-50*s.durationMeanSeconds**2)<1e-6);
    assert.ok(s.successSpentSeconds<=s.totalSpentSeconds+1e-8);
    assert.ok(s.durationM2SecondsSquared>=0);
  }
  const summary=summarizeResult({labyrinthStats:timeout},'completed');
  assert.equal(summary.expectedSecondsPerClear,Infinity);
});

test('prefix differences provide per-battle durations with advancing RNG and correct success sums',async()=>{
  const {sc,run}=await fixture();
  let previous=0,previousWins=0,sum=0,sum2=0,successSum=0;
  const durations=[];
  for(let n=1;n<=20;n++) {
    const s=run({...sc,labyrinthTrials:n}).labyrinthStats;
    const duration=s.totalSpentSeconds-previous;
    durations.push(duration);sum+=duration;sum2+=duration*duration;
    if(s.successes>previousWins)successSum+=duration;
    assert.ok(Math.abs(s.durationSquaredSeconds-sum2)<1e-7);
    assert.ok(Math.abs(s.successSpentSeconds-successSum)<1e-8);
    assert.ok(Math.abs(s.durationSuccessComomentSeconds-(successSum-s.totalSpentSeconds*s.successes/n))<1e-8);
    previous=s.totalSpentSeconds;previousWins=s.successes;
  }
  assert.ok(new Set(durations.map(d=>d.toFixed(5))).size>1,'separate fights must not replay the same seed');
  assert.equal(sum,previous);
});

test('every labyrinth honors the same exact completed-battle contract',async()=>{
  const {sc,run}=await fixture();
  for(const monster of MONSTERS) {
    const result=run({...sc,labyrinth:{...sc.labyrinth,monsterHrid:monster.hrid},labyrinthTrials:3});
    assert.equal(result.labyrinthStats.completedTrials,3,monster.key);
  }
});
