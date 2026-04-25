import type { Deal, Ticket, KPISnapshot } from "@/types";

interface AlertInput {
  deals: Deal[];
  tickets: Ticket[];
  kpi?: KPISnapshot;
  targetRevenue?: number;
  targetCloseRate?: number;
}

interface GeneratedAlert {
  type: "critical" | "warning" | "opportunity";
  category: string;
  message: string;
  employee_id?: string;
  deal_id?: string;
  ticket_id?: string;
}

export function generateAlerts(input: AlertInput): GeneratedAlert[] {
  const { deals, tickets, kpi, targetRevenue, targetCloseRate = 35 } = input;
  const alerts: GeneratedAlert[] = [];

  const activeDeals = deals.filter((d) => d.stage !== "مكتملة" && d.stage !== "مرفوض مع سبب");

  // CRITICAL: Stale deal > 30 days in negotiation
  for (const deal of activeDeals) {
    if (deal.stage === "تفاوض" && deal.cycle_days > 30) {
      alerts.push({
        type: "critical",
        category: "stale_deal",
        message: `صفقة ${deal.client_name} ($${(deal.deal_value / 1000).toFixed(0)}K) في التفاوض من ${deal.cycle_days} يوم — تحتاج متابعة عاجلة`,
        deal_id: deal.id,
      });
    }
  }

  // CRITICAL: Revenue < 60% of target
  if (kpi && targetRevenue && kpi.total_revenue < targetRevenue * 0.6) {
    const gap = targetRevenue - kpi.total_revenue;
    alerts.push({
      type: "critical",
      category: "revenue_gap",
      message: `إيرادات الشهر أقل من 60% من الهدف — فجوة $${(gap / 1000).toFixed(0)}K`,
    });
  }

  // WARNING: Deal in same stage > 14 days
  for (const deal of activeDeals) {
    if (deal.cycle_days > 14 && deal.cycle_days <= 30) {
      alerts.push({
        type: "warning",
        category: "stale_deal",
        message: `صفقة ${deal.client_name} في مرحلة "${deal.stage}" من ${deal.cycle_days} يوم`,
        deal_id: deal.id,
      });
    }
  }

  // WARNING: Big deal (> $80K) stale > 20 days
  for (const deal of activeDeals) {
    if (deal.deal_value > 80000 && deal.cycle_days > 20) {
      alerts.push({
        type: "critical",
        category: "stale_deal",
        message: `صفقة كبيرة: ${deal.client_name} ($${(deal.deal_value / 1000).toFixed(0)}K) متأخرة ${deal.cycle_days} يوم`,
        deal_id: deal.id,
      });
    }
  }

  // WARNING: Urgent tickets open
  const urgentOpen = tickets.filter((t) => t.priority === "عاجل" && t.status !== "محلول");
  if (urgentOpen.length > 0) {
    alerts.push({
      type: "warning",
      category: "urgent_tickets",
      message: `${urgentOpen.length} تذاكر عاجلة مفتوحة تحتاج معالجة فورية`,
    });
  }

  // WARNING: Team close rate below target
  if (kpi && kpi.close_rate < targetCloseRate * 0.8) {
    alerts.push({
      type: "warning",
      category: "low_close_rate",
      message: `معدل الإغلاق ${(kpi.close_rate * 100).toFixed(0)}% — أقل من الهدف (${targetCloseRate}%)`,
    });
  }

  // OPPORTUNITY: Month above target
  if (kpi && targetRevenue && kpi.total_revenue >= targetRevenue) {
    alerts.push({
      type: "opportunity",
      category: "best_month",
      message: `إيرادات الشهر تجاوزت الهدف بـ $${((kpi.total_revenue - targetRevenue) / 1000).toFixed(0)}K! 🎯`,
    });
  }

  // OPPORTUNITY: Strong pipeline
  const pipelineValue = activeDeals.reduce(
    (sum, d) => sum + d.deal_value * (d.probability / 100),
    0
  );
  if (targetRevenue && pipelineValue > targetRevenue * 1.5) {
    alerts.push({
      type: "opportunity",
      category: "pipeline",
      message: `قيمة الفرص المتوقعة $${(pipelineValue / 1000).toFixed(0)}K — تتجاوز الهدف بـ 50%`,
    });
  }

  // Sort: critical first, then warning, then opportunity
  const priority = { critical: 0, warning: 1, opportunity: 2 };
  return alerts.sort((a, b) => priority[a.type] - priority[b.type]);
}
