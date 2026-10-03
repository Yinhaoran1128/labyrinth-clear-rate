// Two-sided 95% Wilson score interval for a binomial proportion.
// n follows the calculator's actual statistical denominator. Continuous-battle
// dependence is not modeled: this is an independent-trial binomial approximation.
export function binomialWinRateInterval(p, n) {
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('胜率必须介于 0 和 1');
  if (!Number.isFinite(n) || n <= 0) throw new Error('统计次数必须大于 0');
  const z = 1.959963984540054;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const halfWidth = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return {lower: p === 0 ? 0 : Math.max(0, center - halfWidth),
    upper: p === 1 ? 1 : Math.min(1, center + halfWidth),
    confidenceLevel: .95, method: 'wilson'};
}

export function createRecommendationChartData({history, fit, targetChance, recommendedLevel}) {
  const lastByLevel = new Map(history.map(row => [row.roomLevel, row.id]));
  return {
    targetChance, recommendedLevel, levelCount: lastByLevel.size,
    observations: history.map(row => ({...row,
      isLatest: lastByLevel.get(row.roomLevel) === row.id,
      confidenceInterval: binomialWinRateInterval(row.clearChance, row.trials),
    })),
    curve: fit.map(row => ({roomLevel: row.roomLevel, fittedChance: row.fittedChance})),
  };
}
