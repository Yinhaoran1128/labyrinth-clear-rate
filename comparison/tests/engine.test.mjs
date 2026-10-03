import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixtureGame, fixturePlayer } from './fixtures.mjs';
import { MONSTERS, makeRustScenario, exportGameData, summarizeResult } from '../core.mjs';
import { WasmEngine } from '../vendor/fastsim-js/wasm-engine.mjs';

test('WASM completes all ten labyrinths and reports finished wins, deaths, timeouts and durations', async () => {
  const game=fixtureGame();
  const engine=await WasmEngine.create(fs.readFileSync(new URL('../assets/mwi_engine.wasm',import.meta.url)));
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  for (const monster of MONSTERS) {
    const sc=makeRustScenario(game,{playerDto:fixturePlayer(),monsterHrid:monster.hrid,
      mazeDifficulty:50,trials:5,seed:123,mazeCrateItemHrids:[]});
    const out=JSON.parse(engine.run(JSON.stringify(sc),false));
    assert.equal(out.error,undefined,monster.key);
    const stats=out.result.labyrinthStats;
    assert.ok(stats,`${monster.key}: missing labyrinth counters`);
    assert.ok(stats.completedTrials>0);
    assert.equal(stats.completedTrials,stats.successes+stats.failedByDeath+stats.failedByTimeout);
    assert.equal(stats.successes,out.result.encounters);
    assert.ok(stats.completedSpentNs>0 && stats.completedSpentNs<=out.result.simulatedTime);
    assert.ok(summarizeResult(out.result).clearChance>=0);
    assert.deepEqual(JSON.parse(engine.run(JSON.stringify(sc),false)),out,'fixed seed must reproduce');
  }
});

test('a powerless player records timeout-only completed trials, excluding the unfinished tail', async () => {
  const game=fixtureGame();
  const engine=await WasmEngine.create(fs.readFileSync(new URL('../assets/mwi_engine.wasm',import.meta.url)));
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  const dto=fixturePlayer(1000);dto.equipment={};
  const sc=makeRustScenario(game,{playerDto:dto,monsterHrid:'/monsters/shadow_archer',mazeDifficulty:1,
    trials:3,seed:7,mazeCrateItemHrids:[]});
  sc.players[0].equipStats.autoAttackDamage=-1;
  const out=JSON.parse(engine.run(JSON.stringify(sc),false));
  assert.equal(out.error,undefined);
  assert.equal(out.result.labyrinthStats.successes,0);
  assert.equal(out.result.labyrinthStats.failedByDeath,0);
  assert.ok(out.result.labyrinthStats.failedByTimeout>=2);
  assert.equal(summarizeResult(out.result).expectedSecondsPerClear,Infinity);
});

test('built WASM applies the Fury miss penalty instead of keeping a stronger old stack', async () => {
  const game=fixtureGame();
  // Remove incoming damage to isolate Fury's contribution to the 120-second limit.
  const monster=game.$e.combatMonsterDetailMap['/monsters/shadow_archer'];
  monster.abilities=[];monster.combatDetails.combatStats.autoAttackDamage=-1;
  const player=fixturePlayer(150);
  player.equipment={'/equipment_types/main_hand':{hrid:'/items/furious_spear',enhancementLevel:7}};
  const engine=await WasmEngine.create(fs.readFileSync(process.env.MWI_TEST_WASM ||
    new URL('../assets/mwi_engine.wasm',import.meta.url)));
  engine.loadGameData(JSON.stringify(exportGameData(game)));
  const scenario=makeRustScenario(game,{playerDto:player,monsterHrid:'/monsters/shadow_archer',
    mazeDifficulty:80,trials:50,seed:12345,mazeCrateItemHrids:[]});
  const result=summarizeResult(JSON.parse(engine.run(JSON.stringify(scenario),false)).result);
  // Independent reference: pinned stock JS with the same synthetic input and seed.
  // The previous WASM reports 26 wins; correct Fury replacement gives 24.
  assert.equal(result.trials,51);
  assert.equal(result.successes,24);
  assert.equal(result.failedByDeath,0);
  assert.equal(result.failedByTimeout,27);
  assert.ok(Math.abs(result.expectedSecondsPerClear-249.38334824090555)<.001);
});
