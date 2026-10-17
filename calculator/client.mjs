import {unpack,RustClient} from '../comparison/clients.mjs';
import {createProgressiveSampler} from './progressive-sampling.mjs';

export function create(assets) {
  let client=null,promise=null,generation=0;
  const progress=new Map();
  const sampler=createProgressiveSampler({run,keyPrefix:assets.hash});
  function reset(error=new Error('Rust 引擎已重置')) {
    generation++;
    sampler.cancel();
    client?.stop(error);client=null;promise=null;progress.clear();
  }
  function ensure(gameData) {
    if(promise)return promise;
    const token=generation;
    promise=(async()=>{
      const wasm=await unpack(assets.wasm);
      const base=JSON.parse(await unpack(assets.data,true));
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wasm)),n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==assets.hash)throw new Error('内置引擎校验失败');
      if(token!==generation)throw new Error('Rust 引擎初始化已取消');
      client=new RustClient(assets.worker);
      const handler=client.worker.onmessage;
      client.worker.onmessage=event=>{
        const m=event.data;
        if(m.type==='progress')progress.get(m.id)?.(m.completed,m.target);
        else handler(event);
      };
      client.worker.onerror=event=>reset(new Error(event.message||'Rust 引擎崩溃'));
      await client.request('init',{wasm,hash,
        gameData:gameData?.maps||gameData||{},fallbackData:base.fallbackData,
        originalMaps:base.originalMaps},[wasm]);
      if(token!==generation)throw new Error('Rust 引擎初始化已取消');
      return client;
    })().catch(error=>{if(token===generation)reset(error);throw error;});
    return promise;
  }
  async function run(params,onProgress) {
    if(!client || client.stoppedError)throw new Error('Rust 引擎尚未初始化');
    const id=client.nextId+1;
    progress.set(id,onProgress);
    try {return await client.request('run',{params});}
    finally {progress.delete(id);}
  }
  return {ensure,run,reset,runProgressive:({progressive:_progressive,...params},onProgress)=>sampler.ensure(params,onProgress)};
}
