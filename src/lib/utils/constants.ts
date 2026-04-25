export const STAGES = ["تواصل", "تفاوض", "تجهيز", "انتظار الدفع", "مكتملة", "تاجيل", "اعادة الاتصال في وقت اخر", "تجريبي", "مرفوض مع سبب"] as const;
export const SOURCES = ["حملة اعلانية", "تسويق بالعمولة", "جديد لعميل حالي", "فرع جديد لعميل حالي", "من طرف عميل", "من الدعم", "من ارقام عشوائية", "محول من الدعم", "تسجيل من الويب", "من المبيعات", "اخرى"] as const;
export const PLANS = ["الاساسية", "VIP", "بلس", "الكاشير", "الذهبية"] as const;
export const PRIORITIES = ["عاجل", "مرتفع", "عادي"] as const;
export const TICKET_STATUSES = ["مفتوح", "قيد الحل", "محلول", "متأخر"] as const;
export const EMPLOYEE_STATUSES = ["نشط", "مشغول", "متاح", "إجازة"] as const;
export const PARTNERSHIP_TYPES = ["استراتيجية", "تقنية", "تجارية", "تسويقية"] as const;
export const PARTNERSHIP_STATUSES = ["شراكة نشطة", "قيد التفاوض", "شراكة مؤجلة", "شراكة مُوقفة"] as const;
export const PROJECT_STATUSES = ["في الموعد", "متأخر", "يكتمل قريباً", "موقوف", "مكتمل"] as const;
export const REVIEW_CATEGORIES = ["الدعم", "المنتج", "التسعير", "الأداء", "التكامل", "التدريب", "أخرى"] as const;
export const REVIEW_TYPES = [
  { value: "very_satisfied", label: "راضي جداً" },
  { value: "satisfied", label: "راضي" },
  { value: "neutral", label: "متوسط" },
  { value: "needs_improvement", label: "يحتاج تطوير" },
  { value: "unsatisfied", label: "غير راضي" },
] as const;

export const RENEWAL_STATUSES = ["مجدول", "جاري المتابعة", "انتظار الدفع", "مكتمل", "ملغي بسبب", "إيقاف مؤقت", "الرقم غلط", "مافي تجاوب", "مؤجل مؤقتاً", "تواصل وقت آخر", "متردد"] as const;
export const RENEWAL_STATUS_COLORS: Record<string, string> = {
  "مجدول": "cc-blue",
  "جاري المتابعة": "amber",
  "انتظار الدفع": "cc-purple",
  "مكتمل": "cc-green",
  "ملغي بسبب": "cc-red",
  "إيقاف مؤقت": "amber",
  "الرقم غلط": "cc-red",
  "مافي تجاوب": "cc-red",
  "مؤجل مؤقتاً": "cc-blue",
  "تواصل وقت آخر": "cc-purple",
  "متردد": "amber",
};
export const RENEWAL_CANCEL_REASONS = [
  "ارتفاع السعر", "قلة الاستخدام", "التحوّل لمنافس",
  "نقص ميزات", "مشكلات تقنية", "اغلاق المحل", "أخرى",
] as const;

export const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
] as const;

export const STAGE_COLORS: Record<string, string> = {
  "تواصل": "cc-green",
  "تفاوض": "cc-purple",
  "تجهيز": "cyan",
  "انتظار الدفع": "amber",
  "مكتملة": "cc-green",
  "تاجيل": "cc-blue",
  "اعادة الاتصال في وقت اخر": "amber",
  "تجريبي": "cc-purple",
  "مرفوض مع سبب": "cc-red",
};

export const PRIORITY_COLORS: Record<string, string> = {
  "عاجل": "cc-red",
  "مرتفع": "amber",
  "عادي": "cc-blue",
};

export const TICKET_STATUS_COLORS: Record<string, string> = {
  "مفتوح": "cc-red",
  "قيد الحل": "amber",
  "محلول": "cc-green",
  "متأخر": "cc-red",
};

export const SOURCE_COLORS: Record<string, string> = {
  "حملة اعلانية": "cyan",
  "تسويق بالعمولة": "cc-purple",
  "جديد لعميل حالي": "cc-green",
  "فرع جديد لعميل حالي": "cc-green",
  "من طرف عميل": "pink",
  "من الدعم": "amber",
  "من ارقام عشوائية": "cc-blue",
  "محول من الدعم": "amber",
  "تسجيل من الويب": "cc-green",
  "من المبيعات": "pink",
  "اخرى": "muted-foreground",
};

export const KPI_TARGETS = {
  win_rate: 35,
  demo_conversion: 60,
  avg_cycle_days: 14,
  new_clients_month: 20,
  renewal_rate: 75,
  churn_max: 15,
  csat: 4.0,
  nps: 40,
  avg_deal_value: 45000,
  pipeline_value: 500000,
  response_time_minutes: 5,
} as const;

export function getKpiStatus(actual: number, target: number, inverted = false): "excellent" | "improving" | "behind" {
  const ratio = inverted ? target / actual : actual / target;
  if (ratio >= 1) return "excellent";
  if (ratio >= 0.7) return "improving";
  return "behind";
}

export const KPI_STATUS_STYLES = {
  excellent: { bg: "bg-cc-green/15", text: "text-cc-green", dot: "bg-cc-green", label: "ممتاز" },
  improving: { bg: "bg-amber/15", text: "text-amber", dot: "bg-amber", label: "تحسين" },
  behind: { bg: "bg-cc-red/15", text: "text-cc-red", dot: "bg-cc-red", label: "متأخر" },
} as const;

// ─── Sales Performance Guide Constants ──────────────────────────────────────

export const ACTIVITY_TYPES = [
  { value: "call", label: "مكالمة هاتفية", icon: "📞" },
  { value: "demo", label: "Demo", icon: "🖥" },
  { value: "followup", label: "متابعة", icon: "🔁" },
  { value: "meeting", label: "اجتماع", icon: "🤝" },
  { value: "quote", label: "عرض سعر", icon: "📄" },
  { value: "whatsapp", label: "واتساب", icon: "💬" },
] as const;

export const ACTIVITY_RESULTS = [
  { value: "positive", label: "إيجابي", color: "cc-green" },
  { value: "pending", label: "معلق", color: "amber" },
  { value: "no_answer", label: "لا رد", color: "cc-blue" },
  { value: "negative", label: "سلبي", color: "cc-red" },
] as const;

export const SCORE_LEVELS = [
  { value: "excellent", label: "ممتاز", emoji: "🏆", minPoints: 250, color: "cc-green" },
  { value: "advanced", label: "متقدم", emoji: "🥇", minPoints: 180, color: "cyan" },
  { value: "good", label: "جيد", emoji: "🥈", minPoints: 120, color: "amber" },
  { value: "needs_improvement", label: "يحتاج تحسين", emoji: "🥉", minPoints: 60, color: "cc-purple" },
  { value: "danger", label: "خطر", emoji: "🔴", minPoints: 0, color: "cc-red" },
] as const;

export const ACTIVITY_POINTS: Record<string, number> = {
  call: 10,
  followup: 10,
  whatsapp: 10,
  meeting: 10,
  demo: 20,
  quote: 10,
  deal_closed: 50,
  stale_deal: -10,
  slow_response: -5,
};

export const PIP_STATUSES = [
  { value: "active", label: "نشط", color: "amber" },
  { value: "completed", label: "مكتمل", color: "cc-green" },
  { value: "failed", label: "فشل", color: "cc-red" },
  { value: "cancelled", label: "ملغي", color: "cc-blue" },
] as const;

export const PIPELINE_STAGES_GUIDE = [
  { stage: "Lead جديد", probability: 0, color: "cc-blue" },
  { stage: "تواصل أولي", probability: 15, color: "cyan" },
  { stage: "عرض سعر", probability: 40, color: "amber" },
  { stage: "تفاوض", probability: 70, color: "cc-purple" },
  { stage: "إغلاق", probability: 90, color: "cc-green" },
] as const;

export const NAV_ITEMS = [
  { label: "نظرة عامة", href: "/dashboard", icon: "LayoutDashboard" },
  { label: "المبيعات", href: "/sales", icon: "TrendingUp" },
  { label: "دليل المبيعات", href: "/sales-guide", icon: "BookOpen" },
  { label: "التجديدات", href: "/renewals", icon: "RefreshCw" },
  { label: "رضا العملاء", href: "/satisfaction", icon: "Heart" },
  { label: "الدعم", href: "/support", icon: "Headphones" },
  { label: "التطويرات", href: "/development", icon: "Code" },
  { label: "الشراكات", href: "/partnerships", icon: "Handshake" },
  { label: "المسوقين", href: "/marketers", icon: "Megaphone" },
  { label: "الفريق", href: "/team", icon: "Users" },
  { label: "المالية", href: "/finance", icon: "Banknote" },
] as const;
