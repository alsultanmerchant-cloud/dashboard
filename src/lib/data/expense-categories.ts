// Plain constants (no `server-only` marker) so client components can import
// the labels for selects, badges, etc. without dragging the data layer into
// the browser bundle.

export const EXPENSE_CATEGORIES = [
  "salaries", "rent", "ads", "software", "equipment",
  "utilities", "marketing", "tax", "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  salaries: "رواتب",
  rent: "إيجار",
  ads: "حملات إعلانية",
  software: "برامج وأدوات",
  equipment: "معدات",
  utilities: "مرافق",
  marketing: "تسويق",
  tax: "ضرائب ورسوم",
  other: "أخرى",
};
