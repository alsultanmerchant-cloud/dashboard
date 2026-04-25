interface ScoreInput {
  actual_revenue: number;
  target_revenue: number;
  actual_close_rate: number;
  target_close_rate: number;
  actual_deals: number;
  target_deals: number;
  actual_cycle_days: number;
  target_cycle_days: number;
  monthly_revenues: number[];
}

interface ScoreResult {
  overall_score: number;
  close_rate_score: number;
  revenue_score: number;
  deal_count_score: number;
  cycle_speed_score: number;
  consistency_score: number;
}

export function computePerformanceScore(input: ScoreInput): ScoreResult {
  // Weight: Close Rate 30%, Revenue 25%, Deals 20%, Speed 15%, Consistency 10%
  const closeRateScore =
    Math.min(1.2, input.target_close_rate > 0 ? input.actual_close_rate / input.target_close_rate : 0) * 30;
  const revenueScore =
    Math.min(1.2, input.target_revenue > 0 ? input.actual_revenue / input.target_revenue : 0) * 25;
  const dealCountScore =
    Math.min(1.2, input.target_deals > 0 ? input.actual_deals / input.target_deals : 0) * 20;
  const speedScore =
    Math.min(1.2, input.actual_cycle_days > 0 ? input.target_cycle_days / input.actual_cycle_days : 0) * 15;

  // Consistency: lower coefficient of variation = higher score
  let consistencyScore = 0;
  if (input.monthly_revenues.length > 0) {
    const mean =
      input.monthly_revenues.reduce((a, b) => a + b, 0) / input.monthly_revenues.length;
    if (mean > 0) {
      const stdDev = Math.sqrt(
        input.monthly_revenues.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
          input.monthly_revenues.length
      );
      const cv = stdDev / mean;
      consistencyScore = Math.max(0, 1 - cv) * 10;
    }
  }

  const overall = Math.min(
    100,
    Math.round(closeRateScore + revenueScore + dealCountScore + speedScore + consistencyScore)
  );

  return {
    overall_score: overall,
    close_rate_score: Math.round(closeRateScore * 10) / 10,
    revenue_score: Math.round(revenueScore * 10) / 10,
    deal_count_score: Math.round(dealCountScore * 10) / 10,
    cycle_speed_score: Math.round(speedScore * 10) / 10,
    consistency_score: Math.round(consistencyScore * 10) / 10,
  };
}
