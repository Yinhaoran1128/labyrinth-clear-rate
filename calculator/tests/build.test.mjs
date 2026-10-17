import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCalculators} from '../build.mjs';

test('build emits the embedded calculator without calculation progress markup or cancel controls',async()=>{
  const paths=await buildCalculators();
  assert.deepEqual(Object.keys(paths),['embedded']);
  const source=fs.readFileSync(paths.embedded,'utf8');
  assert.match(source,/rust-completed-battles-v6-progressive-/);
  assert.match(source,/const statisticalTrials = executedTrials;/);
  assert.doesNotMatch(source,/UPSTREAM_WASM|collectUpstreamStats|rust-remote|reconstructionProbes|simulationLimitNs|fetchCombatWorkerChunkText/);
  assert.equal(/CancelControls|data-cancel-battles|cancelCombatCalculation|combatCalculationCancelled/.test(source),false,'cancel controls must be removed');
  assert.equal(/<div class="\$\{CONTROL_CLASS\}__(?:progress|track|bar)">/.test(source),false,'calculation progress markup must be removed');
  assert.match(source,/\/\/ @version\s+1\.8\.2/);
  assert.equal(fs.existsSync(new URL('../../labyrinth-clear-rate-rust-remote.user.js',import.meta.url)),false);
});
