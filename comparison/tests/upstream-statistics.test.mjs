import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixtureGame,fixturePlayer} from './fixtures.mjs';
import {makeRustScenario,exportGameData,MONSTERS} from '../core.mjs';
import {WasmEngine} from '../vendor/fastsim-js/wasm-engine.mjs';
import {collectUpstreamStats} from '../../calculator/upstream-statistics.mjs';

test('upstream reconstruction keeps timeout-only rooms and excludes an unfinished tail',async()=>{
  const game=fixtureGame();
  const engine=await WasmEngine.create(fs.readFileSync(new URL('../assets/mwi_engine.wasm',import.meta.url)));
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  const player=fixturePlayer(1000);player.equipment={};
  const scenario=makeRustScenario(game,{playerDto:player,monsterHrid:'/monsters/shadow_archer',
    mazeDifficulty:1,trials:3,seed:7,mazeCrateItemHrids:[]});
  scenario.players[0].equipStats.autoAttackDamage=-1;
  delete scenario.labyrinthFixedMonsterCooldown;delete scenario.labyrinthLegacyFury;
  const run=limit=>JSON.parse(engine.run(JSON.stringify({...scenario,simulationTimeLimit:limit}),false)).result;
  for(const limit of [119e9,120e9,120.5e9,240e9,360e9]) {
    const full=run(limit),{labyrinthStats:reference,...raw}=full;
    const stats=collectUpstreamStats(run,scenario,raw);
    assert.equal(stats.successes,0);
    assert.equal(stats.failedByDeath,0);
    assert.equal(stats.completedTrials,reference.completedTrials,`limit=${limit}`);
    assert.equal(stats.failedByTimeout,reference.failedByTimeout);
    assert.ok(Math.abs(stats.completedSpentNs-reference.completedSpentNs)<1);
  }
});

test('upstream reconstruction handles many fast victories without replaying each one',async()=>{
  const game=fixtureGame();
  const engine=await WasmEngine.create(fs.readFileSync(new URL('./upstream-engine.wasm',import.meta.url)));
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  const player=fixturePlayer(150);
  player.equipment={'/equipment_types/main_hand':{hrid:'/items/furious_spear',enhancementLevel:7}};
  const scenario=makeRustScenario(game,{playerDto:player,monsterHrid:'/monsters/shadow_archer',
    mazeDifficulty:1,trials:2000,seed:12345,mazeCrateItemHrids:[]});
  delete scenario.labyrinthFixedMonsterCooldown;delete scenario.labyrinthLegacyFury;
  let probes=0;
  const run=limit=>{probes++;assert.ok(probes<=3,'must skip per-room replay for a proven all-winning interval');return JSON.parse(engine.run(JSON.stringify({...scenario,simulationTimeLimit:limit}),false)).result;};
  const full=run(scenario.simulationTimeLimit);
  assert.ok(full.encounters>10000,'fixture must cover the previous replay ceiling');
  const stats=collectUpstreamStats(run,scenario,full);
  assert.equal(stats.completedTrials,full.encounters);
  assert.equal(stats.failedByTimeout,0);
  assert.ok(probes<=3,'a provably all-winning interval needs no per-room replay');
});

test('upstream encounter reconstruction matches native recorded counters for all ten monsters',async()=>{
  const game=fixtureGame();
  const engine=await WasmEngine.create(fs.readFileSync(new URL('../assets/mwi_engine.wasm',import.meta.url)));
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  const player=fixturePlayer();
  for(const monster of MONSTERS){
    const scenario=makeRustScenario(game,{playerDto:player,monsterHrid:monster.hrid,
      mazeDifficulty:30,trials:8,seed:12345,mazeCrateItemHrids:[]});
    delete scenario.labyrinthFixedMonsterCooldown;delete scenario.labyrinthLegacyFury;
    const run=limit=>{
      const out=JSON.parse(engine.run(JSON.stringify({...scenario,simulationTimeLimit:limit}),false));
      assert.equal(out.error,undefined);
      return out.result;
    };
    const full=run(scenario.simulationTimeLimit);
    const {labyrinthStats:reference,...upstreamShape}=full;
    const stats=collectUpstreamStats(run,scenario,upstreamShape);
    assert.equal(stats.completedTrials,reference.completedTrials,monster.key);
    assert.equal(stats.successes,reference.successes,monster.key);
    assert.equal(stats.failedByDeath,reference.failedByDeath,monster.key);
    assert.equal(stats.failedByTimeout,reference.failedByTimeout,monster.key);
    assert.ok(Math.abs(stats.completedSpentNs-reference.completedSpentNs)<1,monster.key);
  }
});
