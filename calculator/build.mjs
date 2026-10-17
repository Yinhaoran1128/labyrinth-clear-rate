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
  const controls=await compile('automation-controls.mjs',{globalName:'TimeControls'});
  const intervals=await compile('clear-time-interval.mjs',{globalName:'ClearTimeIntervals'});
  const stock=await stockEngine();
  const data=packed(JSON.stringify({fallbackData:fixtureGame().$e,originalMaps:stock.maps}));
  const wasm=fs.readFileSync(path.join(here,'../comparison/assets/mwi_engine.wasm'));
  const paths={};
  {
    const label='Rust 内置修正版';
    const model=`rust-completed-battles-v6-progressive-${sha(wasm)}`;
    const assets={worker,data,wasm:packed(wasm),hash:sha(wasm)};
    let source=original
      .replace(/\/\/ @name(?:\:zh-CN)?\s+迷宫胜率计算器/g,match=>match.replace('迷宫胜率计算器',`迷宫胜率计算器（${label}）`))
      .replace(/\/\/ @name:en[^\n]+/,'// @name:en      Labyrinth Calculator '+'Rust Embedded')
      .replace(/\/\/ @namespace[^\n]+/,`// @namespace    mwi-labyrinth-calculator-rust-embedded`)
      .replace(/\/\/ @version[^\n]+/,'// @version      1.8.2')
      .replace(/\/\/ @author[^\n]+/,'// @author       dakonglong; wow121; Yinhr (Rust adapter)')
      .replace(/\/\/ @description:zh-CN[^\n]+/,`// @description:zh-CN  原版迷宫界面与配装逻辑；${label}计算战斗胜率和预计通关耗时。`)
      .replace(/^\/\/ @(?:downloadURL|updateURL)[^\n]+\n/gm,'')
      .replace(/window\.__MWI_LAB_CLEAR_RATE_OVERLAY_VERSION__ = "[^"]+";/,`window.__MWI_LAB_CLEAR_RATE_OVERLAY_VERSION__ = "1.8.2-rust-embedded";`)
      .replace('const MAX_COMBAT_SIM_TRIALS = 2000;', 'const MAX_COMBAT_SIM_TRIALS = 3000;')
      .replace(/const COMBAT_MODEL_SIGNATURE = "[^"]+";/,`const COMBAT_MODEL_SIGNATURE = "${model}";`);
    const insert=source.indexOf('    const ROOM_DURATION_SECONDS =');
    source=source.slice(0,insert)+`\n${runtime}\n${recommendation}\n${production}\n${chart}\n${controls}\n${intervals}\n    let automationRecommendBasis = 'winRate';\n    const rustCalculator = CalculatorRuntime.create(${JSON.stringify(assets)});\n`+source.slice(insert);
    // Apply the new search only to combat; the pinned original remains unchanged.
    source=source.replace('    async function findAutomationRecommendedLevelDelta(params) {',`
    async function findAutomationRecommendedLevelDelta(params) {
        if (params.entry?.isCombat) {
            return CombatRecommendation.findCombatRecommendation({
                effectiveLevel: params.effectiveLevel,
                targetChance: params.targetChance,
                targetSeconds: params.targetSeconds,
                minDelta: AUTOMATION_RECOMMEND_MIN_DELTA,
                maxDelta: AUTOMATION_RECOMMEND_MAX_DELTA,
                evaluate: (roomLevel, budget) => computeAutomationEntryClearChanceByRoomLevel(
                    { ...params, recommendCombatTrials: budget }, roomLevel
                ),
            });
        }
        if (params.targetSeconds !== undefined) {
            return ProductionChart.findProductionTimeRecommendation({
                effectiveLevel: params.effectiveLevel, targetSeconds: params.targetSeconds,
                minDelta: AUTOMATION_RECOMMEND_MIN_DELTA, maxDelta: AUTOMATION_RECOMMEND_MAX_DELTA,
                evaluate: roomLevel => computeAutomationEntryClearChanceByRoomLevel(params, roomLevel),
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
    source=source.replace('async function runAutomationRecommendCalculation()',
      'async function runAutomationRecommendCalculation(basis = "winRate")');
    source=source.replace('automationEstimateRunningMode = "recommend";',
      'automationEstimateRunningMode = "recommend";\n        automationRecommendBasis = basis;');
    source=source.replace('const targetChance = clamp01(targetWinRate / 100);',
      'const targetChance = clamp01(targetWinRate / 100);\n            const targetSeconds = basis === "seconds" ? TimeControls.getTargetSeconds() : undefined;');
    source=source.replace('                        effectiveLevel,\n                        targetChance,',
      '                        effectiveLevel,\n                        targetChance,\n                        targetSeconds,');
    // Recommendation counts are cumulative. Bypass the old per-request cache;
    // the runtime owns samples keyed by the complete combat configuration.
    source=source.replace('{ includePersonalBuffs: false }\n              )\n            : computeRoomClearChance',
      '{ includePersonalBuffs: false, disableCache: true, progressive: true }\n              )\n            : computeRoomClearChance');
    source=source.replace('roomKey,\n                {\n                    labyrinthUpgradeLevels,',
      'roomKey,\n                {\n                    ...options,\n                    samplingSignature: playerSignature,\n                    labyrinthUpgradeLevels,');
    source=source.replace('                trials,\n            },\n            progressTracker',
      '                trials,\n                progressive: Boolean(options.progressive),\n                samplingSignature: options.samplingSignature,\n            },\n            progressTracker');
    source=source.replace('source: "full",\n                roomKey: String(roomKey || ""),',
      'source: workerResult.sampleSource || "full",\n                roomKey: String(roomKey || ""),');
    source=source.replace('source: "full",\n                roomKey: String(roomKey || result.combatMeta?.roomKey || ""),',
      'source: result.combatMeta?.source || "full",\n                roomKey: String(roomKey || result.combatMeta?.roomKey || ""),');
    source=source.replace('const cacheKey = `\${room.monsterHrid}|\${roomLevel}|trials=\${trials}|\${playerSignature}`;',
      'const cacheKey = options.progressive ? `\${room.monsterHrid}|\${roomLevel}|progressive|\${playerSignature}` : `\${room.monsterHrid}|\${roomLevel}|trials=\${trials}|\${playerSignature}`;');
    source=source.replace('const disableCache = Boolean(options && options.disableCache);',
      'const disableCache = Boolean(options && (options.disableCache || options.progressive));');
    source=source.replace('clearChance: clamp01(finiteNumber(match.clearChance, 0)),',`clearChance: clamp01(finiteNumber(match.clearChance, 0)),
                            basis: match.basis || 'winRate',
                            clearTimeInterval: match.result?.clearTimeInterval,
                            fittedSeconds: match.fittedSeconds,
                            expectedSecondsPerClear: match.result?.expectedSecondsPerClear,
                            fittedChance: match.fittedChance,
                            recommendationMethod: match.recommendationMethod,
                            recommendationChart: match.recommendationChart,`);
    source=source.replace('recommendDelta: "Recommend Level",',
      'recommendDelta: "Recommend by Win %",\n            recommendBySeconds: "Recommend by Time",\n            targetSeconds: "Target Time (s)",\n            targetSecondsHint: "Expected clear time including failed runs; recommends the closest fitted time",\n            fittedClearTime: "Fitted Clear Time",\n            simulatedClearTime: "Expected Clear Time",');
    source=source.replace('recommendDelta: "推荐等级",',
      'recommendDelta: "按胜率推荐",\n            recommendBySeconds: "按耗时推荐",\n            targetSeconds: "目标耗时(秒)",\n            targetSecondsHint: "含失败场次的预计通关耗时；推荐拟合耗时最接近目标的等级",\n            fittedClearTime: "拟合通关耗时",\n            simulatedClearTime: "预计通关耗时",');
    source=source.replace('.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS} {',
      '.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS}, .mwi-lab-auto-estimate-control__target-seconds-input {');
    source=source.replace('        return root;\n    }\n\n    function getAutomationEstimateTrialsInput()',
      `        TimeControls.sync(root, t, runAutomationRecommendCalculation, automationEstimateRunning,
            automationEstimateRunningMode === 'recommend' ? automationRecommendBasis : '');
        return root;
    }

    function getAutomationEstimateTrialsInput()`);
    source=source.replace('running && runningMode === "recommend" ? t("calculating") : t("recommendDelta")',
      'running && runningMode === "recommend" && automationRecommendBasis === "winRate" ? t("calculating") : t("recommendDelta")');
    source=source.replace('        if (text && typeof status.message === "string"',
      `        TimeControls.setRunning(root, t, Boolean(status.running),
            automationEstimateRunningMode === 'recommend' ? automationRecommendBasis : '');
        if (text && typeof status.message === "string"`);
    source=source.replace('return `crate=${crateSignature}|trials=${trials}|target=${target}`;',
      'return `crate=${crateSignature}|trials=${trials}|basis=${automationRecommendBasis}|target=${automationRecommendBasis === "seconds" ? TimeControls.getTargetSeconds() : target}`;');
    source=source.replace('recommendSettingLevel: "Recommend Setting Level",',
      'recommendSettingLevel: "Recommend Setting Level",\n            fittedWinRate: "Fitted Win Rate",\n            simulatedWinRate: "Simulated Win Rate",\n            winRateChart: "Chart",\n            winRateChartHint: "Click the recommended level to view the curve",');
    source=source.replace('recommendSettingLevel: "推荐设置等级",',
      'recommendSettingLevel: "推荐设置等级",\n            fittedWinRate: "拟合胜率",\n            simulatedWinRate: "模拟胜率",\n            winRateChart: "图表",\n            winRateChartHint: "点击推荐等级查看曲线",');
    source=source.replace('return `ready:${delta}:${roomLevel}:${chancePercent}`;',
      'return `ready:${delta}:${roomLevel}:${chancePercent}:${estimate.basis}:${estimate.fittedChance ?? ""}:${estimate.fittedSeconds ?? ""}`;');
    const tooltipLevel='        appendPreviewRow(tooltip, t("level"), `Lv.${Math.max(1, Math.floor(finiteNumber(estimate.roomLevel, 1)))}`);';
    source=source.replace(tooltipLevel,tooltipLevel+`
        if (estimate.basis === 'seconds') {
            if (estimate.isCombat) appendPreviewRow(tooltip, t("fittedClearTime"), TimeControls.formatSeconds(estimate.fittedSeconds));
            appendPreviewRow(tooltip, t("simulatedClearTime"), TimeControls.formatSeconds(estimate.expectedSecondsPerClear));
        } else if (estimate.isCombat && Number.isFinite(estimate.fittedChance)) {
            appendPreviewRow(tooltip, t("fittedWinRate"), (estimate.fittedChance * 100).toFixed(1) + "%");
            appendPreviewRow(tooltip, t("simulatedWinRate"), (estimate.clearChance * 100).toFixed(1) + "%");
        }
        if (estimate.isCombat && estimate.recommendationChart && estimate.clearTimeInterval)
            appendPreviewRow(tooltip, isChineseUi() ? "通关耗时近似95%置信区间" : "Clear time approx. 95% CI",
                ClearTimeIntervals.formatClearTimeInterval(estimate.clearTimeInterval, isChineseUi() ? "zh" : "en"));
        if (estimate.recommendationChart) appendPreviewRow(tooltip, t("winRateChart"), t("winRateChartHint"));`);
    const bindChartCell=`
        RecommendationChart.bindCell(cell, () => getAutomationRecommendFromCell(cell),
            () => isChineseUi() ? "zh" : "en", hidePreviewTooltip);`;
    source=source.replace('        cell.classList.add(AUTOMATION_RECOMMEND_CELL_CLASS);',
      '        cell.classList.add(AUTOMATION_RECOMMEND_CELL_CLASS);'+bindChartCell);
    source=source.replace('        cell.textContent = formatAutomationSignedDelta(settingLevel);',
      '        cell.textContent = formatAutomationSignedDelta(settingLevel);'+bindChartCell);
    // Keep busy/finished/error states, without calculation progress UI.
    source=source.replace(/<div class="\$\{CONTROL_CLASS\}__progress">\n[\s\S]*?\n<\/div>\n/, '');
    source=source.replace(/\.\$\{CONTROL_CLASS\}__(?:progress|track|bar|text) \{[^}]*\}\n/g, '');
    source=source.replace('        const bar = root.querySelector(`.${CONTROL_CLASS}__bar`);\n', '');
    source=source.replace(/        if \(bar && Object\.prototype\.hasOwnProperty\.call\(status, "ratio"\)\) \{[\s\S]*?\n        \}\n/, '');
    source=source.replaceAll('t("calculatingProgressFmt", { current: i + 1, total: entries.length })', 't("calculating")');
    source=source.replace(/t\("roomDistributionCalculatingFmt", \{\s*current: [^,]+,\s*total: [^,}]+,?\s*\}\)/g, 't("calculating")');
    source=source.replace('const CONTROL_SCHEMA_VERSION = "7";', 'const CONTROL_SCHEMA_VERSION = "8";');
    source=source.replace('Combat Trials', 'Completed Battles per Room').replace('战斗次数', '每房间完成战斗场数');
    source=source.replace('            expectedSecondsPerClear,\n            combatMeta: {',
      '            expectedSecondsPerClear,\n            clearTimeInterval: workerResult.clearTimeInterval,\n            combatMeta: {');
    source=source.replace('                            expectedSeconds,\n                            etaText,',
      '                            expectedSeconds,\n                            clearTimeInterval: result.clearTimeInterval,\n                            etaText,');
    const begin=source.indexOf('    async function fetchCombatWorkerChunkText(');
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
        let targetTrials = trials;
        const advance = (done, target) => {
            if (params.progressive ? target < trials : target !== trials) throw new Error("Rust 场数进度目标不一致");
            targetTrials = target;
            const next = Math.max(completed, Math.min(target, Math.floor(done)));
            if (progressTracker && next > completed) progressTracker.add(next - completed);
            completed = next;
        };
        const result = await (params.progressive ? rustCalculator.runProgressive(params, advance) : rustCalculator.run(params, advance));
        if (completed !== targetTrials || result.completedTrials !== targetTrials) throw new Error("Rust 未完成请求场数");
        return result;
    }
`+source.slice(end);
    const note='匹配原版 1.5.14 的迷宫规则；内置 Rust/WASM 按实际完成场数运行，每场严格 120 秒截止。';
    source=source.replace('<button type="button" class="${CONTROL_CLASS}__button">${t("calcMaze")}</button>',
      `<span class="\${CONTROL_CLASS}__engine" title="${note}" style="font-size:11px;opacity:.75">${label}</span>\n<button type="button" class="\${CONTROL_CLASS}__button">\${t("calcMaze")}</button>`);
    // Simultaneous death is success only; the denominator is completed battles.
    source=source.replace('const clearChance = executedTrials > 0 ? clamp01(successes / executedTrials) : 0;',
      'const statisticalTrials = executedTrials;\n        const clearChance = statisticalTrials > 0 ? clamp01(successes / statisticalTrials) : 0;');
    source=source.replace('const totalFailures = Math.max(0, executedTrials - successes);',
      'const totalFailures = Math.max(0, statisticalTrials - successes);');
    source=source.replace('trials: executedTrials,', `trials: executedTrials,
                completedTrials: executedTrials,
                clearTimeInterval: workerResult.clearTimeInterval,
                statisticalTrials,
                terminalDeaths: workerResult.terminalDeaths,
                terminalTimeouts: workerResult.terminalTimeouts,
                durationSquaredSeconds: workerResult.durationSquaredSeconds,
                successSpentSeconds: workerResult.successSpentSeconds,
                durationMeanSeconds: workerResult.durationMeanSeconds,
                durationM2SecondsSquared: workerResult.durationM2SecondsSquared,
                durationSuccessComomentSeconds: workerResult.durationSuccessComomentSeconds,`);
    source=source.replace('Combat Sim Trials', 'Completed Battles per Room')
      .replace('战斗模拟次数', '每房间完成战斗场数')
      .replace('战斗固定使用 {trials} 次模拟', '战斗固定完成 {trials} 场')
      .replace('Combat uses {trials} fixed trials', 'Combat completes {trials} battles');
    source=source.replace(/^    const COMBAT_SIM_(?:CHUNK_CACHE_BUST|VENDOR_CHUNK_URL|WORKER_CHUNK_URL) = .*;\n/gm, '');
    // Report wall-clock compute time alongside actual simulated battle duration.
    source=source.replace('`t=${minElapsedSeconds.toFixed(2)}-${maxElapsedSeconds.toFixed(2)}s`,',
      '`compute=${finiteNumber(firstRunDebug?.elapsedMs, 0).toFixed(1)}ms`,\n                `engine=${firstRunDebug?.engineMode || "rust"}`,');
    const file=path.join(here,`../labyrinth-clear-rate-rust-embedded.user.js`);
    fs.writeFileSync(file,source);paths.embedded=file;
    console.log(`Built ${file} (${Buffer.byteLength(source)} bytes)`);
  }
  return paths;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildCalculators();
