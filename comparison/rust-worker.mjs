import { Game, exportGameData, makeRustScenario, summarizeResult } from './core.mjs';
import { WasmEngine } from './vendor/fastsim-js/wasm-engine.mjs';
let engine=null, game=null;
self.onmessage=async({data:m})=>{
  try {
    if(m.type==='init') {
      // Common combat tables come from the pinned original engine, not a second game snapshot.
      game=new Game({...m.gameData,...m.originalMaps});
      engine=await WasmEngine.create(m.wasm);
      engine.loadGameData(JSON.stringify(exportGameData(game)));
      self.postMessage({id:m.id,type:'ready'});
    } else if(m.type==='run') {
      if(!engine) throw new Error('WASM 引擎尚未初始化');
      const scenario=makeRustScenario(game,m.params);
      const out=JSON.parse(engine.run(JSON.stringify(scenario),false));
      if(out.error) throw new Error(out.error);
      self.postMessage({id:m.id,type:'result',result:{...summarizeResult(out.result),events:out.events,seed:scenario.seed}});
    }
  } catch(error) {self.postMessage({id:m.id,type:'error',error:error?.message||String(error)});}
};
