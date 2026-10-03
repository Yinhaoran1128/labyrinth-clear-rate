const ROOT_ID = 'mwi-lab-recommend-chart';
const STYLE_ID = 'mwi-lab-recommend-chart-style';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = {30:'#a78bfa',100:'#60a5fa',300:'#34d399',1000:'#fb7185'};
const COPY = {
  zh: {title:'胜率—等级曲线',close:'关闭图表',level:'房间等级',win:'胜率',recommended:'推荐等级',
    fit:'单调拟合',raw:'模拟胜率',target:'目标',ci:'95% 置信区间',focus:'目标附近',reset:'全部范围',
    all:'全部模拟记录',budget:'模拟预算',trials:'实际统计次数',wins:'成功数',round:'轮次',latest:'参与拟合',old:'历史轮次',
    simulations:'次模拟',levels:'个等级',zoomIn:'放大',zoomOut:'缩小',help:'滚轮缩放 · 拖动平移 · 点击散点查看详情',
    hint:'点击查看胜率—等级图',keyboard:'回车或空格打开图表',
    note:'误差棒为 95% Wilson 二项置信区间，按实际统计次数计算。连续战斗按独立对局近似；历史轮次全部保留，拟合仅使用每个等级的最新结果。',
    tableHint:'可点击行定位对应散点；同一等级的多轮结果分别列出。'},
  en: {title:'Win rate by level',close:'Close chart',level:'Room level',win:'Win rate',recommended:'Recommended level',
    fit:'Monotone fit',raw:'Simulated win rate',target:'Target',ci:'95% confidence interval',focus:'Near target',reset:'All levels',
    all:'All simulation records',budget:'Simulation budget',trials:'Actual trial count',wins:'Wins',round:'Run',latest:'Used in fit',old:'Earlier run',
    simulations:'runs',levels:'levels',zoomIn:'Zoom in',zoomOut:'Zoom out',help:'Scroll to zoom · Drag to pan · Select a point for details',
    hint:'View win rate by level',keyboard:'Enter or Space opens chart',
    note:'Error bars show 95% Wilson binomial intervals using actual trial counts. Continuous battles are approximated as independent trials. Every run is retained; only the latest run at each level enters the fit.',
    tableHint:'Select a row to locate its point. Repeated runs at the same level are listed separately.'},
};
const PRODUCTION_COPY = {
  zh: {fit:'公式计算',raw:'通关胜率',all:'全部等级记录',success:'操作成功率',double:'双倍进度率',
    attempts:'操作次数',progress:'单次成功进度',targetProgress:'目标进度',needed:'所需进度单位',enhancingTarget:'目标强化',impossible:'无法完成',
    note:'每个点是对应整数等级的公式计算胜率，连线辅助阅读。使用本轮推荐的配装和加成；取整产生的阶梯变化保留原值。',
    tableHint:'每个整数等级各一条记录，点击行可定位对应点。'},
  en: {fit:'Calculated curve',raw:'Clear chance',all:'All level records',success:'Action success',double:'Double progress',
    attempts:'Actions',progress:'Progress per success',targetProgress:'Target progress',needed:'Required units',enhancingTarget:'Enhancement target',impossible:'Unreachable',
    note:'Each point is the formula-based probability at an integer level; lines guide the eye. Uses this recommendation’s loadout and bonuses. Discrete progress changes are preserved.',
    tableHint:'One record per integer level. Select a row to locate its point.'},
};
const percent = value => `${(value * 100).toFixed(1)}%`;
const intervalText = row => `${percent(row.confidenceInterval.lower)} – ${percent(row.confidenceInterval.upper)}`;
const svgNode = (tag, attributes = {}, text) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
};
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.mwi-lab-chart-cell {cursor:pointer!important;color:#a7f3d0!important;border-radius:5px}
.mwi-lab-chart-cell::after {content:' ▥';font-size:12px;color:#6ee7b7;opacity:.9}
.mwi-lab-chart-cell:focus-visible {outline:2px solid #6ee7b7;outline-offset:3px}
#${ROOT_ID} {position:fixed;inset:0;z-index:2147483600;background:rgba(4,10,18,.78);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font:13px/1.5 system-ui,-apple-system,sans-serif;color:#dce7f4;color-scheme:dark}
#${ROOT_ID} * {box-sizing:border-box}
#${ROOT_ID} .mwi-chart-panel {width:min(1020px,100%);max-height:94vh;overflow:auto;overscroll-behavior:contain;background:#111e2e;border:1px solid #30445d;border-radius:18px;box-shadow:0 24px 100px #0009;outline:none}
#${ROOT_ID} .mwi-chart-header {display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:22px 24px 16px;border-bottom:1px solid #26384d}
#${ROOT_ID} h2 {font-size:19px;font-weight:650;letter-spacing:.01em;margin:0;color:#f1f7ff}
#${ROOT_ID} .mwi-chart-subtitle {color:#90a5be;margin-top:5px}
#${ROOT_ID} button {font:inherit;color:#ceddf0;background:#1b2c42;border:1px solid #354b66;border-radius:8px;padding:6px 12px;cursor:pointer;white-space:nowrap;line-height:1.5}
#${ROOT_ID} button:hover {background:#29415d;border-color:#6482a6}
#${ROOT_ID} button:focus-visible,#${ROOT_ID} summary:focus-visible {outline:2px solid #6ee7b7;outline-offset:3px}
#${ROOT_ID} [data-action=close] {font-size:23px;padding:0 9px;line-height:1.5;background:transparent}
#${ROOT_ID} .mwi-chart-content {padding:20px 24px 22px}
#${ROOT_ID} .mwi-chart-cards {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
#${ROOT_ID} .mwi-chart-card {padding:12px 15px;border:1px solid #2b3d54;border-radius:11px;background:#15253a;min-width:0}
#${ROOT_ID} .mwi-chart-card small {display:block;color:#96abc3;font-size:11px}
#${ROOT_ID} .mwi-chart-card strong {display:block;color:#e5f0ff;font-size:21px;letter-spacing:.02em;margin-top:3px;font-variant-numeric:tabular-nums}
#${ROOT_ID} .mwi-chart-card:first-child strong {color:#fbbf24}
#${ROOT_ID} .mwi-chart-card:nth-child(2) strong {color:#5eead4}
#${ROOT_ID} .mwi-chart-card:last-child strong {font-size:17px}
#${ROOT_ID} .mwi-chart-toolbar {display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
#${ROOT_ID} .mwi-chart-legend,#${ROOT_ID} .mwi-chart-actions {display:flex;align-items:center;gap:7px;flex-wrap:wrap}
#${ROOT_ID} .mwi-chart-legend button {padding:4px 8px;background:transparent;font-size:11px}
#${ROOT_ID} .mwi-chart-legend button[aria-pressed=false] {opacity:.35}
#${ROOT_ID} .mwi-chart-swatch {display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px}
#${ROOT_ID} .mwi-chart-fit-label {color:#5eead4;font-size:11px;margin-right:5px}
#${ROOT_ID} .mwi-chart-plot {border:1px solid #293c53;border-radius:11px;background:#0c1726;overflow:hidden}
#${ROOT_ID} svg {width:100%;height:355px;display:block;touch-action:none;cursor:grab;user-select:none}
#${ROOT_ID} svg:active {cursor:grabbing}
#${ROOT_ID} svg [data-observation-id] {cursor:pointer;outline:none}
#${ROOT_ID} svg [data-observation-id]:focus {stroke:#fff;stroke-width:2.5}
#${ROOT_ID} .mwi-chart-help {font-size:11px;color:#8da5c0;margin:8px 0}
#${ROOT_ID} [data-point-detail] {min-height:48px;padding:10px 13px;background:#16283e;border:1px solid #2d4764;border-radius:9px;color:#d2e6fc;font-variant-numeric:tabular-nums}
#${ROOT_ID} details {margin-top:17px;border:1px solid #2c4059;border-radius:10px;overflow:hidden}
#${ROOT_ID} summary {padding:11px 14px;cursor:pointer;background:#182a40;color:#d7e9fc;font-weight:550}
#${ROOT_ID} .mwi-chart-table-wrap {overflow:auto;max-height:280px}
#${ROOT_ID} table {width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums}
#${ROOT_ID} th {position:sticky;top:0;background:#20344d;text-align:left;font-weight:500;color:#a9c2df}
#${ROOT_ID} td,#${ROOT_ID} th {padding:8px 13px;border-bottom:1px solid #23364c}
#${ROOT_ID} tbody tr {cursor:pointer}
#${ROOT_ID} tbody tr:hover,#${ROOT_ID} tbody tr:focus-visible {background:#243d57;outline:none}
#${ROOT_ID} tbody tr[data-selected=true] {background:#254359}
#${ROOT_ID} .mwi-chart-note {color:#92a8c1;font-size:11px;margin:12px 2px 0;line-height:1.6}
#${ROOT_ID} .mwi-chart-table-hint {color:#90a7c0;font-size:11px;padding:8px 13px;margin:0}
@media(max-width:650px) {#${ROOT_ID}{padding:8px}#${ROOT_ID} .mwi-chart-panel{max-height:97vh;border-radius:12px}#${ROOT_ID} .mwi-chart-header{padding:16px}#${ROOT_ID} .mwi-chart-content{padding:14px}#${ROOT_ID} h2{font-size:16px}#${ROOT_ID} .mwi-chart-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#${ROOT_ID} .mwi-chart-card{padding:9px 12px}#${ROOT_ID} svg{height:300px}#${ROOT_ID} .mwi-chart-actions button{padding:4px 8px}}
`;
  document.head.appendChild(style);
}

export function bindCell(cell, getEstimate, getLocale, beforeOpen) {
  const estimate = getEstimate();
  const enabled = estimate?.status === 'ready' && !!estimate.recommendationChart?.observations?.length;
  ensureStyle();
  cell.classList.toggle('mwi-lab-chart-cell', enabled);
  if (enabled) {
    const t = COPY[getLocale()] || COPY.en;
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-label', `${estimate.roomLabel}: ${cell.textContent}. ${t.hint}. ${t.keyboard}`);
  } else {
    cell.removeAttribute('role');cell.removeAttribute('tabindex');cell.removeAttribute('aria-label');
  }
  if (cell.__mwiChartBound) return;
  cell.__mwiChartBound = true;
  const open = () => {
    const current = getEstimate();
    if (current?.status !== 'ready' || !current.recommendationChart?.observations?.length) return;
    beforeOpen?.();
    show({title:current.roomLabel, data:current.recommendationChart, locale:getLocale(), returnFocus:cell});
  };
  cell.addEventListener('click', open);
  cell.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();open();
  });
}

export function show({title, data, locale = 'en', returnFocus = document.activeElement}) {
  if (!data?.observations?.length) return;
  document.getElementById(ROOT_ID)?.dispatchEvent(new Event('mwi-chart-close'));
  ensureStyle();
  const production = data.kind === 'production';
  const language = COPY[locale] ? locale : 'en';
  const t = {...COPY[language], ...(production ? PRODUCTION_COPY[language] : {})};
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<div class="mwi-chart-panel" role="dialog" aria-modal="true" aria-labelledby="mwi-chart-title" tabindex="-1">
    <div class="mwi-chart-header"><div><h2 id="mwi-chart-title"></h2><div class="mwi-chart-subtitle"></div></div><button data-action="close" aria-label="${t.close}">×</button></div>
    <div class="mwi-chart-content"><div class="mwi-chart-cards"></div>
      <div class="mwi-chart-toolbar"><div class="mwi-chart-legend"><span class="mwi-chart-fit-label">━ ${t.fit}</span></div>
      <div class="mwi-chart-actions"><button data-action="focus">${t.focus}</button><button data-action="reset">${t.reset}</button><button data-action="out" aria-label="${t.zoomOut}">−</button><button data-action="in" aria-label="${t.zoomIn}">＋</button></div></div>
      <div class="mwi-chart-plot"><svg role="img" aria-label="${t.title}" preserveAspectRatio="none"></svg></div>
      <div class="mwi-chart-help">${t.help}</div><div data-point-detail role="status" aria-live="polite"></div>
      <details><summary>${t.all} (${data.observations.length})</summary><p class="mwi-chart-table-hint">${t.tableHint}</p><div class="mwi-chart-table-wrap"><table><thead><tr></tr></thead><tbody></tbody></table></div></details>
      <p class="mwi-chart-note">${t.note}</p>
    </div></div>`;
  root.querySelector('h2').textContent = `${title || ''} · ${t.title}`;
  root.querySelector('.mwi-chart-subtitle').textContent = `${production ? '' : `${data.observations.length} ${t.simulations} · `}${data.levelCount} ${t.levels} · ${t.target} ${percent(data.targetChance)}`;
  document.body.appendChild(root);
  const panel = root.querySelector('.mwi-chart-panel'), svg = root.querySelector('svg');
  const abort = new AbortController();
  let resizeObserver;
  const close = () => {
    abort.abort();resizeObserver?.disconnect();root.remove();
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  };
  root.addEventListener('mwi-chart-close', close, {signal:abort.signal});
  root.querySelector('[data-action=close]').onclick = close;
  root.addEventListener('click', event => {if (event.target === root) close();});
  // Keep keyboard navigation in the chart and restore the caller on close.
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();close();}
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button,[tabindex="0"],summary')]
      .filter(node => node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
  });

  const latest = data.observations.filter(row => row.isLatest);
  const finalist = latest.find(row => row.roomLevel === data.recommendedLevel) || latest[0];
  const fitted = data.curve.find(row => row.roomLevel === data.recommendedLevel)?.fittedChance;
  const cards = production
    ? [[t.recommended, `Lv.${data.recommendedLevel}`],[t.raw, percent(finalist.clearChance)],
      [t.success, percent(finalist.successChance)],[t.attempts, finalist.attempts]]
    : [[t.recommended, `Lv.${data.recommendedLevel}`],[t.fit, percent(fitted)],
      [t.raw, percent(finalist.clearChance)],[t.ci, intervalText(finalist)]];
  for (const [label,value] of cards) {
    const card = document.createElement('div');card.className='mwi-chart-card';
    const small = document.createElement('small'), strong = document.createElement('strong');
    small.textContent=label;strong.textContent=value;card.append(small,strong);
    root.querySelector('.mwi-chart-cards').appendChild(card);
  }
  const levels = data.observations.map(row => row.roomLevel);
  const lo = Math.min(...levels), hi = Math.max(...levels);
  const padding = Math.max(1,(hi-lo)*.04);
  const fullRange = [Math.max(1,lo-padding),hi+padding];
  let range = [...fullRange], selected = finalist.id, drag = null;
  const visibleBudgets = new Set(production ? [] : data.observations.map(row => row.budget));
  const plot = {left:55,right:20,top:34,bottom:43,width:0,height:0};
  const x = level => plot.left + (level-range[0])/(range[1]-range[0])*(plot.width-plot.left-plot.right);
  const y = chance => plot.top + (1-chance)*(plot.height-plot.top-plot.bottom);
  const color = budget => production ? '#5eead4' : COLORS[budget] || '#94a3b8';
  const unitsText = value => Number.isFinite(value) ? String(value) : t.impossible;
  const productionDetails = row => [
    `${t.raw} ${percent(row.clearChance)}`,`${t.success} ${percent(row.successChance)}`,
    `${t.double} ${percent(row.doubleChance)}`,`${t.attempts} ${row.attempts}`,
    ...(row.type === 'enhancing' ? [`${t.enhancingTarget} +${row.targetLevel}`]
      : [`${t.progress} ${row.progressPerSuccess}`,`${t.targetProgress} ${row.targetProgress}`,`${t.needed} ${unitsText(row.neededUnits)}`]),
  ].join(' · ');
  const detail = row => {
    selected = row.id;
    root.querySelector('[data-point-detail]').textContent = production
      ? `Lv.${row.roomLevel} · ${productionDetails(row)}`
      : `Lv.${row.roomLevel} · ${t.round} #${row.id} · ${t.budget} ${row.budget} · ${t.wins} ${row.successes}/${row.trials} · ${t.raw} ${percent(row.clearChance)} · ${t.ci} ${intervalText(row)} · ${row.isLatest?t.latest:t.old}`;
    for (const tr of root.querySelectorAll('tbody tr')) tr.dataset.selected = String(Number(tr.dataset.runId) === selected);
    for (const node of svg.querySelectorAll('[data-observation-id]')) {
      const active = Number(node.dataset.observationId) === selected;
      node.setAttribute('stroke',active?'#fff':color(Number(node.dataset.budget)));
      node.setAttribute('stroke-width',active?'2':'1');
    }
  };
  const setRange = (a,b) => {
    const width = Math.min(fullRange[1]-fullRange[0],Math.max(2,b-a));
    const start = Math.max(fullRange[0],Math.min(fullRange[1]-width,a));
    range=[start,start+width];draw();
  };
  const focusLevel = level => {
    const half = Math.max(6,Math.min(production ? 15 : Infinity,(fullRange[1]-fullRange[0])*.09));
    setRange(level-half,level+half);
  };
  const zoom = (factor, anchor = (range[0]+range[1])/2) => {
    setRange(anchor+(range[0]-anchor)*factor,anchor+(range[1]-anchor)*factor);
  };
  const draw = () => {
    if (!root.isConnected) return;
    const focusedId = svg.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-observation-id') : null;
    plot.width=Math.max(280,svg.getBoundingClientRect().width);
    plot.height=svg.getBoundingClientRect().height;
    svg.setAttribute('viewBox',`0 0 ${plot.width} ${plot.height}`);
    svg.setAttribute('data-level-range',range.join(','));
    svg.replaceChildren();
    const definitions=svgNode('defs');
    const clip=svgNode('clipPath',{id:'mwi-chart-plot-clip'});
    clip.appendChild(svgNode('rect',{x:plot.left,y:plot.top,width:plot.width-plot.left-plot.right,height:plot.height-plot.top-plot.bottom}));
    definitions.appendChild(clip);svg.appendChild(definitions);
    for (let chance=0;chance<=1.001;chance+=.2) {
      svg.appendChild(svgNode('line',{x1:plot.left,x2:plot.width-plot.right,y1:y(chance),y2:y(chance),stroke:'#23364b'}));
      svg.appendChild(svgNode('text',{x:plot.left-10,y:y(chance)+4,'text-anchor':'end',fill:'#8da7c5','font-size':11},`${Math.round(chance*100)}%`));
    }
    const rawStep=(range[1]-range[0])/Math.max(3,Math.floor(plot.width/90));
    const magnitude=10**Math.floor(Math.log10(Math.max(1,rawStep)));
    const step=[1,2,5,10].find(n=>n*magnitude>=rawStep)*magnitude;
    for (let level=Math.ceil(range[0]/step)*step;level<=range[1];level+=step) {
      svg.appendChild(svgNode('line',{x1:x(level),x2:x(level),y1:plot.top,y2:plot.height-plot.bottom,stroke:'#1a2d42'}));
      svg.appendChild(svgNode('text',{x:x(level),y:plot.height-plot.bottom+20,'text-anchor':'middle',fill:'#8da7c5','font-size':11},String(level)));
    }
    svg.appendChild(svgNode('text',{x:plot.left,y:18,fill:'#a7bfdc','font-size':11},t.win));
    svg.appendChild(svgNode('text',{x:(plot.left+plot.width-plot.right)/2,y:plot.height-7,'text-anchor':'middle',fill:'#a7bfdc','font-size':11},t.level));
    const layer=svgNode('g',{'clip-path':'url(#mwi-chart-plot-clip)'});svg.appendChild(layer);
    const coordinates=data.curve.map(row=>`${x(row.roomLevel)},${y(production ? row.clearChance : row.fittedChance)}`);
    if (coordinates.length) {
      const first=data.curve[0],last=data.curve.at(-1);
      layer.appendChild(svgNode('path',{d:`M${x(first.roomLevel)},${y(0)} L${coordinates.join(' L')} L${x(last.roomLevel)},${y(0)} Z`,fill:'#2dd4bf',opacity:.05}));
    }
    layer.appendChild(svgNode('line',{x1:plot.left,x2:plot.width-plot.right,y1:y(data.targetChance),y2:y(data.targetChance),stroke:'#fbbf24','stroke-dasharray':'6 5',opacity:.8}));
    layer.appendChild(svgNode('line',{x1:x(data.recommendedLevel),x2:x(data.recommendedLevel),y1:plot.top,y2:plot.height-plot.bottom,stroke:'#fbbf24','stroke-dasharray':'3 5',opacity:.55}));
    for (const row of data.observations) {
      if (production) break;
      if (!visibleBudgets.has(row.budget) || row.roomLevel<range[0] || row.roomLevel>range[1]) continue;
      const cx=x(row.roomLevel),lower=y(row.confidenceInterval.lower),upper=y(row.confidenceInterval.upper);
      const bar=svgNode('g',{'data-error-bar':row.id,stroke:color(row.budget),opacity:row.isLatest?.5:.23,'stroke-width':1.2});
      for (const attributes of [{x1:cx,x2:cx,y1:upper,y2:lower},{x1:cx-3,x2:cx+3,y1:upper,y2:upper},{x1:cx-3,x2:cx+3,y1:lower,y2:lower}]) bar.appendChild(svgNode('line',attributes));
      layer.appendChild(bar);
    }
    layer.appendChild(svgNode('path',{[production ? 'data-calculated-curve' : 'data-fit-curve']:'',d:coordinates.length?`M${coordinates.join(' L')}`:'',fill:'none',stroke:'#5eead4','stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round'}));
    for (const row of data.observations) {
      if ((!production && !visibleBudgets.has(row.budget)) || row.roomLevel<range[0] || row.roomLevel>range[1]) continue;
      const label = production ? `Lv.${row.roomLevel} · ${productionDetails(row)}`
        : `Lv.${row.roomLevel}, ${t.round} ${row.id}, ${percent(row.clearChance)}, ${t.ci} ${intervalText(row)}`;
      const point=svgNode('circle',{cx:x(row.roomLevel),cy:y(row.clearChance),r:production?2.5:row.isLatest?4.5:3.3,fill:color(row.budget),opacity:row.isLatest?1:.65,
        'data-observation-id':row.id,...(production?{}:{'data-budget':row.budget}),tabindex:0,role:'button','aria-label':label});
      point.appendChild(svgNode('title',{},label));
      point.onpointerenter=()=>detail(row);point.onfocus=()=>detail(row);
      point.onclick=event=>{event.stopPropagation();detail(row);};
      point.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();detail(row);}};
      layer.appendChild(point);
    }
    const labelX=plot.width-plot.right-6;
    svg.appendChild(svgNode('text',{x:labelX,y:Math.max(plot.top+13,Math.min(plot.height-plot.bottom-6,y(data.targetChance)-8)),'text-anchor':'end',fill:'#fbbf24','font-size':11},`${t.target} ${percent(data.targetChance)}`));
    detail(data.observations.find(row=>row.id===selected) || finalist);
    if (focusedId !== null) {
      // Resize/zoom replaces SVG children. Keep keyboard focus inside the dialog,
      // even when the focused observation is no longer in the visible range.
      const replacement=svg.querySelector(`[data-observation-id="${Number(focusedId)}"]`);
      (replacement || panel).focus({preventScroll:true});
    }
  };
  for (const budget of [...visibleBudgets].sort((a,b)=>a-b)) {
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed','true');
    button.innerHTML=`<span class="mwi-chart-swatch" style="background:${color(budget)}"></span>${budget}`;
    button.title=`${t.budget} ${budget}`;
    button.onclick=()=>{
      if(visibleBudgets.has(budget))visibleBudgets.delete(budget);else visibleBudgets.add(budget);
      button.setAttribute('aria-pressed',String(visibleBudgets.has(budget)));draw();
    };
    root.querySelector('.mwi-chart-legend').appendChild(button);
  }
  const head=root.querySelector('thead tr');
  const enhancing = production && finalist.type === 'enhancing';
  const columns = production ? [t.level,t.raw,t.success,t.double,t.attempts,
    ...(enhancing ? [t.enhancingTarget] : [t.progress,t.targetProgress,t.needed])]
    : [t.round,t.level,t.budget,t.wins,t.trials,t.raw,t.ci,t.fit];
  for(const label of columns) {
    const th=document.createElement('th');th.textContent=label;head.appendChild(th);
  }
  const fittedByLevel=new Map(data.curve.map(row=>[row.roomLevel,row.fittedChance]));
  for(const row of [...data.observations].sort((a,b)=>a.roomLevel-b.roomLevel||a.id-b.id)) {
    const tr=document.createElement('tr');tr.tabIndex=0;tr.dataset.runId=row.id;
    const values = production ? [row.roomLevel,percent(row.clearChance),percent(row.successChance),percent(row.doubleChance),row.attempts,
      ...(enhancing ? [`+${row.targetLevel}`] : [row.progressPerSuccess,row.targetProgress,unitsText(row.neededUnits)])]
      : [`#${row.id}`,row.roomLevel,row.budget,row.successes,row.trials,percent(row.clearChance),intervalText(row),row.isLatest?percent(fittedByLevel.get(row.roomLevel)):t.old];
    for(const value of values) {
      const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td);
    }
    const select=()=>{
      if (!production) {
        visibleBudgets.add(row.budget);
        for(const button of root.querySelectorAll('.mwi-chart-legend button'))if(button.title===`${t.budget} ${row.budget}`)button.setAttribute('aria-pressed','true');
      }
      selected=row.id;focusLevel(row.roomLevel);detail(row);
    };
    tr.onclick=select;tr.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}};
    root.querySelector('tbody').appendChild(tr);
  }
  root.querySelector('[data-action=focus]').onclick=()=>{
    selected=finalist.id;focusLevel(data.recommendedLevel);
  };
  root.querySelector('[data-action=reset]').onclick=()=>{range=[...fullRange];draw();};
  root.querySelector('[data-action=in]').onclick=()=>zoom(.65);
  root.querySelector('[data-action=out]').onclick=()=>zoom(1/.65);
  svg.addEventListener('wheel',event=>{
    event.preventDefault();
    const box=svg.getBoundingClientRect();
    const ratio=Math.max(0,Math.min(1,(event.clientX-box.left-plot.left)/(plot.width-plot.left-plot.right)));
    zoom(event.deltaY>0?1.2:1/1.2,range[0]+ratio*(range[1]-range[0]));
  },{passive:false});
  svg.addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-observation-id]') || event.button!==0)return;
    drag={x:event.clientX,range:[...range]};svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove',event=>{
    if(!drag)return;
    const delta=(event.clientX-drag.x)/(plot.width-plot.left-plot.right)*(drag.range[1]-drag.range[0]);
    setRange(drag.range[0]-delta,drag.range[1]-delta);
  });
  svg.addEventListener('pointerup',()=>{drag=null;});svg.addEventListener('pointercancel',()=>{drag=null;});
  resizeObserver=new ResizeObserver(draw);resizeObserver.observe(svg);
  focusLevel(data.recommendedLevel);panel.focus({preventScroll:true});
  return root;
}
