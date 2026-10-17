import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCalculators} from '../build.mjs';

test('build emits only the embedded calculator with completed-battle engine and correctly bound cancellation controls',async()=>{
  const paths=await buildCalculators();
  assert.deepEqual(Object.keys(paths),['embedded']);
  const source=fs.readFileSync(paths.embedded,'utf8');
  assert.match(source,/\/\/ @version\s+1\.8\.1/);
  assert.match(source,/rust-completed-battles-v6-progressive-/);
  assert.match(source,/const statisticalTrials = executedTrials;/);
  assert.doesNotMatch(source,/UPSTREAM_WASM|collectUpstreamStats|rust-remote|reconstructionProbes|simulationLimitNs|fetchCombatWorkerChunkText/);
  assert.match(source,/function setAutomationEstimateControlStatus\(status = \{\}\) \{\s+const root = [^;]+;\s+if \(root\) CancelControls.sync/);
  assert.doesNotMatch(source,/function getAutomationEstimateTrialsInput\(\) \{[^}]*CancelControls/s);
  assert.match(source,/function setControlStatus\(status\) \{\s+const root = [^;]+;\s+if \(root\) CancelControls.sync/);
  assert.equal(fs.existsSync(new URL('../../labyrinth-clear-rate-rust-remote.user.js',import.meta.url)),false);
});
