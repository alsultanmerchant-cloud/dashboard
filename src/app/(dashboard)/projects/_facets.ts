// Rwasem-style faceted-search helpers for the /projects view.
//
// A "facet" is one chip in the search bar — `{ field, value }`. The active set
// is serialized to the `?sf=` URL param as a JSON array so reloads and shared
// links preserve it. Decoding is defensive: invalid entries (unknown field,
// blank value, malformed JSON) are dropped so a hand-edited URL is safe.
//
// AND/OR combination across chips is enforced server-side by migration 0132.

import type {
  ProjectSearchFacet,
  ProjectSearchFacetField,
} from "@/lib/data/projects";

export const PROJECT_FACET_FIELDS: ProjectSearchFacetField[] = [
  "name",
  "code",
  "client",
  "manager",
  "tags",
];

const FIELD_SET = new Set<ProjectSearchFacetField>(PROJECT_FACET_FIELDS);

export function decodeProjectFacets(raw: string | null | undefined): ProjectSearchFacet[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): ProjectSearchFacet[] => {
      if (!entry || typeof entry !== "object") return [];
      const field = (entry as { field?: unknown }).field;
      const value = (entry as { value?: unknown }).value;
      if (typeof field !== "string" || !FIELD_SET.has(field as ProjectSearchFacetField)) return [];
      if (typeof value !== "string" || !value.trim()) return [];
      return [{ field: field as ProjectSearchFacetField, value: value.trim() }];
    });
  } catch {
    return [];
  }
}
