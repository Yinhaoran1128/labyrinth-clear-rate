import test from 'node:test';
import assert from 'node:assert/strict';
import { RustClient } from '../clients.mjs';

// The transport is replaced, not the Rust simulation. Exercise cancellation ownership:
// terminated transports cannot emit a reply and must not leave new promises pending.
test('a stopped Rust client rejects new requests immediately', async () => {
  const OriginalWorker=globalThis.Worker;
  globalThis.Worker=class{terminate(){}postMessage(){}};
  try {
    const client=new RustClient('');client.stop(new Error('crashed'));
    const outcome=await Promise.race([client.request('run',{}).then(()=>false,e=>e.message),
      new Promise(resolve=>setTimeout(()=>resolve('pending'),30))]);
    client.stop();
    assert.equal(outcome,'crashed');
  } finally {globalThis.Worker=OriginalWorker;}
});
