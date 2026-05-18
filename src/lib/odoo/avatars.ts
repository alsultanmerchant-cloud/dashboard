import type { OdooMany2one } from "./types";
import type { OdooClient } from "./client";

export type OdooUserAvatarRow = {
  id: number;
  name: string;
  login: string | false;
  active: boolean;
  share: boolean;
  partner_id: OdooMany2one;
  avatar_128?: string | false | null;
  image_128?: string | false | null;
  image_1920?: string | false | null;
};

const BASE_USER_FIELDS = [
  "id",
  "name",
  "login",
  "active",
  "share",
  "partner_id",
] as const;

const USER_FIELD_CANDIDATES = [
  [...BASE_USER_FIELDS, "avatar_128"],
  [...BASE_USER_FIELDS, "image_128"],
  [...BASE_USER_FIELDS, "image_1920"],
  [...BASE_USER_FIELDS],
];

function firstNonEmpty(...values: Array<string | false | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function inferDataMimeType(base64: string): string {
  const normalized = base64.trim();
  if (normalized.startsWith("PD94bWw") || normalized.startsWith("PHN2Zy")) {
    return "image/svg+xml";
  }
  if (normalized.startsWith("iVBORw0KGgo")) return "image/png";
  if (normalized.startsWith("/9j/")) return "image/jpeg";
  if (normalized.startsWith("R0lGOD")) return "image/gif";
  if (normalized.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

export function odooAvatarDataUrl(row: Pick<OdooUserAvatarRow, "avatar_128" | "image_128" | "image_1920">): string | null {
  const base64 = firstNonEmpty(row.avatar_128, row.image_128, row.image_1920);
  if (!base64) return null;
  if (base64.startsWith("data:")) return base64;
  return `data:${inferDataMimeType(base64)};base64,${base64}`;
}

export async function fetchOdooUsersWithAvatars(odoo: OdooClient): Promise<OdooUserAvatarRow[]> {
  let lastError: Error | null = null;

  for (const fields of USER_FIELD_CANDIDATES) {
    try {
      return await odoo.searchRead<OdooUserAvatarRow>(
        "res.users",
        [["active", "=", true], ["share", "=", false]],
        [...fields],
        { limit: 500, context: { bin_size: false } },
      );
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError ?? new Error("Failed to fetch Odoo users");
}
