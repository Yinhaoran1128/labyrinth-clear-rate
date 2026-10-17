// Optional regression audit against a pre-change local WASM. No old binary is shipped.
// node comparison/tests/compare-completed-battles.mjs /absolute/path/before.wasm
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fixtureGame,fixturePlayer} from './fixtures.mjs';
import {MONSTERS,makeRustScenario,exportGameData,summarizeResult} from '../core.mjs';
import {WasmEngine} from '../vendor/fastsim-js/wasm-engine.mjs';
const baseline=process.argv[2];
if(!baseline)throw new Error('Provide the pre-change WASM path');
const game=fixtureGame(),data=JSON.stringify(exportGameData(game));
const engines=await Promise.all([baseline,new URL('../assets/mwi_engine.wasm',import.meta.url)].map(async path=>{
  const engine=await WasmEngine.create(fs.readFileSync(path));engine.loadGameData(data);return engine;
}));
const run=(engine,scenario)=>{const r=JSON.parse(engine.run(JSON.stringify(scenario),false));assert.equal(r.error,undefined);return r;};
const rows=[];
for(const monster of MONSTERS) for(const roomLevel of [1,50]) {
  let oldCount=0,winsOld=0,winsNew=0,secondsOld=0,secondsNew=0,minOld=Infinity,maxOld=0;
  for(let seed=1;seed<=20;seed++) {
    const params={playerDto:fixturePlayer(),monsterHrid:monster.hrid,mazeDifficulty:roomLevel,trials:100,seed};
    const scenario=makeRustScenario(game,params);
    const before=run(engines[0],scenario),after=run(engines[1],scenario);
    assert.equal(before.events,after.events,`${monster.key}/${seed} event count`);
    for(const key of ['encounters','deaths','simulatedTime','lastEncounterFinishTime'])assert.deepEqual(after.result[key],before.result[key],`${monster.key}/${seed}/${key}`);
    for(const key of ['completedTrials','successes','failedByDeath','failedByTimeout'])assert.equal(after.result.labyrinthStats[key],before.result.labyrinthStats[key]);
    assert.ok(Math.abs(after.result.labyrinthStats.completedSpentNs-before.result.labyrinthStats.completedSpentNs)<.1);
    const fixed=run(engines[1],makeRustScenario(game,params,{completedBattles:true}));
    assert.equal(fixed.result.labyrinthStats.completedTrials,100);
    const a=summarizeResult(before.result,'completed'),b=summarizeResult(fixed.result,'completed');
    oldCount+=a.trials;winsOld+=a.successes;winsNew+=b.successes;
    secondsOld+=a.totalSpentSeconds;secondsNew+=b.totalSpentSeconds;
    minOld=Math.min(minOld,a.trials);maxOld=Math.max(maxOld,a.trials);
  }
  rows.push({monster:monster.key,roomLevel,seeds:20,newBattles:2000,oldBattles:oldCount,minOld,maxOld,
    oldWinRate:winsOld/oldCount,newWinRate:winsNew/2000,
    oldExpectedSeconds:winsOld?secondsOld/winsOld:null,newExpectedSeconds:winsNew?secondsNew/winsNew:null});
}
console.log(JSON.stringify({ruleParityScenarios:400,requestedPerSeed:100,rows},null,2));
