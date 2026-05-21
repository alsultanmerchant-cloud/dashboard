"use client";

import { usePathname } from "next/navigation";
import {
  AnalyticsPageSkeleton,
  CollectionPageSkeleton,
  DetailPageSkeleton,
  ExecutiveDashboardSkeleton,
  FeedPageSkeleton,
  FormPageSkeleton,
  MessagesInboxSkeleton,
  OrgChartSkeleton,
  ProjectBoardSkeleton,
  ProjectDetailSkeleton,
  ProjectGanttSkeleton,
  TaskDetailSkeleton,
  TablePageSkeleton,
  TasksWorkspaceSkeleton,
} from "@/components/skeletons";

function isAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

export default function DashboardLoading() {
  const pathname = usePathname() ?? "/";

  if (pathname === "/dashboard" || pathname === "/") {
    return <ExecutiveDashboardSkeleton />;
  }

  if (isAny(pathname, ["/reports", "/ai-insights"])) {
    return <AnalyticsPageSkeleton />;
  }

  if (isAny(pathname, ["/handover", "/contracts/import"])) {
    return <FormPageSkeleton />;
  }

  if (pathname.startsWith("/projects/new")) {
    return <FormPageSkeleton />;
  }

  if (pathname.startsWith("/organization/chart")) {
    return <OrgChartSkeleton />;
  }

  if (pathname.startsWith("/projects/") && pathname.includes("/gantt")) {
    return <ProjectGanttSkeleton />;
  }

  if (
    pathname.startsWith("/tasks/odoo/")
    || /^\/tasks\/[0-9a-f-]+$/i.test(pathname)
  ) {
    return <TaskDetailSkeleton />;
  }

  if (
    pathname.startsWith("/projects/")
  ) {
    return <ProjectDetailSkeleton />;
  }

  if (
    pathname.startsWith("/contracts/")
    || pathname.startsWith("/task-templates/")
    || pathname.startsWith("/organization/departments/")
    || pathname.startsWith("/organization/employees/odoo/")
    || pathname.startsWith("/clients/odoo/")
  ) {
    return <DetailPageSkeleton />;
  }

  if (pathname.startsWith("/notifications")) {
    return <FeedPageSkeleton rows={10} />;
  }

  if (pathname.startsWith("/messages")) {
    return <MessagesInboxSkeleton />;
  }

  if (pathname.startsWith("/tasks")) {
    return <TasksWorkspaceSkeleton />;
  }

  if (pathname.startsWith("/projects")) {
    return <ProjectBoardSkeleton />;
  }

  if (isAny(pathname, ["/clients", "/contracts", "/finance"])) {
    return <TablePageSkeleton filterCount={2} statCount={4} rows={8} cols={5} />;
  }

  if (isAny(pathname, ["/governance", "/sales"])) {
    return <CollectionPageSkeleton filterCount={1} statCount={4} rows={6} />;
  }

  if (isAny(pathname, ["/hr", "/escalations"])) {
    return <CollectionPageSkeleton filterCount={1} statCount={3} rows={6} />;
  }

  if (pathname.startsWith("/organization")) {
    return <CollectionPageSkeleton filterCount={2} statCount={3} rows={6} />;
  }

  return <CollectionPageSkeleton filterCount={2} statCount={4} rows={6} />;
}
