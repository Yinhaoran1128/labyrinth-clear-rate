import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, summarizeResult, makeRustScenario, totalTimings } from '../core.mjs';
import { fixtureGame, fixturePlayer } from './fixtures.mjs';

test('rejects invalid levels, trial budgets and seeds before any engine starts', () => {
  assert.deepEqual(validateSettings({level:100, trials:100, seed:0}), {level:100, trials:100, seed:0});
  for (const level of [0, -1, 1.5, NaN]) assert.throws(() => validateSettings({level, trials:100}));
  for (const trials of [0, 2001, 1.5, NaN]) assert.throws(() => validateSettings({level:100, trials}));
  assert.throws(() => validateSettings({level:100, trials:100, seed:4294967296}));
});

test('keeps the original expected-time convention including failures after the last win', () => {
  const result = summarizeResult({trials:3, successes:1, totalSpentSeconds:30, failedByDeath:2, failedByTimeout:0});
  assert.equal(result.clearChance, 1/3);
  assert.equal(result.expectedSecondsPerClear, 30);
  assert.equal(result.failures, 2);
  assert.equal(summarizeResult({trials:10, successes:0, totalSpentSeconds:1200}).expectedSecondsPerClear, Infinity);
});

test('Rust results use completed trials and expose full completed time separately', () => {
  const result = summarizeResult({encounters:1, lastEncounterFinishTime:30e9, simulatedTime:300e9,
    labyrinthStats:{completedTrials:3, successes:1, failedByDeath:2, failedByTimeout:0, completedSpentNs:270e9}});
  assert.equal(result.clearChance, 1/3);
  assert.equal(result.expectedSecondsPerClear, 30);
  assert.equal(result.completeExpectedSecondsPerClear, 270);
  assert.equal(result.trials, 3);
});

test('compatibility statistics retain the original simultaneous monster and player death denominator', () => {
  const result=summarizeResult({encounters:1,lastEncounterFinishTime:30e9,deaths:{player1:1},
    labyrinthStats:{completedTrials:1,successes:1,failedByDeath:0,failedByTimeout:0,completedSpentNs:30e9}});
  assert.equal(result.clearChance,.5);
  assert.equal(result.trials,2);
  assert.equal(result.failedByDeath,1);
  assert.equal(result.completedTrials,1);
});

test('adapts labyrinth upgrades, preserves triggers and removes consumables without mutating input', () => {
  const dto = fixturePlayer();
  dto.labyrinthUpgrades = {'/buff_uniques/labyrinth_upgrade_combat_damage':12,
    '/buff_uniques/labyrinth_upgrade_cast_speed':4};
  const before = JSON.stringify(dto);
  const sc = makeRustScenario(fixtureGame(), {playerDto:dto, monsterHrid:'/monsters/shadow_archer',
    mazeDifficulty:100, trials:100, seed:7, mazeCrateItemHrids:[]});
  assert.equal(sc.combatMode, 'labyrinth');
  assert.equal(sc.simulationTimeLimit, 12000e9);
  assert.equal(sc.labyrinth.monsterHrid, '/monsters/shadow_archer');
  assert.equal(sc.labyrinthFixedMonsterCooldown, true);
  assert.equal(sc.labyrinthLegacyFury, true);
  assert.equal(sc.players[0].permanentBuffs.find(b=>b.typeHrid==='/buff_types/damage').ratioBoost, .12);
  assert.equal(sc.players[0].permanentBuffs.find(b=>b.typeHrid==='/buff_types/cast_speed').flatBoost, .04);
  assert.deepEqual(sc.players[0].food, []);
  assert.equal(JSON.stringify(dto), before);
});

test('totals include completed engine runs and keep initialization out of compute timings', () => {
  assert.deepEqual(totalTimings([{legacy:{elapsedMs:20},rust:{elapsedMs:5}},
    {legacy:{elapsedMs:30},rust:{error:'failed'}}, {legacy:null,rust:{elapsedMs:7}}]),
    {legacyMs:50,rustMs:12,legacyCount:2,rustCount:2});
});

test('failed and stopped computations keep their elapsed time; unattempted rows contribute nothing', () => {
  assert.deepEqual(totalTimings([{legacy:{elapsedMs:180000,error:'timeout'},rust:{elapsedMs:500,error:'stopped'}},
    {legacy:{elapsedMs:1,error:'skipped',attempted:false}}]),
    {legacyMs:180000,rustMs:500,legacyCount:1,rustCount:1});
});
