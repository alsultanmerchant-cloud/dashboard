"use server";

import { requirePagePermission } from "@/lib/auth-server";
import { listProjectsPaged } from "@/lib/data/projects";
import type { LiveProject } from "@/lib/odoo/live";

export type ProjectFilters = {
  onlyWithCategories?: boolean;
  onlyFavorites?: boolean;
  onlyWithManager?: boolean;
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
  const { rows, total } = await listProjectsPaged({
    organizationId: session.orgId,
    page,
    pageSize,
    search,
    onlyWithCategories: filters.onlyWithCategories,
    onlyFavorites: filters.onlyFavorites,
    onlyWithManager: filters.onlyWithManager,
  });
  return {
    rows,
    total,
    hasMore: page * pageSize < total,
  };
}
