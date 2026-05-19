"use client";

// PDF-style editable org chart using @xyflow/react + dagre for auto-layout.
// Renders the Sky Light department tree as a top-down flowchart that
// matches the look of the owner's "Sky light organization.pdf".
//
// Features:
//   - Auto-layout via dagre (top-down, like the PDF)
//   - Drag nodes to reposition (positions persist in component state)
//   - Double-click a node to rename (calls onRenameDepartment)
//   - Pan + zoom + minimap + controls
//   - Color-coded by department kind (matches the PDF palette)
//
// Server actions for rename/add/delete are wired through props so the
// component stays purely presentational and the page owns persistence.

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import dagre from "dagre";
import { Crown, Loader2, Pencil, Plus, Shield, Trash2, Users } from "lucide-react";
import "@xyflow/react/dist/style.css";

import type { OrgDepartment } from "@/lib/data/org-chart";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DepartmentUpdate = {
  id: string;
  name: string;
  kind: DeptKind;
  description: string | null;
  headEmployeeId: string | null;
  memberEmployeeIds: string[];
};

export type EmployeeOption = {
  id: string;
  name: string;
  title: string | null;
};

type DeptKind =
  | "group"
  | "account_management"
  | "main_section"
  | "supporting_section"
  | "quality_control"
  | "other";

// Tones matching the PDF palette: black (CEO), purple (technical), dark-blue (sales),
// teal (admin), light-blue (sub-departments), green (support).
const KIND_TONES: Record<DeptKind, { bg: string; border: string; text: string; chip: string }> = {
  group: {
    bg: "bg-violet-500/[0.18] dark:bg-violet-500/[0.18]",
    border: "border-violet-500/35 dark:border-violet-400/40",
    text: "text-violet-950 dark:text-violet-50",
    chip: "bg-violet-500/18 text-violet-900 dark:bg-violet-400/20 dark:text-violet-100",
  },
  account_management: {
    bg: "bg-cyan/15 dark:bg-cyan/15",
    border: "border-cyan/45 dark:border-cyan/40",
    text: "text-sky-950 dark:text-cyan-50",
    chip: "bg-cyan/18 text-sky-900 dark:bg-cyan/20 dark:text-cyan-100",
  },
  main_section: {
    bg: "bg-blue-500/[0.18] dark:bg-blue-500/[0.18]",
    border: "border-blue-500/35 dark:border-blue-400/40",
    text: "text-blue-950 dark:text-blue-50",
    chip: "bg-blue-500/18 text-blue-900 dark:bg-blue-400/20 dark:text-blue-100",
  },
  supporting_section: {
    bg: "bg-emerald-500/[0.16] dark:bg-emerald-500/[0.16]",
    border: "border-emerald-500/35 dark:border-emerald-400/35",
    text: "text-emerald-950 dark:text-emerald-50",
    chip: "bg-emerald-500/18 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-100",
  },
  quality_control: {
    bg: "bg-amber-500/[0.16] dark:bg-amber-500/[0.16]",
    border: "border-amber-500/35 dark:border-amber-400/40",
    text: "text-amber-950 dark:text-amber-50",
    chip: "bg-amber-500/18 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100",
  },
  other: {
    bg: "bg-soft-2",
    border: "border-soft-2",
    text: "text-foreground",
    chip: "bg-soft-3 text-muted-foreground",
  },
};

const KIND_LABEL: Record<DeptKind, string> = {
  group: "مجموعة",
  account_management: "إدارة الحسابات",
  main_section: "قسم أساسي",
  supporting_section: "قسم مساند",
  quality_control: "الجودة",
  other: "إداري",
};

type NodeData = {
  name: string;
  kind: DeptKind;
  description: string | null;
  headEmployeeId: string | null;
  memberEmployeeIds: string[];
  head: PersonSummary | null;
  teamLeads: PersonSummary[];
  members: PersonSummary[];
  childCount: number;
  totalPeople: number;
  width: number;
  height: number;
  employees: EmployeeOption[];
  onRename?: (id: string, newName: string) => void;
  onUpdate?: (update: DepartmentUpdate) => void;
  onAddChild?: (parentId: string) => void;
  onDelete?: (id: string) => void;
  isCEO?: boolean;
};

const KIND_OPTIONS: { value: DeptKind; label: string }[] = (
  ["group", "account_management", "main_section", "supporting_section", "quality_control", "other"] as DeptKind[]
).map((k) => ({ value: k, label: KIND_LABEL[k] }));

type PersonSummary = {
  id: string;
  name: string;
  title: string | null;
};

const NODE_WIDTH = 300;
const GROUP_NODE_WIDTH = 320;
const NODE_MIN_HEIGHT = 120;

function estimateNodeSize(dept: OrgDepartment) {
  const width = dept.kind === "group" ? GROUP_NODE_WIDTH : NODE_WIDTH;
  const peopleRows =
    (dept.head ? 1 : 0) +
    Math.ceil((dept.teamLeads.length || 0) / 2) +
    Math.ceil((dept.members.length || 0) / 2);
  const metaRows =
    2 +
    (dept.head ? 1 : 0) +
    (dept.teamLeads.length > 0 ? 1 : 0) +
    (dept.members.length > 0 ? 1 : 0) +
    (dept.children.length > 0 ? 1 : 0);
  const height = Math.max(
    NODE_MIN_HEIGHT,
    78 + metaRows * 24 + peopleRows * 34 + (dept.description ? 24 : 0),
  );
  return { width, height };
}

function PersonPill({
  person,
  icon,
}: {
  person: PersonSummary;
  icon?: "head" | "lead";
}) {
  return (
    <div className="rounded-xl bg-black/10 px-2.5 py-1.5 text-[11px] leading-tight dark:bg-white/10">
      <div className="flex items-center gap-1.5 font-semibold">
        {icon === "head" && <Crown className="size-3 opacity-70" />}
        {icon === "lead" && <Shield className="size-3 opacity-70" />}
        <span>{person.name}</span>
      </div>
      {person.title && (
        <div className="mt-0.5 text-[10px] opacity-75">
          {person.title}
        </div>
      )}
    </div>
  );
}

function PeopleSection({
  label,
  people,
  icon,
}: {
  label: string;
  people: PersonSummary[];
  icon?: "head" | "lead";
}) {
  if (people.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <div className="text-[10px] font-semibold tracking-wide opacity-70">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {people.map((person) => (
          <PersonPill key={person.id} person={person} icon={icon} />
        ))}
      </div>
    </section>
  );
}

function EditDeptModal({
  id,
  data,
  open,
  onOpenChange,
}: {
  id: string;
  data: NodeData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(data.name);
  const [kind, setKind] = useState<DeptKind>(data.kind);
  const [description, setDescription] = useState(data.description ?? "");
  const [headEmployeeId, setHeadEmployeeId] = useState(data.headEmployeeId ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(data.memberEmployeeIds);
  const [saving, setSaving] = useState(false);

  // Re-sync the form whenever the modal (re)opens for this node.
  useEffect(() => {
    if (open) {
      setName(data.name);
      setKind(data.kind);
      setDescription(data.description ?? "");
      setHeadEmployeeId(data.headEmployeeId ?? "");
      setMemberIds(data.memberEmployeeIds);
      setSaving(false);
    }
  }, [open, data.name, data.kind, data.description, data.headEmployeeId, data.memberEmployeeIds]);

  const headOptions = useMemo(
    () => [
      { value: "", label: "بدون رئيس" },
      ...data.employees.map((e) => ({
        value: e.id,
        label: e.name,
        hint: e.title,
      })),
    ],
    [data.employees],
  );

  const memberOptions = useMemo(
    () =>
      data.employees.map((e) => ({
        value: e.id,
        label: e.name,
        hint: e.title,
      })),
    [data.employees],
  );

  const handleSave = () => {
    if (!name.trim() || !data.onUpdate) return;
    setSaving(true);
    data.onUpdate({
      id,
      name: name.trim(),
      kind,
      description: description.trim() ? description.trim() : null,
      headEmployeeId: headEmployeeId || null,
      memberEmployeeIds: memberIds,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل القسم</DialogTitle>
          <DialogDescription>عدّل بيانات هذا القسم في هيكل الوكالة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oc_dep_name">اسم القسم *</Label>
            <Input
              id="oc_dep_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: الإعلام الرقمي"
            />
          </div>
          <div className="space-y-1.5">
            <Label>نوع القسم</Label>
            <SearchableSelect
              value={kind}
              onValueChange={(v) => setKind((v as DeptKind) || "other")}
              options={KIND_OPTIONS}
              placeholder="اختر النوع"
              ariaLabel="نوع القسم"
            />
          </div>
          <div className="space-y-1.5">
            <Label>رئيس القسم</Label>
            <SearchableSelect
              value={headEmployeeId}
              onValueChange={setHeadEmployeeId}
              options={headOptions}
              placeholder="بدون رئيس"
              searchPlaceholder="ابحث عن موظف…"
              emptyMessage="لا يوجد موظفون"
              ariaLabel="رئيس القسم"
            />
          </div>
          <div className="space-y-1.5">
            <Label>الأعضاء</Label>
            <SearchableSelect
              multi
              value={memberIds}
              onValueChange={setMemberIds}
              options={memberOptions}
              placeholder="اختر الأعضاء"
              searchPlaceholder="ابحث عن موظف…"
              emptyMessage="لا يوجد موظفون"
              ariaLabel="أعضاء القسم"
            />
            <p className="text-[11px] text-muted-foreground">
              سيتم نقل أي موظف مُختار إلى هذا القسم، وإلغاء ربط الموظفين المُزالين.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oc_dep_desc">الوصف</Label>
            <Textarea
              id="oc_dep_desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف اختياري للقسم…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            حفظ التعديلات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeptNode({ id, data }: NodeProps<Node<NodeData>>) {
  const tone = KIND_TONES[data.kind] ?? KIND_TONES.other;
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div
      onDoubleClick={() => {
        if (data.onUpdate) setModalOpen(true);
      }}
      className={cn(
        "group relative rounded-2xl border px-4 py-3 backdrop-blur-md transition-shadow shadow-md hover:shadow-xl",
        tone.bg,
        tone.border,
        tone.text,
      )}
      style={{ width: data.width, minHeight: data.height }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30 !w-2 !h-2 !border-0" />

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-extrabold leading-tight">
            {data.name}
          </h3>

          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wider",
              tone.chip,
            )}
          >
            {KIND_LABEL[data.kind] ?? data.kind}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] opacity-70">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {data.totalPeople} عضو
          </span>
          {data.childCount > 0 && (
            <span>{data.childCount} قسم فرعي</span>
          )}
        </div>

        <PeopleSection
          label="الإدارة"
          people={data.head ? [data.head] : []}
          icon="head"
        />
        <PeopleSection
          label="قادة الفرق"
          people={data.teamLeads}
          icon="lead"
        />
        <PeopleSection
          label="الأعضاء"
          people={data.members}
        />
      </div>

      {/* Hover toolbar */}
      <div className="absolute -top-3 left-2 hidden gap-1 group-hover:flex">
        {data.onUpdate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setModalOpen(true);
            }}
            title="تعديل القسم"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-card/95 ring-1 ring-white/15 hover:bg-cyan/20 hover:text-cyan"
          >
            <Pencil className="size-3" />
          </button>
        )}
        {data.onAddChild && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddChild?.(id);
            }}
            title="إضافة قسم فرعي"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-card/95 ring-1 ring-white/15 hover:bg-emerald-400/20 hover:text-emerald-300"
          >
            <Plus className="size-3" />
          </button>
        )}
        {data.onDelete && !data.isCEO && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`حذف "${data.name}"؟`)) data.onDelete?.(id);
            }}
            title="حذف"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-card/95 ring-1 ring-white/15 hover:bg-cc-red/20 hover:text-cc-red"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-white/30 !w-2 !h-2 !border-0" />

      {data.onUpdate && (
        <EditDeptModal id={id} data={data} open={modalOpen} onOpenChange={setModalOpen} />
      )}
    </div>
  );
}

const NODE_TYPES = { dept: DeptNode };

function layoutWithDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 60, nodesep: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const width =
      typeof n.style?.width === "number" ? n.style.width : NODE_WIDTH;
    const height =
      n.data && typeof n.data === "object" && "height" in n.data
        ? (n.data.height as number)
        : NODE_MIN_HEIGHT;
    g.setNode(n.id, { width, height });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    const width =
      typeof n.style?.width === "number" ? n.style.width : NODE_WIDTH;
    const height =
      n.data && typeof n.data === "object" && "height" in n.data
        ? (n.data.height as number)
        : NODE_MIN_HEIGHT;
    return {
      ...n,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
      // Required by react-flow when sourcePosition/targetPosition are present
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });
}

export type OrgChartFlowProps = {
  departments: OrgDepartment[];
  employees?: EmployeeOption[];
  onRenameDepartment?: (id: string, newName: string) => Promise<void> | void;
  onUpdateDepartment?: (update: DepartmentUpdate) => Promise<void> | void;
  onAddChildDepartment?: (parentId: string) => Promise<void> | void;
  onDeleteDepartment?: (id: string) => Promise<void> | void;
};

function OrgChartFlowInner({
  departments,
  employees,
  onRenameDepartment,
  onUpdateDepartment,
  onAddChildDepartment,
  onDeleteDepartment,
}: OrgChartFlowProps) {
  const employeeList = useMemo(() => employees ?? [], [employees]);
  const initialNodes = useMemo<Node[]>(() => {
    return departments.map((d) => {
      const { width, height } = estimateNodeSize(d);
      return {
        id: d.id,
        type: "dept",
        position: { x: 0, y: 0 },
        style: { width },
        data: {
          name: d.name,
          kind: (d.kind as DeptKind) ?? "other",
          description: d.description ?? null,
          headEmployeeId: d.head?.id ?? null,
          memberEmployeeIds: [
            ...(d.head ? [d.head.id] : []),
            ...d.teamLeads.map((p) => p.id),
            ...d.members.map((p) => p.id),
          ],
          head: d.head
            ? {
                id: d.head.id,
                name: d.head.full_name,
                title: d.head.job_title ?? null,
              }
            : null,
          teamLeads: d.teamLeads.map((person) => ({
            id: person.id,
            name: person.full_name,
            title: person.job_title ?? null,
          })),
          members: d.members.map((person) => ({
            id: person.id,
            name: person.full_name,
            title: person.job_title ?? null,
          })),
          childCount: d.children.length,
          totalPeople:
            (d.head ? 1 : 0) + d.teamLeads.length + d.members.length,
          width,
          height,
          employees: employeeList,
          onRename: onRenameDepartment,
          onUpdate: onUpdateDepartment,
          onAddChild: onAddChildDepartment,
          onDelete: onDeleteDepartment,
          isCEO: d.slug === "sl-ceo",
        } satisfies NodeData,
      };
    });
  }, [departments, employeeList, onRenameDepartment, onUpdateDepartment, onAddChildDepartment, onDeleteDepartment]);

  const initialEdges = useMemo<Edge[]>(() => {
    return departments
      .filter((d) => d.parent_department_id)
      .map((d) => ({
        id: `e-${d.parent_department_id}-${d.id}`,
        source: d.parent_department_id!,
        target: d.id,
        type: "smoothstep",
        style: {
          stroke: "color-mix(in srgb, var(--foreground) 22%, transparent)",
          strokeWidth: 1.5,
        },
      }));
  }, [departments]);

  const laidOut = useMemo(
    () => layoutWithDagre(initialNodes, initialEdges),
    [initialNodes, initialEdges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Re-layout when departments change shape (added/deleted).
  useEffect(() => {
    setNodes(laidOut);
  }, [laidOut, setNodes]);

  return (
    <div className="h-[78vh] w-full overflow-hidden rounded-2xl border border-soft bg-card/30">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.3}
        maxZoom={1.6}
      >
        <Background gap={24} size={1} className="opacity-60" />
        <Controls position="bottom-left" showInteractive={false} className="!bg-card/80 !border !border-soft-2" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!bg-card/80 !border !border-soft-2"
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  );
}

export function OrgChartFlow(props: OrgChartFlowProps) {
  return (
    <ReactFlowProvider>
      <OrgChartFlowInner {...props} />
    </ReactFlowProvider>
  );
}

// Helper: flatten the tree (returned by loadOrgChart as nested) into the
// flat list our component expects. Server pages call this before passing.
export function flattenOrgChart(roots: OrgDepartment[]): OrgDepartment[] {
  const out: OrgDepartment[] = [];
  const walk = (d: OrgDepartment) => {
    out.push(d);
    for (const child of d.children ?? []) walk(child);
  };
  for (const r of roots) walk(r);
  return out;
}
