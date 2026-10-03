import {unpack,RustClient} from '../comparison/clients.mjs';

export const UPSTREAM_WASM='https://wow121.github.io/mwi-fastsim/engine/mwi_engine.wasm';

export function create(assets) {
  let client=null,promise=null,generation=0,abort=null;
  const progress=new Map();
  function reset(error=new Error('Rust 引擎已重置')) {
    generation++;abort?.abort();abort=null;
    client?.stop(error);client=null;promise=null;progress.clear();
  }
  function ensure(gameData) {
    if(promise)return promise;
    const token=generation;
    abort=new AbortController();
    const controller=abort;
    promise=(async()=>{
      let wasm;
      if(assets.mode==='remote') {
        const timer=setTimeout(()=>controller.abort(),30000);
        try {
          const response=await fetch(UPSTREAM_WASM,{mode:'cors',cache:'no-cache',credentials:'omit',signal:controller.signal});
          if(!response.ok)throw new Error(`远程引擎下载失败：HTTP ${response.status}`);
          wasm=await response.arrayBuffer();
        } catch(error) {
          if(controller.signal.aborted)throw new Error('远程引擎加载已取消或超过 30 秒');
          throw error;
        } finally {clearTimeout(timer);}
      } else {wasm=await unpack(assets.wasm);}
      const base=JSON.parse(await unpack(assets.data,true));
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wasm)),n=>n.toString(16).padStart(2,'0')).join('');
      if(assets.mode==='embedded' && hash!==assets.hash)throw new Error('内置引擎校验失败');
      if(token!==generation)throw new Error('Rust 引擎初始化已取消');
      client=new RustClient(assets.worker);
      const handler=client.worker.onmessage;
      client.worker.onmessage=event=>{
        const m=event.data;
        if(m.type==='progress')progress.get(m.id)?.(m.ratio);
        else handler(event);
      };
      client.worker.onerror=event=>reset(new Error(event.message||'Rust 引擎崩溃'));
      await client.request('init',{mode:assets.mode,wasm,hash,
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
  return {ensure,run,reset};
}
