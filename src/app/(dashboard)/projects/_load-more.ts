"use server";

import { requirePagePermission } from "@/lib/auth-server";
import { listProjectsPaged } from "@/lib/data/projects";
import type { LiveProject } from "@/lib/odoo/live";
import { decodeFilterFromUrl } from "@/lib/custom-filter/url-state";
import type { ProjectSearchFacet } from "@/lib/data/projects";

export type ProjectFilters = {
  onlyWithCategories?: boolean;
  onlyFavorites?: boolean;
  onlyWithManager?: boolean;
  onlyMine?: boolean;
  onlyUnassigned?: boolean;
  archived?: boolean;
  allCategoriesArchived?: boolean;
  overTimesheets?: boolean;
  onlyWithOverdue?: boolean;
  startDateFrom?: string;
  startDateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  /** Base64-encoded custom filter tree (matches the URL `?cf=` param). */
  customFilterEncoded?: string;
  /** Rwasem-style faceted search; mirrors the URL `?sf=` JSON array. */
  searchFacets?: ProjectSearchFacet[];
};

export type LoadMoreResult = {
  rows: LiveProject[];
  hasMore: boolean;
  total: number;
};

export async function loadMoreProjectsAction(
  page: number,
  search: string,
  pageSize: number,
  filters: ProjectFilters = {},
): Promise<LoadMoreResult> {
  const session = await requirePagePermission("projects.view");
  const customFilter = decodeFilterFromUrl(filters.customFilterEncoded ?? null);
  const { rows, total } = await listProjectsPaged({
    organizationId: session.orgId,
    page,
    pageSize,
    search,
    onlyWithCategories: filters.onlyWithCategories,
    onlyFavorites: filters.onlyFavorites,
    onlyWithManager: filters.onlyWithManager,
    onlyMine: filters.onlyMine,
    onlyUnassigned: filters.onlyUnassigned,
    archived: filters.archived,
    allCategoriesArchived: filters.allCategoriesArchived,
    overTimesheets: filters.overTimesheets,
    onlyWithOverdue: filters.onlyWithOverdue,
    startDateFrom: filters.startDateFrom,
    startDateTo: filters.startDateTo,
    endDateFrom: filters.endDateFrom,
    endDateTo: filters.endDateTo,
    currentEmployeeId: session.employeeId,
    customFilter,
    searchFacets: filters.searchFacets,
  });
  return {
    rows,
    total,
    hasMore: page * pageSize < total,
  };
}
