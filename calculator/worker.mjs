import {Game,exportGameData,makeRustScenario,summarizeResult} from '../comparison/core.mjs';
import {WasmEngine} from '../comparison/vendor/fastsim-js/wasm-engine.mjs';
import {collectUpstreamStats} from './upstream-statistics.mjs';
let engine=null,game=null,mode=null,hash=null;
self.onmessage=async({data:m})=>{
  try {
    if(m.type==='init') {
      mode=m.mode;hash=m.hash;
      game=new Game(mode==='embedded'
        ? {...m.fallbackData,...m.gameData,...m.originalMaps}
        : {...m.fallbackData,...m.gameData});
      engine=await WasmEngine.create(m.wasm);
      engine.loadGameData(JSON.stringify(exportGameData(game)));
      self.postMessage({id:m.id,type:'ready'});
      return;
    }
    if(m.type!=='run')return;
    if(!engine)throw new Error('Rust 战斗引擎尚未初始化');
    const started=performance.now();
    const seed=m.params.seed??crypto.getRandomValues(new Uint32Array(1))[0];
    const scenario=makeRustScenario(game,{...m.params,seed});
    if(mode==='remote') {
      delete scenario.labyrinthFixedMonsterCooldown;
      delete scenario.labyrinthLegacyFury;
    }
    const run=limit=>{
      const out=JSON.parse(engine.run(JSON.stringify({...scenario,simulationTimeLimit:limit}),false));
      if(out.error)throw new Error(out.error);
      return out.result;
    };
    const full=run(scenario.simulationTimeLimit);
    const progress=ratio=>self.postMessage({id:m.id,type:'progress',ratio});
    if(!full.labyrinthStats) {
      progress(.1);
      full.labyrinthStats=collectUpstreamStats(run,scenario,full,ratio=>progress(.1+.9*ratio));
    }
    const stats=full.labyrinthStats;
    const result=summarizeResult(full);
    const elapsedMs=performance.now()-started;
    self.postMessage({id:m.id,type:'result',result:{
      trials:result.trials,successes:result.successes,totalSpentSeconds:result.totalSpentSeconds,
      failedByDeath:result.failedByDeath,failedByTimeout:result.failedByTimeout,
      minElapsedSeconds:stats.minElapsedSeconds??0,maxElapsedSeconds:stats.maxElapsedSeconds??0,
      firstRunDebug:{
        engineMode:mode,wasmSha256:hash,seed,elapsedMs,
        requestedTrials:m.params.trials,completedTrials:result.trials,
        completedTrialsRecorded:stats.completedTrials,encounters:full.encounters,
        simulatedTime:full.simulatedTime,lastEncounterFinishTime:full.lastEncounterFinishTime,
        simulationLimitNs:scenario.simulationTimeLimit,deaths:full.deaths,
        completedSeconds:result.totalSpentSeconds,fullCompletedSeconds:stats.completedSpentNs/1e9,
        reconstructionProbes:stats.reconstructionProbes??0,
      }
    }});
  } catch(error) {self.postMessage({id:m.id,type:'error',error:error?.message||String(error)});}
};
