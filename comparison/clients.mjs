export async function unpack(base64, text=false) {
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer=await new Response(stream).arrayBuffer();
  return text?new TextDecoder().decode(buffer):buffer;
}

export async function initializeOriginal(api, workerSource, signal) {
  api.setWorkerSource(workerSource);
  const worker=await api.ensureCombatSimulatorWorker();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>done(new Error('原引擎初始化超时')),30000);
    function done(error,maps) { clearTimeout(timeout);worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onError);signal?.removeEventListener('abort',onAbort);error?reject(error):resolve({worker,maps}); }
    function onAbort(){done(new Error('测试已停止'));}
    function onMessage({data}) { if(data.type==='comparison_ready') done(null,data.maps); }
    function onError(event) {done(new Error(event.message||'原引擎加载失败'));}
    worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){onAbort();return;}
    worker.postMessage({type:'comparison_init'});
  });
}

export class RustClient {
  constructor(source) {
    this.url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    this.worker=new Worker(this.url);
    this.nextId=0;this.pending=new Map();this.stoppedError=null;
    this.worker.onmessage=({data:m})=>{
      const p=this.pending.get(m.id);if(!p)return;
      clearTimeout(p.timer);this.pending.delete(m.id);
      m.type==='error'?p.reject(new Error(m.error)):p.resolve(m.result||m);
    };
    this.worker.onerror=e=>this.stop(new Error(e.message||'WASM 引擎崩溃'));
  }
  request(type,data,transfer=[]) {
    if(this.stoppedError)return Promise.reject(this.stoppedError);
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.stop(new Error('WASM 引擎计算超时')),180000);
      this.pending.set(id,{resolve,reject,timer});
      try {this.worker.postMessage({type,id,...data},transfer);}
      catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  stop(error=new Error('测试已停止')) {
    if(this.stoppedError)return;
    this.stoppedError=error;
    this.worker.terminate();URL.revokeObjectURL(this.url);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}
    this.pending.clear();
  }
}
