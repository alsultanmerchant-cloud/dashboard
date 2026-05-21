"use client";

// Client wrapper around the project info page's ActionBar. Owns the open
// state for all StackedSheets triggered from smart-button pills:
// Documents, Followers, Chatter, Activities. The server page builds
// counts for smart-button pills and owns sheet state for related actions.

import * as React from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, FileText, ListTodo, Users } from "lucide-react";

import { ActionBar, type SmartPill } from "@/components/layout/action-bar";
import type { RecordKind } from "@/components/layout/record-pagination";
import { StackedSheet } from "@/components/ui/stacked-sheet";

const ProjectDocumentsPanel = dynamic(
  () => import("./project-documents-panel").then((mod) => mod.ProjectDocumentsPanel),
);
const ProjectFollowersSheetBody = dynamic(
  () => import("./project-followers-sheet").then((mod) => mod.ProjectFollowersSheetBody),
);
const ProjectActivitiesSheetBody = dynamic(
  () => import("./project-activities-sheet").then((mod) => mod.ProjectActivitiesSheetBody),
);

type ChromeProps = {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  recordKind: RecordKind;
  moduleLabel: string;
  moduleHref: string;
  newHref: string;
  /** Right-side action cluster. */
  rightActions: React.ReactNode;
  /** Counts used in smart pills. */
  totalTasks: number;
  followerCount: number;
  documentCount: number;
  /** Labels (translated server-side). */
  labels: {
    totalTasks: string;
    collaborators: string;
    documents: string;
    activities: string;
    documentsSheetTitle: string;
    documentsSheetDescription: string;
    followersSheetTitle: string;
    followersSheetDescription: string;
    activitiesSheetTitle: string;
  };
};

export function ProjectInfoChrome({
  projectId,
  projectName,
  projectCode,
  recordKind,
  moduleLabel,
  moduleHref,
  newHref,
  rightActions,
  totalTasks,
  followerCount,
  documentCount,
  labels,
}: ChromeProps) {
  const [docsOpen, setDocsOpen] = React.useState(false);
  const [followersOpen, setFollowersOpen] = React.useState(false);
  const [activitiesOpen, setActivitiesOpen] = React.useState(false);

  const smartPills: SmartPill[] = [
    {
      key: "tasks",
      label: labels.totalTasks,
      value: String(totalTasks),
      icon: <ListTodo className="size-3.5" />,
      href: `/tasks?projectId=${projectId}`,
    },
    {
      key: "collaborators",
      label: labels.collaborators,
      value: String(followerCount),
      icon: <Users className="size-3.5" />,
      onClick: () => setFollowersOpen(true),
    },
    {
      key: "documents",
      label: labels.documents,
      value: String(documentCount),
      icon: <FileText className="size-3.5" />,
      onClick: () => setDocsOpen(true),
    },
    {
      key: "activities",
      label: labels.activities,
      value: <CheckCircle2 className="size-3.5" />,
      onClick: () => setActivitiesOpen(true),
    },
  ];

  return (
    <>
      <ActionBar
        newHref={newHref}
        moduleLabel={moduleLabel}
        moduleHref={moduleHref}
        recordName={projectName}
        recordCode={projectCode}
        recordId={projectId}
        recordKind={recordKind}
        smartPills={smartPills}
        rightActions={rightActions}
      />

      <StackedSheet
        open={docsOpen}
        onOpenChange={setDocsOpen}
        title={labels.documentsSheetTitle}
        description={labels.documentsSheetDescription}
        heightFraction={0.9}
      >
        {docsOpen ? <ProjectDocumentsPanel projectId={projectId} /> : null}
      </StackedSheet>

      <StackedSheet
        open={followersOpen}
        onOpenChange={setFollowersOpen}
        title={labels.followersSheetTitle}
        description={labels.followersSheetDescription}
        heightFraction={0.78}
      >
        {followersOpen ? <ProjectFollowersSheetBody projectId={projectId} /> : null}
      </StackedSheet>

      <StackedSheet
        open={activitiesOpen}
        onOpenChange={setActivitiesOpen}
        title={labels.activitiesSheetTitle}
        heightFraction={0.78}
      >
        {activitiesOpen ? <ProjectActivitiesSheetBody projectId={projectId} /> : null}
      </StackedSheet>
    </>
  );
}
