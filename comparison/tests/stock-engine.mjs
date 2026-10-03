import fs from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { legacyWorkerBridgeSource } from '../legacy.mjs';
import { summarizeResult } from '../core.mjs';

// Run the pinned original Worker source directly in an isolated JS context.
// Only browser platform primitives are supplied; combat and aggregation are unmodified.
export async function stockEngine() {
  const read=p=>fs.readFileSync(new URL(p,import.meta.url));
  const source=read('../../labyrinth-clear-rate.user.js').toString();
  const start=source.indexOf('    function buildCombatSimulatorWorkerSource(');
  const end=source.indexOf('    function resetCombatSimulatorWorker(',start);
  const build=Function(source.slice(start,end)+';return buildCombatSimulatorWorkerSource')();
  const worker=build(gunzipSync(read('../vendor/legacy/vendor.js.gz')).toString(),
    gunzipSync(read('../vendor/legacy/worker.js.gz')).toString());
  const context=vm.createContext({console,performance,setTimeout,clearTimeout,
    EventTarget,Event,CustomEvent,structuredClone});
  context.self=context;
  let messages=[];context.postMessage=m=>messages.push(m);
  vm.runInContext(worker+legacyWorkerBridgeSource(),context);
  await context.onmessage({data:{type:'comparison_init'}});
  const maps=messages.pop().maps;
  return {maps,async run(params) {
    messages=[];
    await context.onmessage({data:{type:'comparison_seed',seed:params.seed??null}});
    await context.onmessage({data:{type:'simulate_room',requestId:1,...params}});
    const result=messages.find(m=>m.type==='room_result');
    if(!result)throw new Error(messages.find(m=>m.type==='room_error')?.error||'Missing original result');
    return summarizeResult(result);
  }};
}
