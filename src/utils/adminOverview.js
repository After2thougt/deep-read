export function getAccountDistribution(stats) {
  if (stats.totalUsers === 0) {
    return { activePercent: 0, disabledPercent: 0 };
  }

  return {
    activePercent: stats.activeUsers / stats.totalUsers * 100,
    disabledPercent: stats.disabledUsers / stats.totalUsers * 100,
  };
}
