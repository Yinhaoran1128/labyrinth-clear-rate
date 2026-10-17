import {clearTimeInterval} from './clear-time-interval.mjs';
import {Game,exportGameData,makeRustScenario,summarizeResult} from '../comparison/core.mjs';
import {WasmEngine} from '../comparison/vendor/fastsim-js/wasm-engine.mjs';
let engine=null,game=null,hash=null,activeId=null;
self.onmessage=async({data:m})=>{
  try {
    if(m.type==='init') {
      hash=m.hash;
      game=new Game({...m.fallbackData,...m.gameData,...m.originalMaps});
      engine=await WasmEngine.create(m.wasm,(completed,target)=>{
        self.postMessage({id:activeId,type:'progress',completed,target});
      });
      engine.loadGameData(JSON.stringify(exportGameData(game)));
      self.postMessage({id:m.id,type:'ready'});
      return;
    }
    if(m.type!=='run')return;
    if(!engine)throw new Error('Rust 战斗引擎尚未初始化');
    const started=performance.now();
    const seed=m.params.seed??crypto.getRandomValues(new Uint32Array(1))[0];
    activeId=m.id;
    const scenario=makeRustScenario(game,{...m.params,seed},{completedBattles:true});
    const out=JSON.parse(engine.run(JSON.stringify(scenario),false));
    if(out.error)throw new Error(out.error);
    const full=out.result;
    const stats=full.labyrinthStats;
    const result=summarizeResult(full,'completed');
    const elapsedMs=performance.now()-started;
    self.postMessage({id:m.id,type:'result',result:{
      ...result,clearTimeInterval:clearTimeInterval(result),
      failedByDeath:result.failedByDeath,failedByTimeout:result.failedByTimeout,
      minElapsedSeconds:stats.minElapsedSeconds??0,maxElapsedSeconds:stats.maxElapsedSeconds??0,
      firstRunDebug:{
        engineMode:'embedded',wasmSha256:hash,seed,elapsedMs,
        battleDurationLimitSeconds:120,timeoutMode:'strict',
        requestedTrials:m.params.trials,completedTrials:result.trials,
        completedTrialsRecorded:stats.completedTrials,encounters:full.encounters,
        simulatedTime:full.simulatedTime,lastEncounterFinishTime:full.lastEncounterFinishTime,
        targetBattles:scenario.labyrinthTrials,deaths:full.deaths,
        completedSeconds:result.totalSpentSeconds,fullCompletedSeconds:stats.completedSpentNs/1e9,
      }
    }});
  } catch(error) {self.postMessage({id:m.id,type:'error',error:error?.message||String(error)});}
};
