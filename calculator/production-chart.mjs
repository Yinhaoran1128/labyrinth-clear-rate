// Plot the existing production calculator's deterministic probabilities. Each
// integer room level is evaluated once; recommendation selection stays unchanged.
export async function createProductionChartData({effectiveLevel, targetChance, recommendedLevel,
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
      type: preview.type, successChance: preview.successChance, doubleChance: preview.doubleChance,
      attempts: preview.attempts, actionSeconds: preview.actionSeconds,
      progressPerSuccess, targetProgress,
      neededUnits: enhancing ? null : progressPerSuccess > 0 ? Math.ceil(targetProgress / progressPerSuccess - 1e-9) : Infinity,
      targetLevel: enhancing ? preview.targetLevel : null,
    });
  }
  return {kind: 'production', targetChance, recommendedLevel, levelCount: observations.length,
    observations, curve: observations.map(({roomLevel, clearChance}) => ({roomLevel, clearChance}))};
}
