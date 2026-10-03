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
const upstream=read('comparison/tests/upstream-engine.wasm');
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
  for(const mode of ['embedded','remote']) {
    const page=await browser.newPage({viewport:{width:1200,height:800},locale:'zh-CN'});
    let requests=0,failDownload=false;
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://wow121.github.io/mwi-fastsim/engine/mwi_engine.wasm',async route=>{
      requests++;
      await route.fulfill({status:failDownload?503:200,body:failDownload?'unavailable':upstream,
        headers:{'Content-Type':'application/wasm','Access-Control-Allow-Origin':'*'}});
    });
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
    rustCalculator.run = (params,progress) => realRun({...params,seed:12345},progress);
    window.calculatorTest={computeCombatRoomClearChanceFullFlow,simulateCombatRoomWithWorker,
      buildMaxEnhancementByItem,buildCombatPlayerDtoForRoom,computeCombatRoomClearChance,resetCombatSimulatorWorker,
      findAutomationRecommendedLevelDelta,upsertAutomationRecommendCellContent,renderAutomationEstimateTooltip,
      getAutomationRoomTypeEntries,getAutomationRecommendFromCell,computeAutomationEntryClearChanceByRoomLevel,
      resolveAutomationEffectiveLevel};
`+source.slice(bootstrap);
    await page.addScriptTag({content:source});
    await page.waitForSelector('#mwi-lab-clear-rate-control');
    assert.match(await page.locator('#mwi-lab-clear-rate-control').innerText(),mode==='embedded'?/Rust 内置修正版/:/Rust 远程上游版/);
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
    assert.equal(requests,mode==='remote'?1:0,'engine downloads must be reused across rooms');
    for(const row of result) {
      assert.ok(row.out.clearChance>=0 && row.out.clearChance<=1);
      assert.ok(row.out.combatMeta.firstRunDebug.elapsedMs>=0);
      assert.equal(row.out.combatMeta.firstRunDebug.engineMode,mode);
      assert.match(row.out.combatMeta.firstRunDebug.wasmSha256,/^[a-f0-9]{64}$/);
    }
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
      for(const [i,row] of result.entries()) {
        assert.equal(row.out.clearChance,baseline[i].clearChance,`embedded win rate ${i}`);
        for(const k of ['trials','successes','failedByDeath','failedByTimeout'])assert.equal(row.out.combatMeta[k],baseline[i].combatMeta[k],`${i}:${k}`);
        if(Number.isFinite(baseline[i].expectedSecondsPerClear))assert.ok(Math.abs(row.out.expectedSecondsPerClear-baseline[i].expectedSecondsPerClear)<.001);
      }
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
      assert.equal(recommendation.match.budget,1000);
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
      assert.deepEqual(cacheSources,['full','full'],'recommendation verification must bypass old random-result caches');
      fs.writeFileSync(new URL('calculator-recommendation.json',output),JSON.stringify(recommendation,null,2));
    } else {
      assert.ok(result.some(r=>r.out.combatMeta.firstRunDebug.reconstructionProbes>0),'upstream statistics must be reconstructed');
      await page.evaluate(()=>window.calculatorTest.resetCombatSimulatorWorker());
      failDownload=true;
      const failure=await page.evaluate(async()=>{
        try {await window.calculatorTest.simulateCombatRoomWithWorker({trials:1});return null;}
        catch(e){return e.message;}
      });
      assert.match(failure,/503/);
      failDownload=false;
      const retry=await page.evaluate(async params=>window.calculatorTest.simulateCombatRoomWithWorker({...params,trials:1}),
        {playerDto:result[0].input,monsterHrid:MONSTERS[0].hrid,mazeDifficulty:80,mazeCrateItemHrids:[]});
      assert.ok(retry.trials>0);assert.equal(requests,3,'failed downloads must retry without silently changing engines');
    }
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
      assert.ok(trace.observations.length>trace.levelCount,'must retain replaced simulation rounds');
      assert.deepEqual([...new Set(trace.observations.map(row=>row.budget))].sort((a,b)=>a-b),[30,100,300,1000]);
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
    }
    await page.screenshot({path:new URL(`calculator-${mode}.png`,output).pathname,fullPage:true});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(new URL(`calculator-${mode}.json`,output),JSON.stringify(result,null,2));
    console.log(JSON.stringify({mode,monsters:10,downloadRequests:requests,checks:['real Worker/WASM','original calculator UI','progress','engine provenance',...(mode==='embedded'?['original parity','monotone recommendation','fresh verification','recommend button and hover']:['upstream statistics','download failure/retry'])]}));
    await page.close();
  }
} finally {await browser.close();server.close();}
