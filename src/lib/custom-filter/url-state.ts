import type { FilterTree } from "./types";

// Custom filters live in the URL as a single `?cf=<base64-json>` query
// parameter so the page is bookmarkable and shareable.
//
// We use base64url (no `+`/`/`/`=` padding) so the value survives URL parsing
// without escaping. Failing to decode is treated as "no filter" — the rest
// of the page renders fine on a malformed param.

export const URL_PARAM = "cf";

export function encodeFilterToUrl(tree: FilterTree): string {
  const json = JSON.stringify(tree);
  if (typeof window === "undefined") {
    // Server-side: use Buffer
    return Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  // Browser
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeFilterFromUrl(value: string | null | undefined): FilterTree | null {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof window === "undefined"
        ? Buffer.from(padded, "base64").toString("utf8")
        : (() => {
            const bin = atob(padded);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder().decode(bytes);
          })();
    const parsed = JSON.parse(json) as FilterTree;
    if (parsed && parsed.type === "group" && Array.isArray(parsed.children)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
