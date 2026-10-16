// Plot the existing production calculator's deterministic probabilities. Each
// integer room level is evaluated once; recommendation selection stays unchanged.
export async function createProductionChartData({effectiveLevel, targetChance, targetSeconds, recommendedLevel,
  minDelta = -300, maxDelta = 300, evaluate}) {
  const baseLevel = Math.floor(Math.max(0, effectiveLevel));
  const lo = Math.max(1, baseLevel + Math.floor(minDelta));
  const hi = Math.max(lo, baseLevel + Math.floor(maxDelta));
  const observations = [];
  for (let roomLevel = lo; roomLevel <= hi; roomLevel++) {
    const computed = await evaluate(roomLevel);
    const preview = computed?.result?.skillingPreview;
    if (!computed || !preview) throw new Error('生产计算未返回结果');
    const clearChance = computed.clearChance;
    if (!Number.isFinite(clearChance) || clearChance < 0 || clearChance > 1) throw new Error('生产胜率无效');
    const enhancing = preview.type === 'enhancing';
    const progressPerSuccess = enhancing ? null : preview.effectiveProgressPerSuccess;
    const targetProgress = enhancing ? null : roomLevel * 10;
    observations.push({id: observations.length + 1, roomLevel, clearChance, isLatest: true,
      expectedSecondsPerClear: computed.result.expectedSecondsPerClear,
      type: preview.type, successChance: preview.successChance, doubleChance: preview.doubleChance,
      attempts: preview.attempts, actionSeconds: preview.actionSeconds,
      progressPerSuccess, targetProgress,
      neededUnits: enhancing ? null : progressPerSuccess > 0 ? Math.ceil(targetProgress / progressPerSuccess - 1e-9) : Infinity,
      targetLevel: enhancing ? preview.targetLevel : null,
    });
  }
  return {kind: 'production', basis: targetSeconds === undefined ? 'winRate' : 'seconds',
    targetChance, targetSeconds, recommendedLevel, levelCount: observations.length,
    observations, curve: observations.map(({roomLevel, clearChance, expectedSecondsPerClear}) =>
      ({roomLevel, clearChance, expectedSecondsPerClear}))};
}

// Formula times may contain discrete reversals, so evaluate the existing full
// integer range instead of applying a random-sample monotone constraint.
export async function findProductionTimeRecommendation(params) {
  if (!(params.targetSeconds > 0) || !Number.isFinite(params.targetSeconds)) throw new Error('目标耗时无效');
  const results = new Map();
  const chart = await createProductionChartData({...params, evaluate: async level => {
    const computed = await params.evaluate(level);
    const seconds = computed?.result?.expectedSecondsPerClear;
    if (!(seconds > 0) || (seconds !== Infinity && !Number.isFinite(seconds))) throw new Error('生产预计耗时无效');
    results.set(level, computed);
    return computed;
  }});
  let best = null;
  for (const row of chart.observations) {
    const diff = Math.abs(row.expectedSecondsPerClear - params.targetSeconds);
    if (!best || diff < best.diff - 1e-12 ||
        (Number.isFinite(diff) && Math.abs(diff - best.diff) <= 1e-12 && row.roomLevel > best.roomLevel)) {
      best = {...results.get(row.roomLevel), roomLevel: row.roomLevel, diff};
    }
  }
  chart.recommendedLevel = best.roomLevel;
  return {...best, basis: 'seconds', levelDelta: best.roomLevel - Math.floor(Math.max(0, params.effectiveLevel)),
    recommendationChart: chart};
}
