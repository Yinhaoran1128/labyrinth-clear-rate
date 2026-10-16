import {createRecommendationChartData} from './chart-data.mjs';

const SIMULATION_BUDGETS = [300, 1000, 3000];

// Weighted pool-adjacent-violators (PAVA), constrained to decreasing win rates.
// The weight uses the calculator's actual statistical denominator, not its
// requested 120-second simulation budget. This is smoothing, not a confidence interval.
export function fitDecreasingWinRates(samples) {
  const rows = samples.map(sample => ({...sample})).sort((a, b) => a.roomLevel - b.roomLevel);
  const blocks = [];
  for (const [index, row] of rows.entries()) {
    const weight = Number(row.result?.combatMeta?.trials);
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(row.clearChance) ||
        row.clearChance < 0 || row.clearChance > 1) {
      throw new Error('战斗推荐缺少有效的实际场次数或胜率');
    }
    blocks.push({start: index, end: index, weight, wins: row.clearChance * weight});
    while (blocks.length > 1) {
      const right = blocks.at(-1), left = blocks.at(-2);
      if (left.wins / left.weight >= right.wins / right.weight) break;
      blocks.splice(-2, 2, {start: left.start, end: right.end,
        weight: left.weight + right.weight, wins: left.wins + right.wins});
    }
  }
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) rows[i].fittedChance = block.wins / block.weight;
  }
  return rows;
}

export function selectNearestFittedSample(rows, targetChance) {
  let best = null;
  for (const row of rows) {
    const diff = Math.abs(row.fittedChance - targetChance);
    if (!best || diff < best.diff - 1e-12 ||
        (Math.abs(diff - best.diff) <= 1e-12 && row.roomLevel > best.roomLevel)) {
      best = {...row, diff};
    }
  }
  return best;
}

export function fitIncreasingClearSeconds(samples) {
  const rows = samples.map(row => ({...row})).sort((a, b) => a.roomLevel - b.roomLevel);
  const blocks = [];
  for (const [index, row] of rows.entries()) {
    const weight = Number(row.result?.combatMeta?.trials);
    const seconds = row.result?.expectedSecondsPerClear;
    if (!(weight > 0) || !Number.isFinite(weight) ||
        !(seconds > 0) || (seconds !== Infinity && !Number.isFinite(seconds))) {
      throw new Error('战斗推荐缺少有效的实际场次数或预计耗时');
    }
    blocks.push({start: index, end: index, weight, total: seconds * weight});
    while (blocks.length > 1) {
      const right = blocks.at(-1), left = blocks.at(-2);
      if (left.total / left.weight <= right.total / right.weight) break;
      blocks.splice(-2, 2, {start: left.start, end: right.end,
        weight: left.weight + right.weight, total: left.total + right.total});
    }
  }
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) rows[i].fittedSeconds = block.total / block.weight;
  }
  return rows;
}

// evaluate(roomLevel, budget) performs a complete continuous-battle run. A longer
// run replaces its shorter predecessor; replayed/prefix observations are never
// added together as if they were independent new battles.
export async function findCombatRecommendation({effectiveLevel, targetChance, targetSeconds,
  minDelta = -300, maxDelta = 300, evaluate}) {
  const timeMode = targetSeconds !== undefined;
  if (!Number.isFinite(effectiveLevel) || (timeMode
      ? !Number.isFinite(targetSeconds) || targetSeconds <= 0
      : !Number.isFinite(targetChance) || targetChance < 0 || targetChance > 1)) throw new Error('战斗推荐参数无效');
  const baseLevel = Math.floor(Math.max(0, effectiveLevel));
  const minLevel = Math.max(1, baseLevel + minDelta);
  const maxLevel = Math.max(minLevel, baseLevel + maxDelta);
  const samples = new Map();
  const history = [];
  const fitSamples = timeMode ? fitIncreasingClearSeconds : fitDecreasingWinRates;
  const fit = () => fitSamples([...samples.values()]);
  // Use a decreasing score in either mode so expansion, interpolation and
  // progressive verification share exactly the same search.
  const score = row => timeMode ? -row.fittedSeconds : row.fittedChance;
  const targetScore = timeMode ? -targetSeconds : targetChance;
  const nearest = () => {
    if (!timeMode) return selectNearestFittedSample(fit(), targetChance);
    let best = null;
    for (const row of fit()) {
      const diff = Math.abs(score(row) - targetScore);
      if (!best || diff < best.diff - 1e-12 ||
          (Number.isFinite(diff) && Math.abs(diff - best.diff) <= 1e-12 && row.roomLevel > best.roomLevel)) {
        best = {...row, diff};
      }
    }
    // If every sample has zero clears, retain the lowest level and Infinity,
    // rather than recommending the hardest level as if an infinite tie were evidence.
    return best;
  };
  const sampleAt = async (rawLevel, budget) => {
    const roomLevel = Math.max(minLevel, Math.min(maxLevel, Math.round(rawLevel)));
    const existing = samples.get(roomLevel);
    if (existing?.budget >= budget) return existing;
    const computed = await evaluate(roomLevel, budget);
    if (!computed) throw new Error('战斗推荐模拟未返回结果');
    const sample = {...computed, roomLevel, levelDelta: roomLevel - baseLevel, budget};
    // Validate at the boundary, including zero/invalid actual sample counts.
    fitSamples([sample]);
    samples.set(roomLevel, sample);
    history.push({id: history.length + 1, roomLevel, levelDelta: sample.levelDelta, budget,
      clearChance: sample.clearChance, trials: sample.result.combatMeta.trials,
      successes: sample.result.combatMeta.successes,
      expectedSecondsPerClear: sample.result.expectedSecondsPerClear,
      seed: sample.result.combatMeta.firstRunDebug?.seed,
    });
    return sample;
  };

  // Expand outward, then interpolate inside the fitted crossing. Unlike binary
  // search on individual random outcomes, every decision uses all sampled levels.
  const locateCrossing = async (budget, crossingChance = targetScore) => {
    let stepDown = 8, stepUp = 8;
    for (let probe = 0; probe < 40; probe++) {
      const rows = fit(), first = rows[0], last = rows.at(-1);
      if (score(first) < crossingChance - 1e-12) {
        if (first.roomLevel === minLevel) break;
        await sampleAt(first.roomLevel - stepDown, budget);
        stepDown = Math.min(96, stepDown * 2);
      } else if (score(last) >= crossingChance - 1e-12) {
        if (last.roomLevel === maxLevel) break;
        await sampleAt(last.roomLevel + stepUp, budget);
        stepUp = Math.min(96, stepUp * 2);
      } else {
        const index = rows.findIndex(row => score(row) < crossingChance - 1e-12);
        const low = rows[index - 1], high = rows[index];
        if (high.roomLevel - low.roomLevel <= 1) break;
        const ratio = (score(low) - crossingChance) / (score(low) - score(high));
        const predicted = Math.round(low.roomLevel + ratio * (high.roomLevel - low.roomLevel));
        // Safeguard interpolation: long exact-target plateaus otherwise move
        // only one level per probe. Always shrink the bracket by at least 1/4.
        const margin = Math.max(1, Math.floor((high.roomLevel - low.roomLevel) / 4));
        await sampleAt(Math.max(low.roomLevel + margin, Math.min(high.roomLevel - margin, predicted)), budget);
      }
    }
  };

  await sampleAt(baseLevel, SIMULATION_BUDGETS[0]);
  await locateCrossing(SIMULATION_BUDGETS[0]);
  for (const budget of SIMULATION_BUDGETS.slice(1)) {
    // Refit and relocate after verification; a noisy coarse sample must not
    // permanently restrict the search to its original bracket.
    for (let round = 0; round < 4; round++) {
      const before = nearest();
      for (let offset = -2; offset <= 2; offset++) await sampleAt(before.roomLevel + offset, budget);
      await locateCrossing(budget);
      // If the closest probability is below target, it may form a long plateau
      // after the target crossing. Locate its high edge too, to honor higher-level ties.
      const finalist = nearest();
      if (Number.isFinite(score(finalist)) && score(finalist) < targetScore - 1e-12) {
        await locateCrossing(budget, score(finalist));
      }
      const after = nearest();
      if (after.roomLevel === before.roomLevel) break;
    }
  }
  // Refitting can promote a previously coarse sample. Verify every promoted
  // finalist until the returned recommendation itself has the final budget.
  let best = nearest();
  const finalBudget = SIMULATION_BUDGETS.at(-1);
  while (best.budget < finalBudget) {
    await sampleAt(best.roomLevel, finalBudget);
    best = nearest();
  }
  return {...best, recommendationMethod: 'weighted-isotonic',
    basis: timeMode ? 'seconds' : 'winRate',
    sampledLevels: samples.size, displayChancePercent: (best.fittedChance ?? best.clearChance) * 100,
    recommendationChart: createRecommendationChartData({history, fit: fit(),
      targetChance, targetSeconds, recommendedLevel: best.roomLevel}),
  };
}
