import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from '../comparison/node_modules/esbuild/lib/main.js';
import {stockEngine} from '../comparison/tests/stock-engine.mjs';
import {fixtureGame} from '../comparison/tests/fixtures.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin='aa4ffc048f53e7d628a52b8ccfe7c633979580fdaaf5df3a8102818be02d1da2';
const packed=value=>gzipSync(Buffer.from(value),{mtime:0}).toString('base64');
export async function buildCalculators() {
  const original=fs.readFileSync(path.join(here,'../labyrinth-clear-rate.user.js'),'utf8');
  if(sha(original)!==pin)throw new Error('Original 1.5.14 changed; review generator before building');
  const compile=async(file,opts={})=>(await build({entryPoints:[path.join(here,file)],bundle:true,write:false,
    format:'iife',target:'chrome100',legalComments:'inline',...opts})).outputFiles[0].text;
  const worker=await compile('worker.mjs');
  const runtime=await compile('client.mjs',{globalName:'CalculatorRuntime'});
  const recommendation=await compile('recommendation.mjs',{globalName:'CombatRecommendation'});
  const production=await compile('production-chart.mjs',{globalName:'ProductionChart'});
  const chart=await compile('recommendation-chart.mjs',{globalName:'RecommendationChart'});
  const stock=await stockEngine();
  const data=packed(JSON.stringify({fallbackData:fixtureGame().$e,originalMaps:stock.maps}));
  const wasm=fs.readFileSync(path.join(here,'../comparison/assets/mwi_engine.wasm'));
  const paths={};
  for(const mode of ['embedded','remote']) {
    const label=mode==='embedded'?'Rust 内置修正版':'Rust 远程上游版';
    const model=mode==='embedded'?`rust-compat-${sha(wasm)}`:'rust-upstream-dynamic-v1';
    const assets={mode,worker,data,wasm:mode==='embedded'?packed(wasm):null,hash:mode==='embedded'?sha(wasm):null};
    let source=original
      .replace(/\/\/ @name(?:\:zh-CN)?\s+迷宫胜率计算器/g,match=>match.replace('迷宫胜率计算器',`迷宫胜率计算器（${label}）`))
      .replace(/\/\/ @name:en[^\n]+/,'// @name:en      Labyrinth Calculator '+(mode==='embedded'?'Rust Embedded':'Rust Remote'))
      .replace(/\/\/ @namespace[^\n]+/,`// @namespace    mwi-labyrinth-calculator-rust-${mode}`)
      .replace(/\/\/ @version[^\n]+/,'// @version      1.6.4')
      .replace(/\/\/ @author[^\n]+/,'// @author       dakonglong; wow121; Yinhr (Rust adapter)')
      .replace(/\/\/ @description:zh-CN[^\n]+/,`// @description:zh-CN  原版迷宫界面与配装逻辑；${label}计算战斗胜率和预计通关耗时。`)
      .replace(/^\/\/ @(?:downloadURL|updateURL)[^\n]+\n/gm,'')
      .replace(/window\.__MWI_LAB_CLEAR_RATE_OVERLAY_VERSION__ = "[^"]+";/,`window.__MWI_LAB_CLEAR_RATE_OVERLAY_VERSION__ = "1.6.4-rust-${mode}";`)
      .replace(/const COMBAT_MODEL_SIGNATURE = "[^"]+";/,`const COMBAT_MODEL_SIGNATURE = "${model}";`);
    const insert=source.indexOf('    const ROOM_DURATION_SECONDS =');
    source=source.slice(0,insert)+`\n${runtime}\n${recommendation}\n${production}\n${chart}\n    const rustCalculator = CalculatorRuntime.create(${JSON.stringify(assets)});\n`+source.slice(insert);
    // Apply the new search only to combat; the pinned original remains unchanged.
    source=source.replace('    async function findAutomationRecommendedLevelDelta(params) {',`
    async function findAutomationRecommendedLevelDelta(params) {
        if (params.entry?.isCombat) {
            return CombatRecommendation.findCombatRecommendation({
                effectiveLevel: params.effectiveLevel,
                targetChance: params.targetChance,
                minDelta: AUTOMATION_RECOMMEND_MIN_DELTA,
                maxDelta: AUTOMATION_RECOMMEND_MAX_DELTA,
                evaluate: (roomLevel, budget) => computeAutomationEntryClearChanceByRoomLevel(
                    { ...params, recommendCombatTrials: budget }, roomLevel
                ),
            });
        }`);
    // Attach the full production curve after the original recommendation search.
    source=source.replace('        return bestMatch;\n    }\n\n    async function runAutomationRecommendCalculation()',`
        if (bestMatch) {
            bestMatch.recommendationChart = await ProductionChart.createProductionChartData({
                effectiveLevel: params.effectiveLevel, targetChance: params.targetChance,
                recommendedLevel: bestMatch.roomLevel,
                minDelta: AUTOMATION_RECOMMEND_MIN_DELTA, maxDelta: AUTOMATION_RECOMMEND_MAX_DELTA,
                evaluate: (roomLevel) => computeAutomationEntryClearChanceByRoomLevel(params, roomLevel),
            });
        }
        return bestMatch;
    }

    async function runAutomationRecommendCalculation()`);
    // Verification must simulate anew rather than reuse an earlier random draw.
    source=source.replace('{ includePersonalBuffs: false }\n              )\n            : computeRoomClearChance',
      '{ includePersonalBuffs: false, disableCache: true }\n              )\n            : computeRoomClearChance');
    source=source.replace('clearChance: clamp01(finiteNumber(match.clearChance, 0)),',`clearChance: clamp01(finiteNumber(match.clearChance, 0)),
                            fittedChance: match.fittedChance,
                            recommendationMethod: match.recommendationMethod,
                            recommendationChart: match.recommendationChart,`);
    source=source.replace('recommendSettingLevel: "Recommend Setting Level",',
      'recommendSettingLevel: "Recommend Setting Level",\n            fittedWinRate: "Fitted Win Rate",\n            simulatedWinRate: "Simulated Win Rate",\n            winRateChart: "Chart",\n            winRateChartHint: "Click the recommended level to view the curve",');
    source=source.replace('recommendSettingLevel: "推荐设置等级",',
      'recommendSettingLevel: "推荐设置等级",\n            fittedWinRate: "拟合胜率",\n            simulatedWinRate: "模拟胜率",\n            winRateChart: "图表",\n            winRateChartHint: "点击推荐等级查看曲线",');
    source=source.replace('return `ready:${delta}:${roomLevel}:${chancePercent}`;',
      'return `ready:${delta}:${roomLevel}:${chancePercent}:${estimate.fittedChance ?? ""}`;');
    const tooltipLevel='        appendPreviewRow(tooltip, t("level"), `Lv.${Math.max(1, Math.floor(finiteNumber(estimate.roomLevel, 1)))}`);';
    source=source.replace(tooltipLevel,tooltipLevel+`
        if (estimate.isCombat && Number.isFinite(estimate.fittedChance)) {
            appendPreviewRow(tooltip, t("fittedWinRate"), (estimate.fittedChance * 100).toFixed(1) + "%");
            appendPreviewRow(tooltip, t("simulatedWinRate"), (estimate.clearChance * 100).toFixed(1) + "%");
        }
        if (estimate.recommendationChart) appendPreviewRow(tooltip, t("winRateChart"), t("winRateChartHint"));`);
    const bindChartCell=`
        RecommendationChart.bindCell(cell, () => getAutomationRecommendFromCell(cell),
            () => isChineseUi() ? "zh" : "en", hidePreviewTooltip);`;
    source=source.replace('        cell.classList.add(AUTOMATION_RECOMMEND_CELL_CLASS);',
      '        cell.classList.add(AUTOMATION_RECOMMEND_CELL_CLASS);'+bindChartCell);
    source=source.replace('        cell.textContent = formatAutomationSignedDelta(settingLevel);',
      '        cell.textContent = formatAutomationSignedDelta(settingLevel);'+bindChartCell);
    const begin=source.indexOf('    function buildCombatSimulatorWorkerSource(');
    const end=source.indexOf('    function findRoomGridParent(',begin);
    source=source.slice(0,begin)+`
    function resetCombatSimulatorWorker(error) {
        rustCalculator.reset(error || new Error('Rust 引擎已重置'));
        combatEstimateCache.clear();
        combatSimulatorWorker = null;
        combatWorkerScriptPromise = null;
    }
    async function ensureCombatSimulatorWorker() {
        const client = await rustCalculator.ensure(getInitClientData());
        combatSimulatorWorker = client.worker;
        return client.worker;
    }
    async function simulateCombatRoomWithWorker(params, progressTracker) {
        await ensureCombatSimulatorWorker();
        let completed = 0;
        const trials = Math.max(1, Math.floor(Number(params.trials) || 1));
        const advance = ratio => {
            const next = Math.max(completed, Math.min(trials, Math.floor(ratio * trials)));
            if (progressTracker && next > completed) progressTracker.add(next - completed);
            completed = next;
        };
        const result = await rustCalculator.run(params, advance);
        advance(1);
        return result;
    }
`+source.slice(end);
    const note=mode==='embedded'?'匹配原版 1.5.14 的迷宫规则；战斗引擎内置。':'动态加载 wow121 上游引擎；怒气和初始技能冷却采用上游规则，结果可能不同。';
    source=source.replace('<button type="button" class="${CONTROL_CLASS}__button">${t("calcMaze")}</button>',
      `<span class="\${CONTROL_CLASS}__engine" title="${note}" style="font-size:11px;opacity:.75">${label}</span>\n<button type="button" class="\${CONTROL_CLASS}__button">\${t("calcMaze")}</button>`);
    // The embedded native engine does not report min/max durations; omit the old 0–0 debug range.
    source=source.replace('`t=${minElapsedSeconds.toFixed(2)}-${maxElapsedSeconds.toFixed(2)}s`,',
      '`compute=${finiteNumber(firstRunDebug?.elapsedMs, 0).toFixed(1)}ms`,\n                `engine=${firstRunDebug?.engineMode || "rust"}`,');
    const file=path.join(here,`../labyrinth-clear-rate-rust-${mode}.user.js`);
    fs.writeFileSync(file,source);paths[mode]=file;
    console.log(`Built ${file} (${Buffer.byteLength(source)} bytes)`);
  }
  return paths;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildCalculators();
