import { MONSTERS, validateSettings, summarizeResult, totalTimings, snapshotState } from './core.mjs';
import { unpack, initializeOriginal, RustClient } from './clients.mjs';

const STORAGE='mwi_engine_comparison_settings_v1';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seconds=n=>Number.isFinite(n)?`${n.toFixed(2)} 秒`:'∞';
const milliseconds=n=>Number.isFinite(n)?`${n.toFixed(1)} ms`:'—';
const chance=n=>Number.isFinite(n)?`${(n*100).toFixed(2)}%`:'—';

export function boot(assets,createOriginalApi) {
  const api=createOriginalApi();
  let running=false,token=0,rust=null,original=null,report=null,abort=null,activeAttempt=null;
  let defaults={level:100,trials:100,seed:12345,fixedSeed:false};
  try {defaults={...defaults,...JSON.parse(localStorage.getItem(STORAGE)||'{}')};}catch{}
  const rows=MONSTERS.map(m=>({...m,level:defaults.level,selected:true,legacy:null,rust:null,status:'等待测试'}));
  const style=document.createElement('style');
  style.textContent=`
#mwi-compare-toggle{position:fixed;right:16px;bottom:76px;z-index:2147483645;background:#19465e;color:white;border:1px solid #82bad1;border-radius:9px;padding:10px 15px;cursor:pointer;font:14px system-ui}
#mwi-compare-panel{position:fixed;inset:4vh 3vw;z-index:2147483646;color:#e8eff6;background:#131e2c;border:1px solid #4b6680;border-radius:14px;box-shadow:0 12px 70px #0009;font:14px/1.5 system-ui;display:flex;flex-direction:column;overflow:hidden}
#mwi-compare-panel[hidden]{display:none}#mwi-compare-panel *{box-sizing:border-box}
#mwi-compare-panel header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #314456}
#mwi-compare-panel h2{margin:0;font-size:21px}#mwi-compare-panel .body{padding:16px 20px;overflow:auto}
#mwi-compare-panel .controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
#mwi-compare-panel button,#mwi-compare-panel input,#mwi-compare-panel select{font:inherit;color:inherit;background:#22364a;border:1px solid #4a6480;border-radius:6px;padding:6px 9px}
#mwi-compare-panel input[type=number]{width:85px}#mwi-compare-panel input[type=checkbox]{width:16px;height:16px;vertical-align:middle}
#mwi-compare-panel button{cursor:pointer}#mwi-compare-panel button.primary{background:#16757b}#mwi-compare-panel button:disabled{opacity:.45;cursor:default}
#mwi-compare-panel .note{color:#a9bdcf;font-size:12px;margin:8px 0}#mwi-compare-panel .summary{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}
#mwi-compare-panel .summary div{background:#1c2c3e;padding:9px 13px;border-radius:8px;min-width:170px}#mwi-compare-panel .summary strong{display:block;font-size:19px;color:#83dcdd}
#mwi-compare-panel .table-wrap{overflow:auto}#mwi-compare-panel table{border-collapse:collapse;width:100%;white-space:nowrap;font-size:13px}
#mwi-compare-panel th,#mwi-compare-panel td{padding:9px 8px;text-align:right;border-bottom:1px solid #304355}#mwi-compare-panel th:first-child,#mwi-compare-panel td:first-child,#mwi-compare-panel td:nth-child(2){text-align:left}
#mwi-compare-panel th{background:#1e3042;position:sticky;top:0}#mwi-compare-panel tr[data-state=done]{background:#13313733}#mwi-compare-panel .error{color:#ff9e94}#mwi-compare-panel .status{white-space:normal;max-width:180px;text-align:left}
#mwi-compare-panel details{margin-top:14px}#mwi-compare-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;color:#b2c7d9}
@media(max-width:700px){#mwi-compare-panel{inset:1vh 1vw}#mwi-compare-panel .body{padding:10px}#mwi-compare-panel h2{font-size:17px}}
`;
  document.head.append(style);
  const toggle=document.createElement('button');toggle.id='mwi-compare-toggle';toggle.textContent='双引擎对比';
  const panel=document.createElement('section');panel.id='mwi-compare-panel';panel.hidden=true;
  panel.setAttribute('aria-label','迷宫双引擎对比测试');
  panel.innerHTML=`<header><div><h2>迷宫双引擎对比测试</h2><small>原脚本 1.5.14 · Rust / WASM</small></div><button data-action="close" aria-label="关闭">×</button></header>
<div class="body"><div class="controls">
<label>统一等级 <input id="mwi-compare-level" type="number" min="1" max="10000" step="1" value="${escape(defaults.level)}"></label>
<button data-action="apply">应用到全部怪物</button>
<label>模拟次数 <input id="mwi-compare-trials" type="number" min="1" max="2000" step="1" value="${escape(defaults.trials)}"></label>
<label>配装 <select id="mwi-compare-loadout"><option value="">各怪物的迷宫配装</option></select></label>
</div><div class="controls"><label><input id="mwi-compare-fixed" type="checkbox" ${defaults.fixedSeed?'checked':''}>固定随机种子</label>
<input id="mwi-compare-seed" aria-label="随机种子" type="number" min="0" max="4294967295" step="1" value="${escape(defaults.seed)}" ${defaults.fixedSeed?'':'disabled'}>
<button class="primary" data-action="run">开始对比</button><button data-action="stop" disabled>停止</button><button data-action="export" disabled>导出 JSON</button></div>
<p class="note">两边使用相同配装、增益和原引擎基础数据；均不使用食物和饮料。次数沿用原脚本：120 秒 × 次数的模拟时间预算，实际完成局数可能不同。</p>
<p class="note">预计通关耗时保留原脚本公式（含其最后获胜时间口径）。累计计算耗时包含失败或停止前已花费的时间；初始化单独列出。固定种子用于复现，不保证两套引擎结果相同。</p>
<div class="summary"><div>原引擎累计计算耗时<strong id="mwi-compare-total-legacy">—</strong><small id="mwi-compare-init-legacy">初始化：—</small></div>
<div>Rust 累计计算耗时<strong id="mwi-compare-total-rust">—</strong><small id="mwi-compare-init-rust">初始化：—</small></div>
<div>整轮总耗时（含初始化）<strong id="mwi-compare-total-batch">—</strong><small id="mwi-compare-count">完成 0 / 10 种怪物</small></div></div>
<p id="mwi-compare-status" role="status">打开游戏并加载角色后，选择参数开始测试。</p>
<div class="table-wrap"><table><thead><tr><th><input id="mwi-compare-all" type="checkbox" checked aria-label="选择全部怪物"></th><th>怪物</th><th>等级</th><th>配装</th><th>原胜率</th><th>原预计通关</th><th>原计算耗时</th><th>Rust 胜率</th><th>Rust 预计通关</th><th>Rust 计算耗时</th><th>胜率差</th><th>状态</th></tr></thead><tbody></tbody></table></div>
<details><summary>对局明细与输入快照</summary><pre id="mwi-compare-details">测试后显示每个引擎的实际局数、失败类型和输入数据。</pre></details></div>`;
  document.body.append(toggle,panel);
  const $=s=>panel.querySelector(s);
  const action=name=>$(`[data-action="${name}"]`);
  const status=text=>{$('#mwi-compare-status').textContent=text;};

  function renderRows() {
    $('tbody').innerHTML=rows.map((row,i)=>{
      const resultCells=key=>{
        const r=row[key];if(r?.error)return `<td colspan="2" class="error" title="${escape(r.error)}">${r.attempted===false?'未运行':'计算失败'}</td><td>${r.attempted===false?'—':milliseconds(r.elapsedMs)}</td>`;
        if(!r)return '<td>—</td><td>—</td><td>—</td>';
        return `<td title="${r.successes}/${r.trials} 局获胜">${chance(r.clearChance)}<br><small>${r.successes}/${r.trials} 局</small></td><td>${seconds(r.expectedSecondsPerClear)}</td><td>${milliseconds(r.elapsedMs)}</td>`;
      };
      const delta=row.legacy&&!row.legacy.error&&row.rust&&!row.rust.error
        ?`${((row.rust.clearChance-row.legacy.clearChance)*100).toFixed(2)} pp`:'—';
      return `<tr data-monster="${row.key}" data-state="${row.status==='完成'?'done':''}"><td><input type="checkbox" data-select="${i}" ${row.selected?'checked':''} ${running?'disabled':''} aria-label="选择${row.name}"></td><td>${row.name}</td>
<td><input type="number" min="1" max="10000" step="1" data-level="${i}" value="${escape(row.level)}" ${running?'disabled':''} aria-label="${row.name}等级">${row.input&&Number(row.level)!==row.input.mazeDifficulty?`<br><small>结果等级 ${row.input.mazeDifficulty}</small>`:''}</td><td>${escape(row.loadoutName||'自动选择')}</td>
${resultCells('legacy')}${resultCells('rust')}<td>${delta}</td><td class="status">${escape(row.status)}</td></tr>`;
    }).join('');
  }
  function renderTotals() {
    if(report&&running)report.rows=structuredClone(rows.filter(r=>report.selectedKeys.includes(r.key)));
    const resultRows=report?report.rows:rows;
    const totals=totalTimings(resultRows);
    $('#mwi-compare-total-legacy').textContent=milliseconds(totals.legacyMs);
    $('#mwi-compare-total-rust').textContent=milliseconds(totals.rustMs);
    if(report){
      $('#mwi-compare-total-batch').textContent=milliseconds(report.elapsedMs??performance.now()-report.startedAt);
      $('#mwi-compare-init-legacy').textContent=`初始化：${milliseconds(report.initialization.legacyMs)}`;
      $('#mwi-compare-init-rust').textContent=`初始化：${milliseconds(report.initialization.rustMs)}`;
      const completed=resultRows.filter(r=>['完成','失败'].includes(r.status)).length;
      $('#mwi-compare-count').textContent=`完成 ${completed} / ${report.selectedCount} 种怪物`;
      report.totals=totals;
      $('#mwi-compare-details').textContent=JSON.stringify({settings:report.settings,initialization:report.initialization,
        rows:resultRows.map(({key,name,level,legacy,rust,input})=>({key,name,level,legacy,rust,input}))},
        (_,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2);
    }
  }
  function setRunning(value) {
    running=value;action('run').disabled=value;action('stop').disabled=!value;
    for(const element of panel.querySelectorAll('.controls input,.controls select,[data-action="apply"],#mwi-compare-all'))element.disabled=value;
    if(!value)$('#mwi-compare-seed').disabled=!$('#mwi-compare-fixed').checked;
    action('export').disabled=!report;renderRows();
  }
  function refreshLoadouts() {
    const select=$('#mwi-compare-loadout'),selected=select.value;
    select.innerHTML='<option value="">各怪物的迷宫配装</option>';
    for(const loadout of api.listCombatLoadouts(api.getGameState())){
      const option=document.createElement('option');option.value=String(loadout.id);option.textContent=loadout.name||`配装 ${loadout.id}`;select.append(option);
    }
    select.value=selected;
  }
  async function run() {
    if(running)return;
    let settings,state,gameData,tasks;
    try {
      settings=validateSettings({level:$('#mwi-compare-level').value,trials:$('#mwi-compare-trials').value,
        seed:$('#mwi-compare-fixed').checked?$('#mwi-compare-seed').value:null});
      const live=api.getGameState(),data=api.getInitClientData();
      if(!live||!data)throw new Error('尚未读到角色或游戏数据，请等待游戏加载后重试。');
      if(!rows.some(r=>r.selected))throw new Error('请至少选择一种怪物。');
      state=snapshotState(live);gameData=structuredClone(data);
      const maxEnhancement=api.buildMaxEnhancementByItem(state);
      const upgrades=structuredClone(api.resolveLabyrinthUpgradeLevels());
      const crates=api.getCombatCrateBuffs(state,gameData).combatCrateItemHrids;
      const override=$('#mwi-compare-loadout').value;
      tasks=rows.filter(r=>r.selected).map(row=>{
        const {level}=validateSettings({...settings,level:row.level});
        const room={roomType:'/labyrinth_room_types/combat',monsterHrid:row.hrid,recommendedLevel:level};
        const roomState={...state,characterSetting:{...state.characterSetting}};
        if(override)roomState.characterSetting[`labyrinthLoadout${row.key.split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join('')}`]=Number(override);
        const player=api.buildCombatPlayerDtoForRoom(roomState,gameData,room,maxEnhancement,{labyrinthUpgradeLevels:upgrades});
        if(!player.playerDto)throw new Error(`${row.name}缺少可用战斗配装，请在游戏中建立战斗配装。`);
        row.loadoutName=player.loadoutInfo.loadout?.name||String(player.loadoutInfo.loadoutId);
        row.input={playerDto:player.playerDto,monsterHrid:row.hrid,mazeDifficulty:level,
          trials:settings.trials,mazeCrateItemHrids:[...crates]};
        return {row,room,roomState,maxEnhancement,upgrades};
      });
      localStorage.setItem(STORAGE,JSON.stringify({...settings,seed:$('#mwi-compare-seed').value,fixedSeed:$('#mwi-compare-fixed').checked}));
    } catch(error){status(error.message);return;}
    const thisToken=++token;
    abort=new AbortController();
    report={formatVersion:1,createdAt:new Date().toISOString(),startedAt:performance.now(),settings,
      originalVersion:assets.originalVersion,originalSha256:assets.originalSha256,wasmSha256:assets.wasmSha256,
      selectedCount:tasks.length,selectedKeys:tasks.map(t=>t.row.key),initialization:{legacyMs:null,rustMs:null},rows:[]};
    for(const row of rows){row.legacy=null;row.rust=null;row.status=row.selected?'等待测试':'未选择';}
    setRunning(true);renderTotals();status('正在初始化两套引擎…');
    const clock=setInterval(renderTotals,250);
    try {
      api.resetWorker();rust?.stop();rust=null;
      let start=performance.now();
      const [vendor,worker]=await Promise.all([unpack(assets.vendor,true),unpack(assets.worker,true)]);
      if(token!==thisToken)return;
      original=await initializeOriginal(api,api.buildCombatSimulatorWorkerSource(vendor,worker)+assets.legacyBridge,abort.signal);
      if(token!==thisToken)return;
      report.initialization.legacyMs=performance.now()-start;
      start=performance.now();
      const wasm=await unpack(assets.wasm);
      if(token!==thisToken)return;
      rust=new RustClient(assets.rustWorker);
      await rust.request('init',{gameData,originalMaps:original.maps,wasm},[wasm]);
      if(token!==thisToken)return;
      report.initialization.rustMs=performance.now()-start;renderTotals();
      let legacyFailure=null;
      for(const [i,task] of tasks.entries()) {
        const {row,room,roomState,maxEnhancement,upgrades}=task;
        // Alternate order to reduce systematic first/second-engine bias.
        for(const engine of i%2?['rust','legacy']:['legacy','rust']){
          if(token!==thisToken)return;
          row.status=engine==='legacy'?'原引擎计算中':'Rust 计算中';renderRows();status(`正在测试 ${i+1}/${tasks.length}：${row.name} · ${row.status}`);
          const started=performance.now();
          let attempted=false;
          try {
            if(engine==='legacy'){
              if(legacyFailure)throw legacyFailure;
              if(api.peekWorker()!==original.worker)throw new Error('原引擎已终止，请重新开始测试');
              attempted=true;activeAttempt={row,engine,started};
              original.worker.postMessage({type:'comparison_seed',seed:settings.seed});
              const result=await api.computeCombatRoomClearChanceFullFlow(roomState,gameData,room,maxEnhancement,null,
                settings.trials,row.key,{labyrinthUpgradeLevels:upgrades});
              row.legacy={...summarizeResult(result.combatMeta),elapsedMs:performance.now()-started};
              // Preserve exactly the original post-processing, not a reimplemented approximation.
              row.legacy.clearChance=result.clearChance;row.legacy.expectedSecondsPerClear=result.expectedSecondsPerClear;
            } else {
              if(rust.stoppedError)throw rust.stoppedError;
              attempted=true;activeAttempt={row,engine,started};
              const seed=settings.seed??crypto.getRandomValues(new Uint32Array(1))[0];
              const result=await rust.request('run',{params:{...row.input,seed}});
              row.rust={...result,elapsedMs:performance.now()-started};
            }
          } catch(error){if(token!==thisToken)return;row[engine]={error:error.message,attempted,elapsedMs:attempted?performance.now()-started:0};
            if(engine==='legacy'){legacyFailure=error;api.resetWorker();}}
          if(token!==thisToken)return;
          activeAttempt=null;
          renderRows();renderTotals();
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        row.status=row.legacy?.error||row.rust?.error?'失败':'完成';renderRows();renderTotals();
      }
      report.elapsedMs=performance.now()-report.startedAt;
      status(rows.some(r=>r.selected&&r.status==='失败')?'测试结束，部分引擎计算失败，可查看详情。':'测试完成。累计计算耗时及整轮总耗时已更新。');
    } catch(error){if(token===thisToken){report.elapsedMs=performance.now()-report.startedAt;status(`初始化失败：${error.message}`);}}
    finally{clearInterval(clock);if(token===thisToken){setRunning(false);renderTotals();}}
  }
  function stop(){
    if(!running)return;
    ++token;abort?.abort();api.resetWorker();rust?.stop();rust=null;original=null;
    if(activeAttempt){const {row,engine,started}=activeAttempt;row[engine]={error:'测试已停止',attempted:true,elapsedMs:performance.now()-started};activeAttempt=null;}
    report.elapsedMs=performance.now()-report.startedAt;report.stopped=true;
    for(const row of rows)if(row.selected&&!['完成','失败'].includes(row.status))row.status='已停止';
    report.rows=structuredClone(rows.filter(r=>report.selectedKeys.includes(r.key)));
    setRunning(false);renderTotals();status('已停止；已完成结果和累计耗时保留。');
  }
  toggle.onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden&&!running)refreshLoadouts();};
  action('close').onclick=()=>{panel.hidden=true;};action('run').onclick=run;action('stop').onclick=stop;
  action('apply').onclick=()=>{try{
    const {level}=validateSettings({level:$('#mwi-compare-level').value,trials:$('#mwi-compare-trials').value});
    for(const row of rows)row.level=level;renderRows();
  }catch(error){status(error.message);}};
  $('#mwi-compare-fixed').onchange=()=>{$('#mwi-compare-seed').disabled=!$('#mwi-compare-fixed').checked;};
  $('#mwi-compare-all').onchange=e=>{for(const row of rows)row.selected=e.target.checked;renderRows();};
  $('tbody').onchange=e=>{
    if(e.target.dataset.select!==undefined){rows[Number(e.target.dataset.select)].selected=e.target.checked;$('#mwi-compare-all').checked=rows.every(r=>r.selected);}
    if(e.target.dataset.level!==undefined)rows[Number(e.target.dataset.level)].level=Number(e.target.value);
  };
  action('export').onclick=()=>{
    if(!report)return;
    const data={...report,startedAt:undefined};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,(_,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`迷宫双引擎对比-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  window.addEventListener('beforeunload',()=>{api.resetWorker();rust?.stop();});renderRows();
}
