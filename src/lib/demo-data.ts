import type { Deal, Ticket, Employee, Project, Partnership } from "@/types";

// Demo data used until Supabase is connected
export const DEMO_EMPLOYEES: Employee[] = [
  { id: "1", org_id: "1", name: "سارة الأحمدي", role: "مديرة مبيعات", status: "نشط", created_at: "" },
  { id: "2", org_id: "1", name: "محمد العمري", role: "مدير حسابات", status: "مشغول", created_at: "" },
  { id: "3", org_id: "1", name: "لينا الشهري", role: "أخصائية مبيعات", status: "نشط", created_at: "" },
  { id: "4", org_id: "1", name: "أحمد القحطاني", role: "مطور رئيسي", status: "متاح", created_at: "" },
  { id: "5", org_id: "1", name: "نورة المالكي", role: "مهندسة دعم", status: "نشط", created_at: "" },
  { id: "6", org_id: "1", name: "خالد الزهراني", role: "مصمم UI/UX", status: "إجازة", created_at: "" },
];

export const DEMO_DEALS: Deal[] = [
  { id: "d1", org_id: "1", client_name: "خالد العتيبي", client_phone: "0551234567", deal_value: 48000, source: "حملة اعلانية", stage: "مكتملة", probability: 100, assigned_rep_name: "سارة الأحمدي", cycle_days: 14, deal_date: "2025-03-01", plan: "VIP", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "d2", org_id: "1", client_name: "سارة الغامدي", client_phone: "0559876543", deal_value: 65000, source: "من طرف عميل", stage: "انتظار الدفع", probability: 85, assigned_rep_name: "محمد العمري", cycle_days: 7, deal_date: "2025-03-05", plan: "الذهبية", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "d3", org_id: "1", client_name: "فهد المالكي", client_phone: "0554443322", deal_value: 92000, source: "جديد لعميل حالي", stage: "تجهيز", probability: 90, assigned_rep_name: "لينا الشهري", cycle_days: 21, deal_date: "2025-03-02", plan: "الذهبية", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "d4", org_id: "1", client_name: "نورا الشهراني", client_phone: "0551112233", deal_value: 120000, source: "تسويق بالعمولة", stage: "تفاوض", probability: 60, assigned_rep_name: "أحمد القحطاني", cycle_days: 3, deal_date: "2025-03-10", plan: "بلس", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "d5", org_id: "1", client_name: "محمد الزهراني", client_phone: "0557778899", deal_value: 36000, source: "من الدعم", stage: "تواصل", probability: 40, assigned_rep_name: "نورة المالكي", cycle_days: 18, deal_date: "2025-02-28", plan: "الاساسية", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "d6", org_id: "1", client_name: "ريم العمري", client_phone: "0552223344", deal_value: 55000, source: "من ارقام عشوائية", stage: "تفاوض", probability: 70, assigned_rep_name: "سارة الأحمدي", cycle_days: 10, deal_date: "2025-03-08", plan: "الكاشير", month: 3, year: 2025, created_at: "", updated_at: "" },
];

export const DEMO_LOST_DEALS: Deal[] = [
  { id: "ld1", org_id: "1", client_name: "مطاعم الأصيل", client_phone: "0550001111", deal_value: 75000, source: "حملة اعلانية", stage: "مكتملة", probability: 0, assigned_rep_name: "سارة الأحمدي", cycle_days: 30, deal_date: "2025-02-01", loss_reason: "سعر", notes: "المنافس قدّم عرض أقل بـ 30%", month: 2, year: 2025, created_at: "", updated_at: "" },
  { id: "ld2", org_id: "1", client_name: "كافيه برايم", client_phone: "0550002222", deal_value: 42000, source: "تسويق بالعمولة", stage: "مكتملة", probability: 0, assigned_rep_name: "محمد العمري", cycle_days: 45, deal_date: "2025-01-15", loss_reason: "منافس", notes: "اختار حل منافس بميزات مختلفة", month: 1, year: 2025, created_at: "", updated_at: "" },
  { id: "ld3", org_id: "1", client_name: "مطعم الربيع", client_phone: "0550003333", deal_value: 58000, source: "جديد لعميل حالي", stage: "مكتملة", probability: 0, assigned_rep_name: "لينا الشهري", cycle_days: 25, deal_date: "2025-02-10", loss_reason: "ميزة ناقصة", notes: "طلب تكامل مع نظام محاسبة غير مدعوم", month: 2, year: 2025, created_at: "", updated_at: "" },
  { id: "ld4", org_id: "1", client_name: "بوفيه الملكي", client_phone: "0550004444", deal_value: 35000, source: "من طرف عميل", stage: "مكتملة", probability: 0, assigned_rep_name: "أحمد القحطاني", cycle_days: 60, deal_date: "2025-01-20", loss_reason: "توقيت", notes: "أجّل القرار للعام القادم", month: 1, year: 2025, created_at: "", updated_at: "" },
  { id: "ld5", org_id: "1", client_name: "سلسلة ليالي", client_phone: "0550005555", deal_value: 110000, source: "من الدعم", stage: "مكتملة", probability: 0, assigned_rep_name: "نورة المالكي", cycle_days: 35, deal_date: "2025-02-20", loss_reason: "سعر", notes: "الميزانية لا تسمح بالخطة المطلوبة", month: 2, year: 2025, created_at: "", updated_at: "" },
  { id: "ld6", org_id: "1", client_name: "بيتزا فيستا", client_phone: "0550006666", deal_value: 48000, source: "من ارقام عشوائية", stage: "مكتملة", probability: 0, assigned_rep_name: "خالد الزهراني", cycle_days: 20, deal_date: "2025-03-01", loss_reason: "منافس", notes: "تعاقد مع منافس محلي", month: 3, year: 2025, created_at: "", updated_at: "" },
];

export const DEMO_TICKETS: Ticket[] = [
  { id: "t1", org_id: "1", ticket_number: 101, client_name: "شركة الأفق", client_phone: "0551234567", issue: "مشكلة في تسجيل الدخول", priority: "عاجل", status: "مفتوح", assigned_agent_name: "أحمد القحطاني", open_date: "2025-03-12", due_date: "2025-03-13", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "t2", org_id: "1", ticket_number: 102, client_name: "مجموعة النخبة", client_phone: "0559876543", issue: "خطأ في الفواتير", priority: "مرتفع", status: "قيد الحل", assigned_agent_name: "سارة الأحمدي", open_date: "2025-03-11", due_date: "2025-03-14", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "t3", org_id: "1", ticket_number: 103, client_name: "تقنية الرواد", client_phone: "0554443322", issue: "تعطل API", priority: "عاجل", status: "مفتوح", assigned_agent_name: "محمد العمري", open_date: "2025-03-13", due_date: "2025-03-14", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "t4", org_id: "1", ticket_number: 104, client_name: "الحلول الذكية", client_phone: "0551112233", issue: "بطء في التحميل", priority: "عادي", status: "محلول", assigned_agent_name: "لينا الشهري", open_date: "2025-03-10", due_date: "2025-03-12", resolved_date: "2025-03-11", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "t5", org_id: "1", ticket_number: 105, client_name: "شركة المستقبل", client_phone: "0557778899", issue: "مشكلة في الإشعارات", priority: "عادي", status: "قيد الحل", assigned_agent_name: "نورة المالكي", open_date: "2025-03-09", due_date: "2025-03-15", month: 3, year: 2025, created_at: "", updated_at: "" },
  { id: "t6", org_id: "1", ticket_number: 106, client_name: "الرياض تك", client_phone: "0553334455", issue: "طلب ميزة جديدة", priority: "عادي", status: "مفتوح", assigned_agent_name: "خالد الزهراني", open_date: "2025-03-14", due_date: "2025-03-20", month: 3, year: 2025, created_at: "", updated_at: "" },
];

export const DEMO_PROJECTS: Project[] = [
  { id: "p1", org_id: "1", name: "إعادة تصميم المنصة", team: "فريق التصميم", start_date: "2025-01-15", progress: 72, total_tasks: 45, remaining_tasks: 13, status_tag: "في الموعد", created_at: "", updated_at: "" },
  { id: "p2", org_id: "1", name: "تكامل Salesforce", team: "فريق التطوير", start_date: "2025-02-01", progress: 45, total_tasks: 30, remaining_tasks: 17, status_tag: "متأخر", created_at: "", updated_at: "" },
  { id: "p3", org_id: "1", name: "حملة Q3 التسويقية", team: "فريق التسويق", start_date: "2025-02-15", progress: 88, total_tasks: 25, remaining_tasks: 3, status_tag: "يكتمل قريباً", created_at: "", updated_at: "" },
  { id: "p4", org_id: "1", name: "تطبيق الجوال v2", team: "فريق التطوير", start_date: "2025-03-01", progress: 20, total_tasks: 40, remaining_tasks: 32, status_tag: "في الموعد", created_at: "", updated_at: "" },
  { id: "p5", org_id: "1", name: "دراسة رضا العملاء", team: "فريق المنتج", start_date: "2025-02-20", progress: 60, total_tasks: 20, remaining_tasks: 8, status_tag: "في الموعد", created_at: "", updated_at: "" },
];

export const DEMO_PARTNERSHIPS: Partnership[] = [
  { id: "pr1", org_id: "1", name: "أرامكو السعودية", type: "استراتيجية", status: "شراكة نشطة", value: 5000000, manager_name: "سارة الأحمدي", description: "شراكة استراتيجية شاملة في التحول الرقمي", created_at: "", updated_at: "" },
  { id: "pr2", org_id: "1", name: "STC", type: "تقنية", status: "شراكة نشطة", value: 2500000, manager_name: "محمد العمري", description: "حلول الاتصالات والبنية التحتية", created_at: "", updated_at: "" },
  { id: "pr3", org_id: "1", name: "stc pay", type: "تقنية", status: "قيد التفاوض", value: 1200000, manager_name: "لينا الشهري", description: "تكامل حلول الدفع الرقمي", created_at: "", updated_at: "" },
  { id: "pr4", org_id: "1", name: "مجموعة MBC", type: "تسويقية", status: "شراكة نشطة", value: 800000, manager_name: "أحمد القحطاني", description: "شراكة تسويقية وإعلانية", created_at: "", updated_at: "" },
  { id: "pr5", org_id: "1", name: "الاتحاد للتقنية", type: "تجارية", status: "قيد التفاوض", value: 650000, manager_name: "نورة المالكي", description: "شراكة تجارية في الحلول المؤسسية", created_at: "", updated_at: "" },
  { id: "pr6", org_id: "1", name: "نيوم", type: "استراتيجية", status: "شراكة نشطة", value: 3500000, manager_name: "خالد الزهراني", description: "شراكة في مشاريع المدن الذكية", created_at: "", updated_at: "" },
];

export const DEMO_MONTHLY_KPI: { month: string; revenue: number; target: number }[] = [
  { month: "يناير", revenue: 183000, target: 200000 },
  { month: "فبراير", revenue: 225000, target: 210000 },
  { month: "مارس", revenue: 361000, target: 220000 },
  { month: "أبريل", revenue: 290000, target: 230000 },
  { month: "مايو", revenue: 310000, target: 240000 },
  { month: "يونيو", revenue: 275000, target: 250000 },
  { month: "يوليو", revenue: 340000, target: 260000 },
  { month: "أغسطس", revenue: 295000, target: 270000 },
  { month: "سبتمبر", revenue: 320000, target: 280000 },
  { month: "أكتوبر", revenue: 380000, target: 290000 },
  { month: "نوفمبر", revenue: 330000, target: 300000 },
  { month: "ديسمبر", revenue: 371000, target: 310000 },
];

export const DEMO_FINANCE = {
  arr: 40800000,
  mrr: 3400000,
  profitMargin: 62,
  burnRate: 1300000,
  costs: [
    { label: "الرواتب", value: 55, color: "#00D4FF" },
    { label: "التقنية", value: 18, color: "#8B5CF6" },
    { label: "التسويق", value: 14, color: "#F59E0B" },
    { label: "العمليات", value: 13, color: "#10B981" },
  ],
  monthly: [
    { month: "يناير", revenue: 3200000, expenses: 1250000 },
    { month: "فبراير", revenue: 3350000, expenses: 1280000 },
    { month: "مارس", revenue: 3500000, expenses: 1300000 },
    { month: "أبريل", revenue: 3300000, expenses: 1310000 },
    { month: "مايو", revenue: 3450000, expenses: 1290000 },
    { month: "يونيو", revenue: 3600000, expenses: 1340000 },
    { month: "يوليو", revenue: 3550000, expenses: 1320000 },
    { month: "أغسطس", revenue: 3400000, expenses: 1350000 },
    { month: "سبتمبر", revenue: 3700000, expenses: 1360000 },
    { month: "أكتوبر", revenue: 3650000, expenses: 1380000 },
    { month: "نوفمبر", revenue: 3800000, expenses: 1400000 },
    { month: "ديسمبر", revenue: 3900000, expenses: 1420000 },
  ],
};

export const DEMO_RENEWALS = {
  totalCustomers: 2847,
  renewed: 1983,
  declined: 537,
  underReview: 327,
  renewalRate: 69.6,
  churnRate: 18.9,
  revenueLoss: 87400,
  targetRenewalRate: 75,
  targetChurnMax: 15,
  targetRevenueLossMax: 50000,
  rejectionReasons: [
    { reason: "ارتفاع السعر", percentage: 34 },
    { reason: "قلة الاستخدام", percentage: 22 },
    { reason: "التحوّل لمنافس", percentage: 19 },
    { reason: "نقص ميزات", percentage: 15 },
    { reason: "مشكلات تقنية", percentage: 10 },
  ],
  monthlyTrend: [
    { month: "أكتوبر", renewalRate: 72, declineRate: 16 },
    { month: "نوفمبر", renewalRate: 70, declineRate: 17 },
    { month: "ديسمبر", renewalRate: 68, declineRate: 19 },
    { month: "يناير", renewalRate: 71, declineRate: 18 },
    { month: "فبراير", renewalRate: 69, declineRate: 19 },
    { month: "مارس", renewalRate: 69.6, declineRate: 18.9 },
  ],
  feedback: [
    { name: "سلمى المطيري", rating: 5, decision: "renewed" as const, comment: "خدمة ممتازة ودعم سريع، سعيدة بالتجديد" },
    { name: "عبدالله الخالدي", rating: 2, decision: "declined" as const, comment: "الأسعار مرتفعة مقارنة بالمنافسين" },
    { name: "نورة القحطاني", rating: 4, decision: "under_review" as const, comment: "المنتج جيد لكن ننتظر الميزانية الجديدة" },
  ],
};

export const DEMO_SATISFACTION = {
  csat: 4.2,
  csatTarget: 4.0,
  nps: 52,
  npsTarget: 40,
  promotersPercent: 62,
  promotersTarget: 60,
  passivesPercent: 14,
  detractorsPercent: 24,
  starDistribution: [
    { stars: 5, percent: 48 },
    { stars: 4, percent: 27 },
    { stars: 3, percent: 13 },
    { stars: 2, percent: 8 },
    { stars: 1, percent: 4 },
  ],
  monthlyTrend: [
    { month: "أكتوبر", csat: 3.9, nps: 42 },
    { month: "نوفمبر", csat: 4.0, nps: 45 },
    { month: "ديسمبر", csat: 4.0, nps: 47 },
    { month: "يناير", csat: 4.1, nps: 48 },
    { month: "فبراير", csat: 4.1, nps: 50 },
    { month: "مارس", csat: 4.2, nps: 52 },
  ],
  saasIndustryNPS: 38,
  feedback: [
    { id: "f1", name: "خالد الشمري", avatar: "خ", stars: 5, type: "promoter" as const, category: "الدعم", date: "2025-03-10", comment: "فريق الدعم سريع الاستجابة وحل المشكلة خلال ساعة" },
    { id: "f2", name: "نورة المالكي", avatar: "ن", stars: 4, type: "promoter" as const, category: "المنتج", date: "2025-03-09", comment: "المنصة سهلة الاستخدام وتوفر تقارير مفيدة" },
    { id: "f3", name: "فهد العمري", avatar: "ف", stars: 3, type: "neutral" as const, category: "التسعير", date: "2025-03-08", comment: "الخدمة جيدة لكن الأسعار تحتاج مراجعة" },
    { id: "f4", name: "سارة الغامدي", avatar: "س", stars: 5, type: "promoter" as const, category: "التكامل", date: "2025-03-07", comment: "التكامل مع أنظمتنا كان سلس جداً" },
    { id: "f5", name: "محمد الزهراني", avatar: "م", stars: 2, type: "detractor" as const, category: "الأداء", date: "2025-03-06", comment: "بطء ملحوظ في ساعات الذروة" },
    { id: "f6", name: "ريم القحطاني", avatar: "ر", stars: 4, type: "promoter" as const, category: "التدريب", date: "2025-03-05", comment: "التدريب كان شامل ومفيد للفريق" },
  ],
};
