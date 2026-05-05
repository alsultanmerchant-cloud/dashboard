"use server";

import { requirePagePermission } from "@/lib/auth-server";
import { listLiveProjectsPaged, type LiveProject } from "@/lib/odoo/live";

export type LoadMoreResult = {
  rows: LiveProject[];
  hasMore: boolean;
  total: number;
};

export async function loadMoreProjectsAction(
  page: number,
  search: string,
  pageSize: number,
): Promise<LoadMoreResult> {
  await requirePagePermission("projects.view");
  const { rows, total } = await listLiveProjectsPaged({
    page,
    pageSize,
    search,
  });
  return {
    rows,
    total,
    hasMore: page * pageSize < total,
  };
}
