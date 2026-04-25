import { STAGES, SOURCES } from "./constants";

/* ─── Stage Mapping: Excel/external → App internal ─── */
export const STAGE_MAP: Record<string, string> = {
  // Common Excel values → app stages
  "إغلاق": "مكتملة",
  "عرض سعر": "تجهيز",
  "خسارة": "مرفوض مع سبب",
  // Identity mappings for all app stages
  "تواصل": "تواصل",
  "تفاوض": "تفاوض",
  "تجهيز": "تجهيز",
  "انتظار الدفع": "انتظار الدفع",
  "مكتملة": "مكتملة",
  "تاجيل": "تاجيل",
  "اعادة الاتصال في وقت اخر": "اعادة الاتصال في وقت اخر",
  "تجريبي": "تجريبي",
  "مرفوض مع سبب": "مرفوض مع سبب",
};

/* ─── Source Mapping: Excel/external → App internal ─── */
export const SOURCE_MAP: Record<string, string> = {
  // Common Excel values → app sources
  "شراكة": "تسويق بالعمولة",
  "توصية": "من طرف عميل",
  "معرض": "حملة اعلانية",
  "إعلانات": "حملة اعلانية",
  "تسويق": "تسويق بالعمولة",
  "تواصل": "من ارقام عشوائية",
  // Identity mappings for all app sources
  "حملة اعلانية": "حملة اعلانية",
  "تسويق بالعمولة": "تسويق بالعمولة",
  "جديد لعميل حالي": "جديد لعميل حالي",
  "فرع جديد لعميل حالي": "فرع جديد لعميل حالي",
  "من طرف عميل": "من طرف عميل",
  "من الدعم": "من الدعم",
  "من ارقام عشوائية": "من ارقام عشوائية",
  "اخرى": "اخرى",
};

/* ─── Renewal Status Mapping ─── */
export const RENEWAL_STATUS_MAP: Record<string, string> = {
  "قيد الانتظار": "جاري المتابعة",
  "مكتمل": "مكتمل",
  "ملغي": "ملغي بسبب",
  // Identity mappings
  "مجدول": "مجدول",
  "جاري المتابعة": "جاري المتابعة",
  "انتظار الدفع": "انتظار الدفع",
  "ملغي بسبب": "ملغي بسبب",
};

const VALID_STAGES_SET = new Set(STAGES);
const VALID_SOURCES_SET = new Set(SOURCES);

/**
 * Map a raw stage value to the app's canonical stage.
 * Priority: AI stage_mapping > hardcoded STAGE_MAP > fallback
 */
export function mapStage(
  raw: string,
  aiStageMap?: Record<string, string>,
  fallback = "تواصل"
): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  // AI mapping takes priority
  if (aiStageMap?.[trimmed]) {
    const aiMapped = aiStageMap[trimmed];
    if (VALID_STAGES_SET.has(aiMapped as typeof STAGES[number])) return aiMapped;
  }

  // Hardcoded mapping
  const mapped = STAGE_MAP[trimmed];
  if (mapped) return mapped;

  // Already a valid stage?
  if (VALID_STAGES_SET.has(trimmed as typeof STAGES[number])) return trimmed;

  return fallback;
}

/**
 * Map a raw source value to the app's canonical source.
 */
export function mapSource(raw: string, fallback = "اخرى"): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const mapped = SOURCE_MAP[trimmed];
  if (mapped) return mapped;

  if (VALID_SOURCES_SET.has(trimmed as typeof SOURCES[number])) return trimmed;

  return fallback;
}

/**
 * Map a raw renewal status to the app's canonical renewal status.
 */
export function mapRenewalStatus(raw: string, fallback = "مجدول"): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const mapped = RENEWAL_STATUS_MAP[trimmed];
  if (mapped) return mapped;

  return fallback;
}
