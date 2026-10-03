import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { MONSTERS } from '../core.mjs';
import { fixtureGame } from './fixtures.mjs';
import { buildComparison } from '../build.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(here,'browser-results');fs.mkdirSync(output,{recursive:true});
const levels=[1,5,10,20,35,50,80,100,150,200];
const script=await buildComparison();
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>迷宫对比回归测试</title><div class="GamePage_fixture"></div>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const game=fixtureGame();
  const loadout={id:1,name:'回归测试弓配装',actionTypeHrid:'/action_types/combat',useExactEnhancement:true,
    wearableMap:{'/item_locations/two_hand':'fixture::slot::/items/wooden_bow::5'},
    abilityMap:{1:'/abilities/steady_shot',2:'/abilities/precision',3:'/abilities/rain_of_arrows'},
    abilityCombatTriggersMap:{}};
  const state={characterLabyrinth:{roomData:[]},characterSetting:{},characterLoadoutDict:{1:loadout},
    characterInfo:{labyrinthCombatDamageLevel:6,labyrinthAttackSpeedLevel:4,labyrinthCastSpeedLevel:3,labyrinthCriticalRateLevel:2},
    characterSkillMap:{},characterAbilityMap:{},characterHouseRoomDict:{},characterAchievementMap:{},
    characterGuildBuffDict:{},characterItemMap:{},abilityCombatTriggersDict:{},abilitySlotsLevelRequirementList:[0,1,1,20,50,90]};
  for(const s of ['stamina','intelligence','attack','melee','defense','ranged','magic'])state.characterSkillMap[`/skills/${s}`]={level:100};
  for(const hrid of Object.values(loadout.abilityMap))state.characterAbilityMap[hrid]={level:10};
  for(const m of MONSTERS)state.characterSetting[`labyrinthLoadout${m.key.split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join('')}`]=1;
  await page.evaluate(({state,maps})=>{
    window.fixtureState=state;localStorage.setItem('initClientData',JSON.stringify(maps));
    document.querySelector('.GamePage_fixture').__reactFiber$fixture={return:{stateNode:{state}}};
  },{state,maps:game.$e});
  await page.addScriptTag({path:script});
  await page.click('#mwi-compare-toggle');
  assert.equal(await page.locator('#mwi-compare-panel tbody tr').count(),10);
  await page.fill('#mwi-compare-level','50');await page.click('[data-action=apply]');
  assert.equal(await page.locator('[data-level="9"]').inputValue(),'50');
  await page.fill('#mwi-compare-trials','0');await page.click('[data-action=run]');
  assert.match(await page.locator('#mwi-compare-status').innerText(),/1～2000/);
  await page.fill('#mwi-compare-trials','3');await page.check('#mwi-compare-fixed');
  for(const [i,level] of levels.entries()){
    await page.fill(`[data-level="${i}"]`,String(level));await page.locator(`[data-level="${i}"]`).blur();
  }
  await page.fill('#mwi-compare-seed','12345');await page.click('[data-action=run]');
  await page.waitForFunction(()=>document.querySelector('#mwi-compare-status').textContent.startsWith('测试完成。'),{timeout:60000});
  assert.equal(await page.locator('tr[data-state=done]').count(),10);
  const downloadPromise=page.waitForEvent('download');await page.click('[data-action=export]');
  const download=await downloadPromise;const reportPath=path.join(output,'comparison.json');await download.saveAs(reportPath);
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  assert.equal(report.rows.length,10);
  assert.ok(report.rows.some(r=>r.legacy.successes>0),'regression fixture must exercise winning ETA');
  assert.ok(report.rows.some(r=>r.legacy.failures>0),'regression fixture must exercise losses');
  assert.ok(report.elapsedMs>report.totals.legacyMs+report.totals.rustMs);
  assert.equal(report.totals.legacyCount,10);assert.equal(report.totals.rustCount,10);
  assert.ok(report.initialization.legacyMs>0 && report.initialization.rustMs>0);

  // Independent baseline: retain the original script's body and worker generation, only
  // replace its UI bootstrap with a test facade. Never reuse the comparison facade here.
  const base=fs.readFileSync(path.join(here,'../../labyrinth-clear-rate.user.js'),'utf8');
  const cut=base.lastIndexOf('    migrateLegacySimulatorBridgeUrl();');
  await page.addScriptTag({content:base.slice(0,cut)+`window.stockApi={
    buildCombatSimulatorWorkerSource,computeCombatRoomClearChanceFullFlow,buildMaxEnhancementByItem,
    resolveLabyrinthUpgradeLevels,reset(){resetCombatSimulatorWorker(new Error('test'));},
    source(text){combatWorkerScriptPromise=Promise.resolve(text);}
  };})();`});
  const vendor=gunzipSync(fs.readFileSync(path.join(here,'../vendor/legacy/vendor.js.gz'))).toString();
  const worker=gunzipSync(fs.readFileSync(path.join(here,'../vendor/legacy/worker.js.gz'))).toString();
  const stockResults=await page.evaluate(async({vendor,worker,monsters,levels})=>{
    const api=window.stockApi;
    const prefix=`Math.random=(function(){var state=12345;return function(){state+=1831565813;var t=state>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};})();\n`;
    const results=[];
    for(const [i,m] of monsters.entries()){
      api.reset();api.source(prefix+api.buildCombatSimulatorWorkerSource(vendor,worker));
      const r=await api.computeCombatRoomClearChanceFullFlow(window.fixtureState,JSON.parse(localStorage.getItem('initClientData')),
        {roomType:'/labyrinth_room_types/combat',monsterHrid:m.hrid,recommendedLevel:levels[i]},
        api.buildMaxEnhancementByItem(window.fixtureState),null,3,m.key,{labyrinthUpgradeLevels:api.resolveLabyrinthUpgradeLevels()});
      results.push({key:m.key,clearChance:r.clearChance,expectedSecondsPerClear:Number.isFinite(r.expectedSecondsPerClear)?r.expectedSecondsPerClear:'Infinity',
        trials:r.combatMeta.trials,successes:r.combatMeta.successes,failedByDeath:r.combatMeta.failedByDeath,
        failedByTimeout:r.combatMeta.failedByTimeout,totalSpentSeconds:r.combatMeta.totalSpentSeconds});
    }
    api.reset();return results;
  },{vendor,worker,monsters:MONSTERS,levels});
  for(const reference of stockResults){
    const actual=report.rows.find(r=>r.key===reference.key).legacy;
    for(const key of Object.keys(reference).filter(k=>k!=='key'))assert.deepEqual(actual[key],reference[key],`${reference.key}: original ${key} changed`);
  }
  await page.screenshot({path:path.join(output,'comparison.png'),fullPage:true});
  // Editing the next run must not rewrite results from the completed run.
  await page.fill('[data-level="0"]','77');await page.locator('[data-level="0"]').blur();
  await page.uncheck('[data-select="0"]');
  const secondDownloadPromise=page.waitForEvent('download');await page.click('[data-action=export]');
  const secondDownload=await secondDownloadPromise;const secondPath=path.join(output,'comparison-after-edit.json');
  await secondDownload.saveAs(secondPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(secondPath,'utf8')),report,'editing the next run changed the old export');
  await page.check('[data-select="0"]');await page.fill('[data-level="0"]',String(levels[0]));await page.locator('[data-level="0"]').blur();
  await page.evaluate(()=>{document.querySelector('[data-action=run]').click();document.querySelector('[data-action=stop]').click();});
  assert.match(await page.locator('#mwi-compare-status').innerText(),/已停止/);
  // A long run must be interruptible and restartable; real Worker termination is exercised.
  await page.fill('#mwi-compare-trials','2000');await page.click('[data-action=run]');
  await page.waitForFunction(()=>document.querySelector('#mwi-compare-status').textContent.includes('计算中'),null,{timeout:30000});
  await page.click('[data-action=stop]');
  assert.match(await page.locator('#mwi-compare-status').innerText(),/已停止/);
  assert.equal(await page.locator('[data-action=run]').isEnabled(),true);
  await page.fill('#mwi-compare-trials','1');await page.click('[data-action=run]');
  await page.waitForFunction(()=>document.querySelector('#mwi-compare-status').textContent.startsWith('测试完成。'),{timeout:60000});
  assert.equal(await page.locator('tr[data-state=done]').count(),10);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:'Chrome',monsters:10,originalParity:'10/10 exact',
    checks:['input validation','real JS and WASM workers','timing totals','JSON export','stop and restart'],
    initialization:report.initialization,totals:report.totals,batchMs:report.elapsedMs},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
