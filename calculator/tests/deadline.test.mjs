import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WasmEngine} from '../../comparison/vendor/fastsim-js/wasm-engine.mjs';
import {summarizeResult} from '../../comparison/core.mjs';

// Synthetic combat isolates event timestamps: zero attack levels/speed and no
// abilities, buffs or incoming attacks before the test event. No rounding beyond
// the engine's existing microsecond event resolution is introduced here.
async function fixture(winner) {
  const engine=await WasmEngine.create(fs.readFileSync(new URL('../../comparison/assets/mwi_engine.wasm',import.meta.url)));
  const combatDetails={attackInterval:500e9,combatStats:{combatStyleHrids:['/combat_styles/stab'],
    damageType:'/damage_types/physical',attackInterval:500e9,autoAttackDamage:winner==='monster'?1e8:-1,stabAccuracy:1e12}};
  for(const skill of ['stamina','intelligence','attack','melee','defense','ranged','magic'])combatDetails[`${skill}Level`]=0;
  engine.loadGameData(JSON.stringify({abilities:{},abilityAliases:{},combatStyles:{},triggerDependencies:{},
    monsters:{dummy:{experience:0,enrageTime:600e9,abilities:[],combatDetails}}}));
  const sc={seed:7,labyrinthTrials:1,labyrinthFixedMonsterCooldown:true,
    labyrinth:{monsterHrid:'dummy',roomLevel:100},players:[{hrid:'player1',levels:[0,0,0,0,0,0,0],
      equipStats:{autoAttackDamage:winner==='player'?1e8:-1,stabAccuracy:1e12},
      combatStyleHrid:'/combat_styles/stab',damageType:'/damage_types/physical',attackInterval:500e9,
      debuffOnLevelGap:0,abilities:[],food:[],drinks:[]}]};
  return {sc,combatDetails,engine};
}

for(const winner of ['player','monster']) {
  test(`actual WASM: ${winner} victory before/at 120 counts, after 120 times out`,async()=>{
    for(const seconds of [119.999999,120,120.000001]) {
      const {sc,combatDetails,engine}=await fixture(winner);
      if(winner==='player')sc.players[0].attackInterval=seconds*1e9;
      else {
        combatDetails.combatStats.attackInterval=seconds*1e9;
        engine.loadGameData(JSON.stringify({abilities:{},abilityAliases:{},combatStyles:{},triggerDependencies:{},
          monsters:{dummy:{experience:0,enrageTime:600e9,abilities:[],combatDetails}}}));
      }
      const out=JSON.parse(engine.run(JSON.stringify(sc),true));
      assert.equal(out.error,undefined);
      const r=out.result,s=r.labyrinthStats,late=seconds>120;
      assert.equal(s.completedTrials,1);
      assert.equal(s.successes,!late && winner==='player'?1:0);
      assert.equal(s.failedByDeath,!late && winner==='monster'?1:0);
      assert.equal(s.failedByTimeout,late?1:0);
      assert.equal(s.totalSpentSeconds,Math.min(seconds,120));
      assert.equal(s.durationSquaredSeconds,Math.min(seconds,120)**2);
      assert.equal(s.successSpentSeconds,!late && winner==='player'?seconds:0);
      if(late)assert.deepEqual(r.deaths,{},'late event must not cause any death');
    }
  });
}

test('actual WASM: N strict timeouts have exact total and squared duration, no successful duration',async()=>{
  const {sc,engine}=await fixture(null);sc.labyrinthTrials=7;
  // The fixture reuses one initialized WASM instance for the entire seven-battle run.
  const out=JSON.parse(engine.run(JSON.stringify(sc),false));assert.equal(out.error,undefined);
  const raw=out.result,s=raw.labyrinthStats,result=summarizeResult(raw,'completed');
  assert.equal(s.completedTrials,7);assert.equal(s.failedByTimeout,7);
  assert.equal(s.totalSpentSeconds,840);assert.equal(raw.simulatedTime,840e9);
  assert.equal(s.durationSquaredSeconds,7*120**2);assert.equal(s.successSpentSeconds,0);
  assert.equal(s.durationMeanSeconds,120);assert.equal(s.durationM2SecondsSquared,0);
  assert.equal(s.durationSuccessComomentSeconds,0);
  assert.equal(s.minElapsedSeconds,120);assert.equal(s.maxElapsedSeconds,120);
  assert.equal(result.expectedSecondsPerClear,Infinity);
});

test('actual WASM: simultaneous death before/at the deadline is success only; after it is timeout only',async()=>{
  for(const seconds of [119.999999,120,120.000001]) {
    const {sc,combatDetails,engine}=await fixture('player');
    sc.players[0].attackInterval=seconds*1e9;
    combatDetails.combatStats.physicalThorns=1e12;
    engine.loadGameData(JSON.stringify({abilities:{},abilityAliases:{},combatStyles:{},triggerDependencies:{},
      monsters:{dummy:{experience:0,enrageTime:600e9,abilities:[],combatDetails}}}));
    const out=JSON.parse(engine.run(JSON.stringify(sc),true));assert.equal(out.error,undefined);
    const r=out.result,s=r.labyrinthStats,late=seconds>120;
    assert.equal(s.completedTrials,1);assert.equal(s.successes,late?0:1);
    assert.equal(s.failedByDeath,0);assert.equal(s.failedByTimeout,late?1:0);
    if(!late)assert.equal(r.deaths.player1,1,'fixture must actually kill both sides');
    else assert.deepEqual(r.deaths,{});
    const result=summarizeResult(r,'completed');
    assert.equal(result.clearChance,late?0:1);
    assert.equal(result.failures,late?1:0);
    assert.equal(result.expectedSecondsPerClear,late?Infinity:seconds);
  }
});

test('strict default time API completes all deadline events and timeout even when its global budget is exactly 120 seconds',async()=>{
  const {sc,engine}=await fixture(null);
  delete sc.labyrinthTrials;sc.simulationTimeLimit=120e9;
  const out=JSON.parse(engine.run(JSON.stringify(sc),false));assert.equal(out.error,undefined);
  assert.equal(out.result.labyrinthStats.completedTrials,1);
  assert.equal(out.result.labyrinthStats.failedByTimeout,1);
  assert.equal(out.result.labyrinthStats.totalSpentSeconds,120);
});

test('completed-battle mode always uses the strict deadline even if a legacy comparison flag is supplied',async()=>{
  const {sc,engine}=await fixture('player');
  sc.players[0].attackInterval=120.000001e9;sc.labyrinthLegacyTimeout=true;
  const out=JSON.parse(engine.run(JSON.stringify(sc),false));assert.equal(out.error,undefined);
  assert.equal(out.result.labyrinthStats.successes,0);
  assert.equal(out.result.labyrinthStats.failedByTimeout,1);
  assert.equal(out.result.labyrinthStats.totalSpentSeconds,120);
});
