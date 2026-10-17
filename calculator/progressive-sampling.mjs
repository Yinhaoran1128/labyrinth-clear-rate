import {clearTimeInterval} from './clear-time-interval.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function batchSeed(key, startTrials) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  // An odd multiplier is one-to-one modulo 2^32: different batch starts for
  // this configuration get distinct, reproducible 32-bit seeds.
  return (hash + Math.imul(startTrials + 1, 0x9e3779b1)) >>> 0;
}

function validateBatch(row, trials) {
  if (row?.trials !== trials || row.completedTrials !== trials || row.statisticalTrials !== trials ||
      !['successes', 'failedByDeath', 'failedByTimeout'].every(key =>
        Number.isSafeInteger(row[key]) && row[key] >= 0) ||
      row.successes + row.failedByDeath + row.failedByTimeout !== trials) {
    throw new Error('累进采样批次未完成请求场数或计数无效');
  }
  if (!['totalSpentSeconds', 'durationSquaredSeconds', 'successSpentSeconds',
    'durationMeanSeconds', 'durationM2SecondsSquared'].every(key => Number.isFinite(row[key]) && row[key] >= 0) ||
      !Number.isFinite(row.durationSuccessComomentSeconds)) {
    throw new Error('累进采样批次缺少有效的耗时统计');
  }
}

function mergeBatches(previous, batch, seed) {
  const a = previous?.trials ?? 0, b = batch.trials, n = a + b;
  const result = {...batch};
  for (const key of ['successes', 'failedByDeath', 'failedByTimeout', 'totalSpentSeconds',
    'durationSquaredSeconds', 'successSpentSeconds', 'simulatedSeconds']) {
    result[key] = (previous?.[key] ?? 0) + (batch[key] ?? 0);
  }
  const deltaDuration = batch.durationMeanSeconds - (previous?.durationMeanSeconds ?? batch.durationMeanSeconds);
  const deltaSuccess = batch.successes / b - (a ? previous.successes / a : batch.successes / b);
  const weight = a * (b / n);
  // Chan's parallel form of Welford. Do not reconstruct centered moments by
  // subtracting raw moments: near-constant battle times lose their variance.
  result.durationMeanSeconds = a ? previous.durationMeanSeconds + deltaDuration * (b / n) : batch.durationMeanSeconds;
  result.durationM2SecondsSquared = (previous?.durationM2SecondsSquared ?? 0) + batch.durationM2SecondsSquared + deltaDuration ** 2 * weight;
  result.durationSuccessComomentSeconds = (previous?.durationSuccessComomentSeconds ?? 0) + batch.durationSuccessComomentSeconds + deltaDuration * deltaSuccess * weight;
  result.trials = result.completedTrials = result.statisticalTrials = n;
  result.failures = n - result.successes;
  result.terminalDeaths = result.failedByDeath;
  result.terminalTimeouts = result.failedByTimeout;
  result.minElapsedSeconds = a ? Math.min(previous.minElapsedSeconds, batch.minElapsedSeconds) : batch.minElapsedSeconds;
  result.maxElapsedSeconds = a ? Math.max(previous.maxElapsedSeconds, batch.maxElapsedSeconds) : batch.maxElapsedSeconds;
  result.clearChance = result.successes / n;
  result.expectedSecondsPerClear = result.completeExpectedSecondsPerClear = result.successes
    ? result.totalSpentSeconds / result.successes : Infinity;
  result.clearTimeInterval = clearTimeInterval(result);
  const oldDebug = previous?.firstRunDebug, debug = batch.firstRunDebug ?? {};
  const mergedDebug = {...debug, seed:oldDebug?.seed ?? seed,
    requestedTrials:n, completedTrials:n, completedTrialsRecorded:n, targetBattles:n,
    completedSeconds:result.totalSpentSeconds, fullCompletedSeconds:result.totalSpentSeconds,
    samplingMode:'progressive',
    batches:[...(oldDebug?.batches ?? []), {startTrials:a, trials:b, cumulativeTrials:n, seed, elapsedMs:debug.elapsedMs ?? 0}]};
  for (const key of ['elapsedMs', 'encounters', 'simulatedTime']) {
    mergedDebug[key] = (oldDebug?.[key] ?? 0) + (debug[key] ?? 0);
  }
  mergedDebug.lastEncounterFinishTime = batch.successes > 0
    ? (oldDebug?.simulatedTime ?? 0) + (debug.lastEncounterFinishTime ?? 0)
    : (oldDebug?.lastEncounterFinishTime ?? 0);
  mergedDebug.deaths = {...oldDebug?.deaths};
  for (const [key, count] of Object.entries(debug.deaths ?? {})) {
    mergedDebug.deaths[key] = (mergedDebug.deaths[key] ?? 0) + count;
  }
  result.firstRunDebug = mergedDebug;
  return result;
}

// Stores completed observations, never simulator state. Only a validated,
// successful batch commits; resetting the Worker invalidates in-flight work
// while keeping already committed observations available for the next run.
export function createProgressiveSampler({run, keyPrefix = ''}) {
  const samples = new Map(), pending = new Map();
  let generation = 0;
  function cancel() { generation++; pending.clear(); }
  async function ensure(params, onProgress) {
    const {trials:target, seed:_seed, ...config} = params;
    if (!Number.isSafeInteger(target) || target < 1) throw new Error('累计场数必须为正整数');
    const key = keyPrefix + '|' + JSON.stringify(canonical(config));
    const token = generation;
    const check = () => { if (token !== generation) throw new Error('累进采样已取消'); };
    for (;;) {
      check();
      if (pending.has(key)) { await pending.get(key); continue; }
      const existing = samples.get(key), start = existing?.trials ?? 0;
      const cumulativeTarget = Math.max(start, target);
      onProgress?.(start, cumulativeTarget);
      check();
      if (start >= target) return {...existing, sampleSource:'cache'};
      const trials = target - start, seed = batchSeed(key, start);
      const task = (async () => {
        const batch = await run({...config, trials, seed}, (done, requested) => {
          check();
          if (requested !== trials || !Number.isFinite(done) || done < 0 || done > trials)
            throw new Error('累进采样批次场数进度无效');
          onProgress?.(start + done, target);
        });
        check();
        validateBatch(batch, trials);
        const result = mergeBatches(existing, batch, seed);
        samples.set(key, result);
        return {...result, sampleSource:'full'};
      })();
      pending.set(key, task);
      try { return await task; }
      finally { if (pending.get(key) === task) pending.delete(key); }
    }
  }
  return {ensure, cancel};
}
