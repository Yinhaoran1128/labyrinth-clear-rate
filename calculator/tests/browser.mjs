import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {chromium} from '../../comparison/node_modules/playwright-core/index.mjs';
import {buildCalculators} from '../build.mjs';
import {fixtureGame} from '../../comparison/tests/fixtures.mjs';
import {MONSTERS} from '../../comparison/core.mjs';
import {legacyFactorySource} from '../../comparison/legacy.mjs';

const files=await buildCalculators();
const root=new URL('../../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root));
const original=read('labyrinth-clear-rate.user.js').toString();
const levels=[80,60,70,100,100,100,120,120,120,120];
const game=fixtureGame();
const loadout={id:1,name:'Rust 回归枪配装',actionTypeHrid:'/action_types/combat',useExactEnhancement:true,
  wearableMap:{'/item_locations/main_hand':'fixture::slot::/items/furious_spear::7'},
  abilityMap:{1:'/abilities/critical_aura',2:'/abilities/berserk',3:'/abilities/precision',4:'/abilities/puncture',5:'/abilities/frenzy'},
  abilityCombatTriggersMap:{}};
const state={characterLabyrinth:{roomData:[MONSTERS.map((m,i)=>({roomType:'/labyrinth_room_types/combat',monsterHrid:m.hrid,recommendedLevel:levels[i]}))]},
  characterSetting:{},characterLoadoutDict:{1:loadout},characterInfo:{},characterSkillMap:{},characterAbilityMap:{},
  characterHouseRoomDict:{},characterAchievementMap:{},characterGuildBuffDict:{},characterItemMap:{},
  abilityCombatTriggersDict:{},abilitySlotsLevelRequirementList:[0,1,1,20,50,90]};
for(const skill of ['stamina','intelligence','attack','melee','defense','ranged','magic'])state.characterSkillMap[`/skills/${skill}`]={level:150};
for(const skill of ['milking','foraging','woodcutting','cheesesmithing','crafting','tailoring','cooking','brewing','alchemy','enhancing'])state.characterSkillMap[`/skills/${skill}`]={level:150};
for(const hrid of Object.values(loadout.abilityMap))state.characterAbilityMap[hrid]={level:50};
for(const m of MONSTERS)state.characterSetting[`labyrinthLoadout${m.key.split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join('')}`]=1;
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="zh-CN"><title>Rust 迷宫计算器测试</title><style>body{background:#182330;color:white;font:14px sans-serif}.grid{display:grid;grid-template-columns:repeat(5,180px);gap:10px;margin-top:30px}.LabyrinthPanel_roomCell_fixture{height:125px;background:#30475c;border-radius:6px;padding:10px}</style><div class="GamePage_fixture"><div class="grid">${MONSTERS.map(m=>`<div class="LabyrinthPanel_roomCell_fixture">${m.name}</div>`).join('')}</div></div></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const output=new URL('../../comparison/tests/browser-results/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
try {
  for(const mode of ['embedded']) {
    const page=await browser.newPage({viewport:{width:1200,height:800},locale:'zh-CN'});
    let requests=0;
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('request',request=>{if(request.url().includes('mwi_engine.wasm'))requests++;});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(({state,maps})=>{
      window.fixtureState=state;localStorage.setItem('initClientData',JSON.stringify(maps));
      document.querySelector('.GamePage_fixture').__reactFiber$fixture={return:{stateNode:{state}}};
    },{state,maps:game.$e});
    let source=fs.readFileSync(files[mode],'utf8');
    assert.ok(!source.includes('// @updateURL'),'variant must not update back to original GreasyFork script');
    const bootstrap=source.lastIndexOf('    migrateLegacySimulatorBridgeUrl();');
    source=source.slice(0,bootstrap)+`
    const realRun = rustCalculator.run;
    rustCalculator.run = (params,progress) => realRun({...params,seed:params.seed ?? 12345},progress);
    window.calculatorTest={computeCombatRoomClearChanceFullFlow,simulateCombatRoomWithWorker,
      buildMaxEnhancementByItem,buildCombatPlayerDtoForRoom,computeCombatRoomClearChance,resetCombatSimulatorWorker,
      findAutomationRecommendedLevelDelta,upsertAutomationRecommendCellContent,renderAutomationEstimateTooltip,
      getAutomationRoomTypeEntries,getAutomationRecommendFromCell,computeAutomationEntryClearChanceByRoomLevel,
      resolveAutomationEffectiveLevel,buildCombatPreview,renderCombatPreviewTooltip,upsertAutomationEstimateCellContent};
`+source.slice(bootstrap);
    await page.addScriptTag({content:source});
    await page.waitForSelector('#mwi-lab-clear-rate-control');
    assert.match(await page.locator('#mwi-lab-clear-rate-control').innerText(),/Rust 内置修正版/);
    const result=await page.evaluate(async()=>{
      const api=window.calculatorTest,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
      const rows=[];
      for(const room of state.characterLabyrinth.roomData[0]) {
        let units=0;
        const out=await api.computeCombatRoomClearChanceFullFlow(state,maps,room,
          api.buildMaxEnhancementByItem(state),{add(n){units+=n}},8);
        if(units!==8)throw new Error('progress budget mismatch');
        rows.push({room,out,input:api.buildCombatPlayerDtoForRoom(state,maps,room,api.buildMaxEnhancementByItem(state)).playerDto});
      }
      return rows;
    });
    assert.equal(result.length,10);
    assert.equal(requests,0,'engine downloads must be reused across rooms');
    for(const row of result) {
      assert.ok(row.out.clearChance>=0 && row.out.clearChance<=1);
      assert.ok(row.out.combatMeta.firstRunDebug.elapsedMs>=0);
      assert.equal(row.out.combatMeta.firstRunDebug.battleDurationLimitSeconds,120);
      assert.equal(row.out.combatMeta.firstRunDebug.timeoutMode,'strict');
      assert.ok(row.out.combatMeta.maxElapsedSeconds<=120);
      assert.equal(row.out.clearTimeInterval.confidenceLevel,.95);
      assert.equal(row.out.clearTimeInterval.method,row.out.combatMeta.successes===row.out.combatMeta.trials?'hoeffding-binomial':'fieller-t');
      assert.ok((row.out.combatMeta.successes===0 ? ['no_success'] : ['bounded','unbounded']).includes(row.out.clearTimeInterval.status));
      assert.deepEqual(row.out.combatMeta.clearTimeInterval,row.out.clearTimeInterval);
      assert.equal(row.out.combatMeta.firstRunDebug.engineMode,mode);
      assert.match(row.out.combatMeta.firstRunDebug.wasmSha256,/^[a-f0-9]{64}$/);
      const completedSeconds=row.out.combatMeta.firstRunDebug.fullCompletedSeconds;
      assert.ok(Math.abs(row.out.combatMeta.totalSpentSeconds-completedSeconds)<.001,`${mode}: include all completed time`);
      if(row.out.combatMeta.successes>0) {
        assert.ok(Math.abs(row.out.expectedSecondsPerClear-completedSeconds/row.out.combatMeta.successes)<.001);
      } else assert.equal(row.out.expectedSecondsPerClear,Infinity);
    }
    const ciDisplays=await page.evaluate(({room,out})=>{
      const api=window.calculatorTest,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
      const preview=api.buildCombatPreview(state,room,maps,out);
      const ordinary=api.renderCombatPreviewTooltip(preview).textContent;
      const cell=document.createElement('td');
      api.upsertAutomationEstimateCellContent(cell,{status:'ready',isCombat:true,roomLevel:80,
        clearChance:out.clearChance,expectedSeconds:out.expectedSecondsPerClear,etaText:'100 s',
        clearTimeInterval:out.clearTimeInterval});
      return {ordinary,inline:cell.querySelector('[data-clear-time-ci]')?.textContent};
    },result[0]);
    assert.match(ciDisplays.ordinary,/95%/);
    assert.match(ciDisplays.inline,/95%/);
    const progressive=await page.evaluate(async params=>{
      const api=window.calculatorTest,rows=[],progress=[];
      for(const trials of [300,1000,3000,1000]) {
        let completed=0;
        const out=await api.simulateCombatRoomWithWorker({...params,trials,progressive:true},
          {add(n){completed+=n;progress.push({trials,completed});}});
        rows.push(out);
      }
      const batches=[];
      for(const batch of rows[2].firstRunDebug.batches) {
        batches.push(await api.simulateCombatRoomWithWorker({...params,trials:batch.trials,seed:batch.seed}));
      }
      return {rows,progress,batches};
    },{playerDto:result[0].input,monsterHrid:MONSTERS[0].hrid,mazeDifficulty:80,mazeCrateItemHrids:[]});
    assert.deepEqual(progressive.rows.map(row=>row.trials),[300,1000,3000,3000]);
    const cumulative=progressive.rows[2];
    assert.deepEqual(cumulative.firstRunDebug.batches.map(row=>row.trials),[300,700,2000]);
    assert.equal(new Set(cumulative.firstRunDebug.batches.map(row=>row.seed)).size,3);
    assert.ok(progressive.progress.some(row=>row.trials===1000 && row.completed===300));
    assert.ok(progressive.progress.some(row=>row.trials===3000 && row.completed===1000));
    assert.equal(progressive.rows[3].sampleSource,'cache');
    assert.deepEqual(progressive.rows[3].firstRunDebug,cumulative.firstRunDebug);
    // Replay independent seeded batches through the actual Worker/WASM, and
    // compare their additive statistics with the cumulative runtime result.
    for(const key of ['trials','successes','failedByDeath','failedByTimeout','totalSpentSeconds',
      'durationSquaredSeconds','successSpentSeconds']) {
      const expected=progressive.batches.reduce((sum,row)=>sum+row[key],0);
      assert.ok(Math.abs(cumulative[key]-expected)<1e-6,`cumulative WASM ${key}`);
    }
    const centered=progressive.batches.reduce((sum,row)=>sum+row.durationM2SecondsSquared+
      row.trials*(row.durationMeanSeconds-cumulative.durationMeanSeconds)**2,0);
    const comoment=progressive.batches.reduce((sum,row)=>sum+row.durationSuccessComomentSeconds+
      row.trials*(row.durationMeanSeconds-cumulative.durationMeanSeconds)*(row.clearChance-cumulative.clearChance),0);
    assert.ok(Math.abs(cumulative.durationM2SecondsSquared-centered)<1e-6);
    assert.ok(Math.abs(cumulative.durationSuccessComomentSeconds-comoment)<1e-6);
    const progressiveFacade=await page.evaluate(async()=>{
      const api=window.calculatorTest,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
      const room={...state.characterLabyrinth.roomData[0][0],recommendedLevel:82};
      const rows=[];
      for(const n of [2,5,3]) rows.push(await api.computeCombatRoomClearChance(state,maps,room,
        api.buildMaxEnhancementByItem(state),null,n,'progressive-cache-test',{progressive:true}));
      return rows;
    });
    assert.deepEqual(progressiveFacade.map(row=>row.combatMeta.trials),[2,5,5]);
    assert.deepEqual(progressiveFacade[2].combatMeta.firstRunDebug.batches.map(row=>row.trials),[2,3]);
    if(mode==='embedded') {
      const stockSource=legacyFactorySource(original).replace('    getGameState,getInitClientData,',
        '    findAutomationRecommendedLevelDelta,computeAutomationEntryClearChanceByRoomLevel,getGameState,getInitClientData,');
      await page.addScriptTag({content:`${stockSource};window.stockApi=createOriginalApi();`});
      const vendor=gunzipSync(read('comparison/vendor/legacy/vendor.js.gz')).toString();
      const worker=gunzipSync(read('comparison/vendor/legacy/worker.js.gz')).toString();
      const baseline=await page.evaluate(async({vendor,worker})=>{
        const api=window.stockApi,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
        const prefix=`Math.random=(function(){var state=12345;return function(){state+=1831565813;var t=state>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};})();\n`;
        const rows=[];
        for(const room of state.characterLabyrinth.roomData[0]) {
          api.resetWorker();api.setWorkerSource(prefix+api.buildCombatSimulatorWorkerSource(vendor,worker));
          rows.push(await api.computeCombatRoomClearChanceFullFlow(state,maps,room,api.buildMaxEnhancementByItem(state),null,8));
        }
        api.resetWorker();return rows;
      },{vendor,worker});
      for(const row of result) {
        assert.equal(row.out.combatMeta.trials,8);
        assert.equal(row.out.combatMeta.completedTrials,8);
        assert.ok(row.out.combatMeta.durationSquaredSeconds>0);
        assert.ok(row.out.combatMeta.successSpentSeconds>=0);
      }
      // The stock engine above remains a rule/time-budget diagnostic, not an
      // exact-count oracle. Distribution comparisons are recorded separately.
      const recommendation=await page.evaluate(async()=>{
        const api=window.calculatorTest,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
        const match=await api.findAutomationRecommendedLevelDelta({state,initClientData:maps,
          entry:{key:'shadow_archer',monsterHrid:'/monsters/shadow_archer',isCombat:true},
          maxEnhancementByItem:api.buildMaxEnhancementByItem(state),effectiveLevel:150,targetChance:.7,
          recommendCombatTrials:30});
        const cell=document.createElement('td');
        api.upsertAutomationRecommendCellContent(cell,{status:'ready',...match});
        const tooltip=api.renderAutomationEstimateTooltip({status:'ready',roomLabel:'暗影弓手',isCombat:true,...match});
        return {match,settingText:cell.textContent,tooltipText:tooltip.textContent};
      });
      assert.equal(recommendation.match.recommendationMethod,'weighted-isotonic');
      assert.equal(recommendation.match.budget,3000);
      assert.equal(recommendation.match.result.combatMeta.completedTrials,3000);
      assert.equal(recommendation.match.result.combatMeta.firstRunDebug.requestedTrials,3000,'engine budget must not be clamped to the old limit');
      assert.ok(recommendation.match.fittedChance>=0 && recommendation.match.fittedChance<=1);
      assert.equal(recommendation.match.clearChance,recommendation.match.result.clearChance,'raw engine estimate must remain available');
      assert.equal(Number(recommendation.settingText),recommendation.match.levelDelta+1,'preserve automation skip-threshold semantics');
      assert.match(recommendation.tooltipText,/拟合胜率|Fitted Win Rate/);
      assert.match(recommendation.tooltipText,/模拟胜率|Simulated Win Rate/);
      const cacheSources=await page.evaluate(async()=>{
        const api=window.calculatorTest,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
        const params={state,initClientData:maps,
          entry:{key:'shadow_archer',monsterHrid:'/monsters/shadow_archer',isCombat:true},
          maxEnhancementByItem:api.buildMaxEnhancementByItem(state),recommendCombatTrials:1,targetChance:.7};
        const a=await api.computeAutomationEntryClearChanceByRoomLevel(params,78);
        const b=await api.computeAutomationEntryClearChanceByRoomLevel(params,78);
        return [a.result.combatMeta.source,b.result.combatMeta.source];
      });
      assert.equal(cacheSources[1],'cache','recommendation reuses cumulative samples for the same configuration');
      fs.writeFileSync(new URL('calculator-recommendation.json',output),JSON.stringify(recommendation,null,2));
    }
    const cancellation=await page.evaluate(async params=>{
      const api=window.calculatorTest;
      let live=0;
      try {
        await api.simulateCombatRoomWithWorker({...params,trials:3000},{add(n){
          live+=n;if(live>=30)api.resetCombatSimulatorWorker(new Error('测试取消'));
        }});
        return {cancelled:false,live};
      } catch(error) {return {cancelled:/测试取消/.test(error.message),live};}
    },{playerDto:result[0].input,monsterHrid:MONSTERS[0].hrid,mazeDifficulty:80,mazeCrateItemHrids:[]});
    assert.equal(cancellation.cancelled,true);
    assert.ok(cancellation.live>0 && cancellation.live<3000,'cancel while WASM is still running');
    const afterCancel=await page.evaluate(async params=>window.calculatorTest.simulateCombatRoomWithWorker({...params,trials:3}),
      {playerDto:result[0].input,monsterHrid:MONSTERS[0].hrid,mazeDifficulty:80,mazeCrateItemHrids:[]});
    assert.equal(afterCancel.completedTrials,3,'cancelled Worker can be reinitialized');
    const progressiveCancel=await page.evaluate(async params=>{
      const api=window.calculatorTest;
      await api.simulateCombatRoomWithWorker({...params,trials:6,progressive:true});
      let done=0,cancelled=false;
      try {
        await api.simulateCombatRoomWithWorker({...params,trials:3000,progressive:true},
          {add(n){done+=n;if(done>=30)api.resetCombatSimulatorWorker(new Error('累进测试取消'));}});
      } catch(error) {cancelled=/累进测试取消/.test(error.message);}
      const after=await api.simulateCombatRoomWithWorker({...params,trials:40,progressive:true});
      return {cancelled,after};
    },{playerDto:result[0].input,monsterHrid:MONSTERS[0].hrid,mazeDifficulty:81,mazeCrateItemHrids:[]});
    assert.equal(progressiveCancel.cancelled,true);
    assert.equal(progressiveCancel.after.trials,40);
    assert.deepEqual(progressiveCancel.after.firstRunDebug.batches.map(row=>row.trials),[6,34]);
    // Exercise the visible cancel control while an ordinary calculation is active.
    await page.fill('#mwi-lab-clear-rate-control input[type=number]','3000');
    await page.click('#mwi-lab-clear-rate-control button');
    const cancelButton=page.locator('#mwi-lab-clear-rate-control [data-cancel-battles]');
    await cancelButton.waitFor({state:'visible'});
    await cancelButton.click();
    await page.waitForFunction(()=>/已取消计算|Calculation cancelled/.test(
      document.querySelector('#mwi-lab-clear-rate-control').textContent));
    assert.equal(await page.locator('#mwi-lab-clear-rate-control button').first().isEnabled(),true);
    // Exercise the original real user flow, not only the calculation facade.
    await page.fill('#mwi-lab-clear-rate-control input[type=number]','1');
    await page.click('#mwi-lab-clear-rate-control button');
    try {
      await page.waitForFunction(()=>/计算完成|Calculation complete/.test(document.querySelector('#mwi-lab-clear-rate-control').textContent),null,{timeout:15000});
    } catch(error) {
      console.log({mode,status:await page.locator('#mwi-lab-clear-rate-control').innerText(),errors});
      await page.screenshot({path:new URL(`calculator-${mode}-failure.png`,output).pathname,fullPage:true});
      throw error;
    }
    assert.equal(await page.locator('.mwi-lab-clear-rate-badge').count(),10,'all rooms must receive the original overlay');
    // Cancel during the inter-row animation frame when every combat result is cached.
    await page.evaluate(()=>{
      requestAnimationFrame(()=>document.querySelector('#mwi-lab-clear-rate-control [data-cancel-battles]').click());
      document.querySelector('#mwi-lab-clear-rate-control .mwi-lab-clear-rate-control__button').click();
    });
    await page.waitForFunction(()=>/已取消计算|Calculation cancelled/.test(
      document.querySelector('#mwi-lab-clear-rate-control').textContent));
    assert.equal(await page.locator('#mwi-lab-clear-rate-control button').first().isEnabled(),true);
    if(mode==='embedded') {
      const productionBaseline=await page.evaluate(async()=>{
        const api=window.calculatorTest,state=window.fixtureState,maps=JSON.parse(localStorage.getItem('initClientData'));
        const results=[];
        for(const entry of api.getAutomationRoomTypeEntries(null).filter(entry=>!entry.isCombat)) {
          const params={state,initClientData:maps,entry,maxEnhancementByItem:api.buildMaxEnhancementByItem(state),
            effectiveLevel:api.resolveAutomationEffectiveLevel(null,entry,state,maps,{includePersonalBuffs:false}),
            targetChance:.7,combatTrials:30,recommendCombatTrials:30};
          const match=await window.stockApi.findAutomationRecommendedLevelDelta(params);
          const exact=[];
          for(const level of [1,100,150,450]) {
            const result=await window.stockApi.computeAutomationEntryClearChanceByRoomLevel(params,level);
            exact.push({level,chance:result.clearChance});
          }
          results.push({key:entry.key,roomLevel:match.roomLevel,chance:match.clearChance,exact});
        }
        return results;
      });
      // Supply the native game's table surface; exercise the actual recommend button,
      // result-map propagation and hover rendering, with the real Worker/WASM.
      await page.evaluate(()=>{
        const entries=window.calculatorTest.getAutomationRoomTypeEntries(null);
        const section=document.createElement('section');
        section.innerHTML='<table class="LabyrinthPanel_automationTable_fixture"><thead><tr><th>Room Type</th><th>Skip if above level</th></tr></thead><tbody>'+entries.map(entry=>
          '<tr><td>'+entry.key+'</td><td><input type="number" value="100"></td></tr>').join('')+'</tbody></table>';
        document.querySelector('.GamePage_fixture').appendChild(section);
      });
      const button=page.locator('.mwi-lab-auto-estimate-control__recommend-button');
      await button.waitFor();
      const timeButton=page.locator('.mwi-lab-auto-estimate-control__recommend-seconds-button');
      assert.equal(await timeButton.count(),1,'time recommendation must have its own button');
      const timeInput=page.locator('.mwi-lab-auto-estimate-control__target-seconds-input');
      assert.equal(await timeInput.inputValue(),'300');
      const winBox=await button.boundingBox(), timeBox=await timeButton.boundingBox();
      assert.ok(timeBox.y>winBox.y,'time and win targets must occupy separate Greasyfork-style rows');
      await button.click();
      const autoCancel=page.locator('#mwi-lab-auto-estimate-control [data-cancel-battles]');
      await autoCancel.waitFor({state:'visible'});
      await autoCancel.click();
      await page.waitForFunction(()=>/已取消计算|Calculation cancelled/.test(
        document.querySelector('.mwi-lab-auto-estimate-control__status').textContent));
      await page.waitForFunction(()=>!document.querySelector('.mwi-lab-auto-estimate-control__recommend-button').disabled);
      await page.fill('.mwi-lab-auto-estimate-control__target-rate-input','70');
      await button.click();
      await page.waitForFunction(()=>{
        const button=document.querySelector('.mwi-lab-auto-estimate-control__recommend-button');
        const cells=[...document.querySelectorAll('.mwi-lab-auto-recommend-cell')];
        return button && !button.disabled && cells.length>0 && cells.every(cell=>Number.isFinite(Number(cell.textContent)));
      },null,{timeout:60000});
      const rows=await page.evaluate(()=>[...document.querySelectorAll('.mwi-lab-auto-recommend-cell')].map(cell=>{
        const recommendation=window.calculatorTest.getAutomationRecommendFromCell(cell);
        return {isCombat:recommendation.isCombat,method:recommendation.recommendationMethod,
          fittedChance:recommendation.fittedChance,levelDelta:recommendation.levelDelta,setting:Number(cell.textContent)};
      }));
      assert.equal(rows.filter(row=>row.isCombat).length,10);
      assert.ok(rows.filter(row=>row.isCombat).every(row=>row.method==='weighted-isotonic' && Number.isFinite(row.fittedChance)));
      assert.ok(rows.filter(row=>!row.isCombat).every(row=>row.method===undefined),'skilling must retain its original recommendation');
      assert.ok(rows.every(row=>row.setting===row.levelDelta+1));
      await page.locator('.mwi-lab-auto-recommend-cell[data-mwi-auto-room-key="shadow_archer"]').hover();
      await page.waitForFunction(()=>/Fitted Win Rate|拟合胜率/.test(document.querySelector('#mwi-lab-clear-rate-preview')?.textContent));
      const chartCell=page.locator('.mwi-lab-auto-recommend-cell[data-mwi-auto-room-key="shadow_archer"]');
      await chartCell.click();
      const chart=page.locator('#mwi-lab-recommend-chart');
      assert.equal(await chart.count(),1,'clicking the recommended level must open the chart');
      await chart.waitFor({state:'visible'});
      const trace=await page.evaluate(()=>window.calculatorTest.getAutomationRecommendFromCell(
        document.querySelector('.mwi-lab-auto-recommend-cell[data-mwi-auto-room-key="shadow_archer"]')).recommendationChart);
      assert.equal(trace.observations.length,trace.levelCount,'one cumulative point per level');
      assert.equal(new Set(trace.observations.map(row=>row.roomLevel)).size,trace.levelCount);
      assert.ok(trace.observations.every(row=>row.budget===row.trials && row.isLatest));
      const initialRange=await chart.locator('svg').getAttribute('data-level-range');
      const [initialLow,initialHigh]=initialRange.split(',').map(Number);
      assert.ok(initialLow<=trace.recommendedLevel && initialHigh>=trace.recommendedLevel,'default range includes recommendation');
      await chart.locator('[data-action="focus"]').click();
      assert.equal(await chart.locator('svg').getAttribute('data-level-range'),initialRange,'chart opens near target by default');
      await chart.locator('[data-action="reset"]').click();
      assert.notEqual(await chart.locator('svg').getAttribute('data-level-range'),initialRange,'all levels expands the default target view');
      assert.equal(await chart.locator('[data-observation-id]').count(),trace.observations.length);
      assert.equal(await chart.locator('[data-error-bar]').count(),trace.observations.length);
      assert.equal(await chart.locator('[data-fit-curve]').count(),1);
      assert.match(await chart.innerText(),/95%/);
      await chart.locator('[data-action="focus"]').click();
      const focusedRange=await chart.locator('svg').getAttribute('data-level-range');
      await chart.locator('[data-action="reset"]').click();
      assert.notEqual(await chart.locator('svg').getAttribute('data-level-range'),focusedRange,'reset restores all levels');
      const svg=chart.locator('svg');
      const svgBox=await svg.boundingBox();
      await page.mouse.move(svgBox.x+svgBox.width/2,svgBox.y+svgBox.height/2);
      const beforeWheel=await svg.getAttribute('data-level-range');
      await page.mouse.wheel(0,-180);
      await page.waitForFunction(before=>document.querySelector('#mwi-lab-recommend-chart svg').getAttribute('data-level-range')!==before,beforeWheel);
      const beforeDrag=await svg.getAttribute('data-level-range');
      await page.mouse.move(svgBox.x+svgBox.width/2,svgBox.y+svgBox.height*.8);
      await page.mouse.down();
      await page.mouse.move(svgBox.x+svgBox.width*.6,svgBox.y+svgBox.height*.8,{steps:4});
      await page.mouse.up();
      assert.notEqual(await svg.getAttribute('data-level-range'),beforeDrag,'drag pans the view');
      await chart.locator('[data-action="reset"]').click();
      const firstLegend=chart.locator('.mwi-chart-legend button').first();
      await firstLegend.click();
      assert.ok(await chart.locator('[data-observation-id]').count()<trace.observations.length);
      await firstLegend.click();
      assert.equal(await chart.locator('[data-observation-id]').count(),trace.observations.length);
      await chart.locator('[data-observation-id]').last().focus();
      await page.keyboard.press('Enter');
      assert.match(await chart.locator('[data-point-detail]').innerText(),/95%/);
      await page.setViewportSize({width:1000,height:800});
      await page.waitForFunction(()=>Number(document.querySelector('#mwi-lab-recommend-chart svg').getAttribute('viewBox').split(' ')[2])<950);
      const focusInside=await page.evaluate(()=>!!document.activeElement.closest('#mwi-lab-recommend-chart'));
      assert.equal(focusInside,true,'resizing must not discard scatter keyboard focus into the game');
      await page.setViewportSize({width:1200,height:800});
      await chart.locator('summary').click();
      assert.equal(await chart.locator('tbody tr').count(),trace.observations.length);
      await page.screenshot({path:new URL('calculator-chart.png',output).pathname,fullPage:true});
      await page.keyboard.press('Escape');
      assert.equal(await chart.count(),0);
      await chartCell.focus();
      await page.keyboard.press('Enter');
      assert.equal(await chart.count(),1,'keyboard can reopen chart');
      await chart.locator('[data-action="close"]').click();
      assert.equal(await chart.count(),0);
      // Chinese labels and a narrow viewport must remain usable without modal overflow.
      await page.evaluate(()=>localStorage.setItem('i18nextLng','zh'));
      await page.setViewportSize({width:390,height:844});
      await chartCell.focus();
      await page.keyboard.press('Enter');
      await chart.waitFor({state:'visible'});
      assert.match(await chart.locator('h2').innerText(),/胜率—等级/);
      const bounds=await chart.locator('.mwi-chart-panel').boundingBox();
      assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390,'mobile modal stays inside viewport');
      await chart.locator('[data-action="focus"]').click();
      await page.screenshot({path:new URL('calculator-chart-mobile.png',output).pathname,fullPage:false});
      await chart.locator('[data-action="close"]').click();
      await page.setViewportSize({width:1200,height:800});
      // The complete production curves must use the pinned formula, keep original
      // recommendations, and expose no simulation confidence interval or fit.
      for(const baseline of productionBaseline) {
        const data=await page.evaluate(key=>window.calculatorTest.getAutomationRecommendFromCell(
          document.querySelector(`.mwi-lab-auto-recommend-cell[data-mwi-auto-room-key="${key}"]`)),baseline.key);
        assert.equal(data.roomLevel,baseline.roomLevel,`production recommendation ${baseline.key}`);
        assert.equal(data.clearChance,baseline.chance);
        const trace=data.recommendationChart;
        assert.equal(trace.kind,'production');
        assert.equal(trace.levelCount,450);
        assert.deepEqual(trace.observations.map(row=>row.roomLevel),Array.from({length:450},(_,i)=>i+1));
        for(const {level,chance} of baseline.exact)assert.equal(trace.observations[level-1].clearChance,chance,`formula ${baseline.key}:${level}`);
        const cell=page.locator(`.mwi-lab-auto-recommend-cell[data-mwi-auto-room-key="${baseline.key}"]`);
        await cell.click();
        await chart.waitFor({state:'visible'});
        assert.equal(await chart.locator('[data-calculated-curve]').count(),1);
        assert.equal(await chart.locator('[data-fit-curve],[data-error-bar],.mwi-chart-legend button').count(),0);
        assert.doesNotMatch(await chart.innerText(),/Wilson|置信区间|模拟预算|单调拟合|NaN|undefined/);
        const initialRange=await chart.locator('svg').getAttribute('data-level-range');
        await chart.locator('[data-action="reset"]').click();
        assert.notEqual(await chart.locator('svg').getAttribute('data-level-range'),initialRange);
        assert.equal(await chart.locator('[data-observation-id]').count(),450);
        await chart.locator('summary').click();
        assert.equal(await chart.locator('tbody tr').count(),450);
        await chart.locator('tbody tr').nth(99).click();
        assert.match(await chart.locator('[data-point-detail]').innerText(),/Lv\.100/);
        assert.match(await chart.locator('[data-point-detail]').innerText(),/操作成功率|Action success/);
        if(baseline.key==='enhancing')assert.match(await chart.locator('[data-point-detail]').innerText(),/\+5/);
        await chart.locator('[data-action="focus"]').click();
        assert.ok((await chart.locator('[data-point-detail]').innerText()).startsWith(`Lv.${data.roomLevel} ·`),'near-target action restores recommended level details');
        if(baseline.key==='milking') {
          await chart.locator('summary').click();
          await chart.locator('[data-action="focus"]').click();
          await chart.locator('.mwi-chart-panel').evaluate(panel=>{panel.scrollTop=0;});
          await page.screenshot({path:new URL('calculator-production-chart.png',output).pathname,fullPage:true});
          await page.setViewportSize({width:390,height:844});
          const bounds=await chart.locator('.mwi-chart-panel').boundingBox();
          assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390);
          await page.screenshot({path:new URL('calculator-production-chart-mobile.png',output).pathname,fullPage:false});
          await page.setViewportSize({width:1200,height:800});
        }
        await page.keyboard.press('Escape');
        assert.equal(await chart.count(),0);
        assert.equal(await cell.evaluate(node=>document.activeElement===node),true);
      }
      await timeInput.fill('305');
      await timeButton.click();
      await page.waitForFunction(()=>{
        const button=document.querySelector('.mwi-lab-auto-estimate-control__recommend-seconds-button');
        const cells=[...document.querySelectorAll('.mwi-lab-auto-recommend-cell')];
        return button && !button.disabled && cells.length===20 && cells.every(cell=>
          window.calculatorTest.getAutomationRecommendFromCell(cell)?.basis==='seconds');
      },null,{timeout:60000});
      assert.equal(await page.evaluate(()=>localStorage.getItem('mwi_lab_auto_target_seconds')),'305');
      await chartCell.click();
      await chart.waitFor({state:'visible'});
      assert.match(await chart.locator('h2').innerText(),/耗时|Time/);
      assert.equal(await chart.locator('[data-error-bar]').count(),0,'binomial win intervals must not be presented as time intervals');
      assert.match(await chart.innerText(),/305/);
      assert.doesNotMatch(await chart.innerText(),/NaN|undefined|Wilson/);
      assert.match(await chart.innerText(),/95%/);
      assert.ok(await chart.locator('[data-time-error-bar]').count()>0,'time chart must show paired clear-time intervals');
      const timedTrace=await page.evaluate(()=>window.calculatorTest.getAutomationRecommendFromCell(
        document.querySelector('.mwi-lab-auto-recommend-cell[data-mwi-auto-room-key="shadow_archer"]')).recommendationChart);
      assert.equal(timedTrace.basis,'seconds');
      assert.ok(timedTrace.observations.every(row=>row.clearTimeInterval?.confidenceLevel===.95));
      assert.ok(timedTrace.curve.every((row,i,all)=>i===0 || row.fittedSeconds>=all[i-1].fittedSeconds));
      assert.ok(await chart.locator('[data-fit-curve]').getAttribute('d'));
      await page.screenshot({path:new URL('calculator-time-chart.png',output).pathname,fullPage:true});
      await page.keyboard.press('Escape');
      await page.setViewportSize({width:390,height:844});
      const control=page.locator('#mwi-lab-auto-estimate-control');
      await control.scrollIntoViewIfNeeded();
      const timeControlBox=await timeInput.boundingBox();
      assert.ok(timeControlBox.x>=0 && timeControlBox.x+timeControlBox.width<=390);
      await page.screenshot({path:new URL('calculator-time-controls-mobile.png',output).pathname,fullPage:false});
      await chartCell.click();
      await chart.waitFor({state:'visible'});
      assert.doesNotMatch(await chart.innerText(),/NaN|undefined/);
      await page.screenshot({path:new URL('calculator-time-chart-mobile.png',output).pathname,fullPage:false});
      await page.keyboard.press('Escape');
      await page.setViewportSize({width:1200,height:800});
    }
    await page.screenshot({path:new URL(`calculator-${mode}.png`,output).pathname,fullPage:true});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(new URL(`calculator-${mode}.json`,output),JSON.stringify(result,null,2));
    console.log(JSON.stringify({mode,monsters:10,downloadRequests:requests,checks:['real Worker/WASM','original calculator UI','cumulative progress','engine provenance','exact battle counts','monotone recommendation','300/700/2000 batches and seed replay','cumulative cache','single point per level','recommend button and hover','cancellation and retained samples']}));
    await page.close();
  }
} finally {await browser.close();server.close();}
