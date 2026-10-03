import fs from 'node:fs';
import { fixtureGame } from './fixtures.mjs';
import { stockEngine } from './stock-engine.mjs';
import { Game,exportGameData,makeRustScenario,summarizeResult } from '../core.mjs';
import { WasmEngine } from '../vendor/fastsim-js/wasm-engine.mjs';

const input=process.argv[2];
if(!input)throw new Error('Usage: node tests/replay-export.mjs <export.json> [output.json] [previous.wasm]');
const report=JSON.parse(fs.readFileSync(input));
const stock=await stockEngine();
const game=new Game({...fixtureGame().$e,...stock.maps});
const data=JSON.stringify(exportGameData(game));
const engine=await WasmEngine.create(fs.readFileSync(new URL('../assets/mwi_engine.wasm',import.meta.url)));
engine.loadGameData(data);
const previous=process.argv[4]?await WasmEngine.create(fs.readFileSync(process.argv[4])):null;
if(previous)previous.loadGameData(data);
const results=[];
for(const row of report.rows.filter(r=>r.input)) {
  const params={...row.input,seed:12345};
  const scenario=JSON.stringify(makeRustScenario(game,params));
  const legacy=await stock.run(params);
  const rust=summarizeResult(JSON.parse(engine.run(scenario,false)).result);
  const prior=previous?summarizeResult(JSON.parse(previous.run(scenario,false)).result):null;
  const result={key:row.key,name:row.name,level:params.mazeDifficulty,seed:params.seed,legacy,rust,prior};
  results.push(result);console.log(JSON.stringify(result));
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({seed:12345,rows:results},null,2));
}
