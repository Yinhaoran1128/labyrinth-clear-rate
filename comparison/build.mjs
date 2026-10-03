import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { legacyFactorySource, legacyWorkerBridgeSource } from './legacy.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const basePath=path.join(here,'../labyrinth-clear-rate.user.js');
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function buildComparison() {
  const base=fs.readFileSync(basePath,'utf8');
  const expected='aa4ffc048f53e7d628a52b8ccfe7c633979580fdaaf5df3a8102818be02d1da2';
  if(sha(base)!==expected)throw new Error('Original 1.5.14 script changed: re-audit compatibility before rebuilding');
  const compile=async(file,options={})=>(await build({entryPoints:[path.join(here,file)],bundle:true,write:false,
    format:'iife',target:'chrome100',legalComments:'inline',...options})).outputFiles[0].text;
  const rustWorker=await compile('rust-worker.mjs');
  const ui=await compile('ui.mjs',{globalName:'ComparisonUI'});
  const wasm=fs.readFileSync(path.join(here,'assets/mwi_engine.wasm'));
  const assets={
    originalVersion:'1.5.14',originalSha256:expected,wasmSha256:sha(wasm),
    vendor:fs.readFileSync(path.join(here,'vendor/legacy/vendor.js.gz')).toString('base64'),
    worker:fs.readFileSync(path.join(here,'vendor/legacy/worker.js.gz')).toString('base64'),
    wasm:gzipSync(wasm,{mtime:0}).toString('base64'),
    rustWorker,legacyBridge:legacyWorkerBridgeSource(),
  };
  const header=`// ==UserScript==
// @name         迷宫双引擎对比测试
// @namespace    mwi-labyrinth-engine-comparison
// @version      0.1.1
// @description  对比原版 1.5.14 与 Rust/WASM 引擎：10 种怪物、可选等级/次数、胜率与耗时。
// @author       dakonglong (original calculator); wow121 (Rust engine); comparison adapter
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @grant        none
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js
// ==/UserScript==
`;
  const output=header+`\n(function(){'use strict';
if(window.__MWI_LAB_ENGINE_COMPARISON__)return;
window.__MWI_LAB_ENGINE_COMPARISON__=true;
const assets=${JSON.stringify(assets)};
const createOriginalApi=${legacyFactorySource(base)};
${ui}
ComparisonUI.boot(assets,createOriginalApi);
})();\n`;
  const target=path.join(here,'../labyrinth-engine-comparison.user.js');
  fs.writeFileSync(target,output);
  console.log(`Built ${target} (${Buffer.byteLength(output)} bytes)`);
  return target;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildComparison();
