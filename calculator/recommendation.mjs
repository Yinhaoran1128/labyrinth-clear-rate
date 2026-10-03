import {createRecommendationChartData} from './chart-data.mjs';

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

// evaluate(roomLevel, budget) performs a complete continuous-battle run. A longer
// run replaces its shorter predecessor; replayed/prefix observations are never
// added together as if they were independent new battles.
export async function findCombatRecommendation({effectiveLevel, targetChance,
  minDelta = -300, maxDelta = 300, evaluate}) {
  if (!Number.isFinite(effectiveLevel) || !Number.isFinite(targetChance) ||
      targetChance < 0 || targetChance > 1) throw new Error('战斗推荐参数无效');
  const baseLevel = Math.floor(Math.max(0, effectiveLevel));
  const minLevel = Math.max(1, baseLevel + minDelta);
  const maxLevel = Math.max(minLevel, baseLevel + maxDelta);
  const samples = new Map();
  const history = [];
  const fit = () => fitDecreasingWinRates([...samples.values()]);
  const nearest = () => selectNearestFittedSample(fit(), targetChance);
  const sampleAt = async (rawLevel, budget) => {
    const roomLevel = Math.max(minLevel, Math.min(maxLevel, Math.round(rawLevel)));
    const existing = samples.get(roomLevel);
    if (existing?.budget >= budget) return existing;
    const computed = await evaluate(roomLevel, budget);
    if (!computed) throw new Error('战斗推荐模拟未返回结果');
    const sample = {...computed, roomLevel, levelDelta: roomLevel - baseLevel, budget};
    // Validate at the boundary, including zero/invalid actual sample counts.
    fitDecreasingWinRates([sample]);
    samples.set(roomLevel, sample);
    history.push({id: history.length + 1, roomLevel, levelDelta: sample.levelDelta, budget,
      clearChance: sample.clearChance, trials: sample.result.combatMeta.trials,
      successes: sample.result.combatMeta.successes,
      seed: sample.result.combatMeta.firstRunDebug?.seed,
    });
    return sample;
  };

  // Expand outward, then interpolate inside the fitted crossing. Unlike binary
  // search on individual random outcomes, every decision uses all sampled levels.
  const locateCrossing = async (budget, crossingChance = targetChance) => {
    let stepDown = 8, stepUp = 8;
    for (let probe = 0; probe < 40; probe++) {
      const rows = fit(), first = rows[0], last = rows.at(-1);
      if (first.fittedChance < crossingChance - 1e-12) {
        if (first.roomLevel === minLevel) break;
        await sampleAt(first.roomLevel - stepDown, budget);
        stepDown = Math.min(96, stepDown * 2);
      } else if (last.fittedChance >= crossingChance - 1e-12) {
        if (last.roomLevel === maxLevel) break;
        await sampleAt(last.roomLevel + stepUp, budget);
        stepUp = Math.min(96, stepUp * 2);
      } else {
        const index = rows.findIndex(row => row.fittedChance < crossingChance - 1e-12);
        const low = rows[index - 1], high = rows[index];
        if (high.roomLevel - low.roomLevel <= 1) break;
        const ratio = (low.fittedChance - crossingChance) / (low.fittedChance - high.fittedChance);
        const predicted = Math.round(low.roomLevel + ratio * (high.roomLevel - low.roomLevel));
        // Safeguard interpolation: long exact-target plateaus otherwise move
        // only one level per probe. Always shrink the bracket by at least 1/4.
        const margin = Math.max(1, Math.floor((high.roomLevel - low.roomLevel) / 4));
        await sampleAt(Math.max(low.roomLevel + margin, Math.min(high.roomLevel - margin, predicted)), budget);
      }
    }
  };

  await sampleAt(baseLevel, 30);
  await locateCrossing(30);
  for (const budget of [100, 300, 1000]) {
    // Refit and relocate after verification; a noisy coarse sample must not
    // permanently restrict the search to its original bracket.
    for (let round = 0; round < 4; round++) {
      const before = nearest();
      for (let offset = -2; offset <= 2; offset++) await sampleAt(before.roomLevel + offset, budget);
      await locateCrossing(budget);
      // If the closest probability is below target, it may form a long plateau
      // after the target crossing. Locate its high edge too, to honor higher-level ties.
      const finalist = nearest();
      if (finalist.fittedChance < targetChance - 1e-12) {
        await locateCrossing(budget, finalist.fittedChance);
      }
      const after = nearest();
      if (after.roomLevel === before.roomLevel) break;
    }
  }
  // Refitting can promote a previously coarse sample. Verify every promoted
  // finalist until the returned recommendation itself has the final budget.
  let best = nearest();
  while (best.budget < 1000) {
    await sampleAt(best.roomLevel, 1000);
    best = nearest();
  }
  return {...best, recommendationMethod: 'weighted-isotonic',
    sampledLevels: samples.size, displayChancePercent: best.fittedChance * 100,
    recommendationChart: createRecommendationChartData({history, fit: fit(),
      targetChance, recommendedLevel: best.roomLevel}),
  };
}
