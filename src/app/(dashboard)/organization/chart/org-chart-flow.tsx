"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "dagre";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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

type PersonSummary = {
  id: string;
  name: string;
  title: string | null;
  managerId?: string | null;
  visual?: "member" | "lead" | "manager" | "highlight";
};

type DeptNodeData = {
  nodeType: "dept";
  id: string;
  name: string;
  kind: DeptKind;
  slug: string;
  description: string | null;
  subtitle: string | null;
  width: number;
  height: number;
  headEmployeeId: string | null;
  memberEmployeeIds: string[];
  employees: EmployeeOption[];
  onUpdate?: (update: DepartmentUpdate) => void;
  onAddChild?: (parentId: string) => void;
  onDelete?: (id: string) => void;
  isProtected?: boolean;
};

type PersonNodeData = {
  nodeType: "person";
  name: string;
  title: string | null;
  visual: "member" | "lead" | "manager" | "highlight";
  width: number;
  height: number;
};

type FlowNodeData = DeptNodeData | PersonNodeData;

const KIND_OPTIONS: { value: DeptKind; label: string }[] = [
  { value: "group", label: "مجموعة" },
  { value: "account_management", label: "إدارة الحسابات" },
  { value: "main_section", label: "قسم أساسي" },
  { value: "supporting_section", label: "قسم مساند" },
  { value: "quality_control", label: "الجودة" },
  { value: "other", label: "إداري" },
];

const DEPT_STYLES: Record<string, string> = {
  "sl-ceo": "bg-black text-white border-black",
  "technical-head": "bg-gradient-to-r from-violet-600 to-violet-500 text-white border-violet-500",
  "sales-group": "bg-gradient-to-r from-violet-600 to-violet-500 text-white border-violet-500",
  "technical-section": "bg-violet-700 text-white border-violet-700",
  administration: "bg-violet-700 text-white border-violet-700",
  assistance: "bg-violet-700 text-white border-violet-700",
  "technical-main": "bg-[#3f73a4] text-white border-[#3f73a4]",
  "technical-supporting": "bg-[#3f73a4] text-white border-[#3f73a4]",
  "sales-team": "bg-[#3f73a4] text-white border-[#3f73a4]",
  telesales: "bg-[#3f73a4] text-white border-[#3f73a4]",
  "hr-department": "bg-[#3f73a4] text-white border-[#3f73a4]",
  accountant: "bg-[#3f73a4] text-white border-[#3f73a4]",
  "management-floor": "bg-[#3f73a4] text-white border-[#3f73a4]",
};

const DEFAULT_DEPT_STYLE = "bg-blue-700 text-white border-blue-700";

const DEPT_SIZES: Record<string, { width: number; height: number }> = {
  "sl-ceo": { width: 520, height: 118 },
  "technical-head": { width: 560, height: 72 },
  "sales-group": { width: 560, height: 72 },
  "technical-section": { width: 420, height: 50 },
  administration: { width: 360, height: 42 },
  assistance: { width: 145, height: 58 },
  "technical-main": { width: 260, height: 56 },
  "technical-supporting": { width: 260, height: 56 },
  "sales-team": { width: 350, height: 52 },
  telesales: { width: 270, height: 52 },
  "hr-department": { width: 165, height: 58 },
  accountant: { width: 165, height: 58 },
  "management-floor": { width: 145, height: 72 },
  "quality-control": { width: 115, height: 64 },
};

const PERSON_SIZES = {
  member: { width: 88, height: 34 },
  lead: { width: 92, height: 48 },
  manager: { width: 118, height: 54 },
  highlight: { width: 72, height: 44 },
};

function slugDisplayName(slug: string, fallback: string) {
  switch (slug) {
    case "technical-main":
      return "Main section";
    case "technical-supporting":
      return "Supporting section";
    case "technical-section":
      return "Technical section";
    case "sales-group":
      return "SALES";
    case "sales-team":
      return "SALES";
    case "telesales":
      return "TELESALES";
    case "quality-control":
      return "Quality control";
    case "account-management":
      return "Account manager";
    case "public-relationships":
      return "Public Relationships";
    case "social-media":
      return "Social media";
    case "media-buying":
      return "Media buying";
    case "social-content":
      return "Social content";
    case "seo-content":
      return "SEO content";
    case "art-direction-designs":
      return "Art Direction Designs";
    case "programming":
      return "Programming";
    case "art-video-editing":
      return "Video Editing";
    case "art-ai-videos":
      return "AI videos";
    case "management-floor":
      return "management floor";
    case "hr-department":
      return "HR Department";
    case "accountant":
      return "Accountant";
    default:
      return fallback;
  }
}

function buildDeptSubtitle(dept: OrgDepartment) {
  if (dept.slug === "sl-ceo") {
    return [dept.head?.full_name, dept.members[0]?.full_name].filter(Boolean).join("\n");
  }
  if (dept.slug === "technical-section" && dept.head) {
    return `Head of technical: ${dept.head.full_name}`;
  }
  if (dept.slug === "sales-group" && dept.head) {
    return `CSO: ${dept.head.full_name}`;
  }
  if (dept.slug === "quality-control" && dept.head) {
    return `Head: ${dept.head.full_name}`;
  }
  if (dept.head) {
    return `HEAD: ${dept.head.full_name}`;
  }
  return null;
}

function classifyPerson(person: PersonSummary) {
  const t = (person.title || "").toLowerCase();
  if (t.includes("head") || t.includes("supervisor") || t.includes("cso")) {
    return "manager" as const;
  }
  if (t.includes("team leader")) {
    return "lead" as const;
  }
  if (person.name === "Alaa" || person.name === "Alaa Arafat" || person.name === "Esraa Awad") {
    return "highlight" as const;
  }
  return "member" as const;
}

function personNodeLabel(data: PersonNodeData) {
  if (!data.title) return [data.name];
  if (data.visual === "lead") return [data.title.replace("Telesales ", "").replace("Sales ", ""), data.name];
  if (data.visual === "manager") return [data.title, data.name];
  return [data.name];
}

function EditDeptModal({
  data,
  open,
  onOpenChange,
}: {
  data: DeptNodeData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(data.name);
  const [kind, setKind] = useState<DeptKind>(data.kind);
  const [description, setDescription] = useState(data.description ?? "");
  const [headEmployeeId, setHeadEmployeeId] = useState(data.headEmployeeId ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(data.memberEmployeeIds);
  const [saving, setSaving] = useState(false);

  const headOptions = useMemo(
    () => [
      { value: "", label: "بدون رئيس" },
      ...data.employees.map((e) => ({ value: e.id, label: e.name, hint: e.title })),
    ],
    [data.employees],
  );

  const memberOptions = useMemo(
    () => data.employees.map((e) => ({ value: e.id, label: e.name, hint: e.title })),
    [data.employees],
  );

  const handleSave = () => {
    if (!name.trim() || !data.onUpdate) return;
    setSaving(true);
    data.onUpdate({
      id: data.id,
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
            <Input id="oc_dep_name" value={name} onChange={(e) => setName(e.target.value)} />
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oc_dep_desc">الوصف</Label>
            <Textarea
              id="oc_dep_desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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

function DeptNode({ data }: NodeProps<Node<DeptNodeData>>) {
  const [modalOpen, setModalOpen] = useState(false);
  const style = DEPT_STYLES[data.slug] ?? DEFAULT_DEPT_STYLE;
  const isTop = data.slug === "sl-ceo" || data.slug === "technical-head" || data.slug === "sales-group";
  return (
    <div className="group relative">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <div
        onDoubleClick={() => {
          if (data.onUpdate) setModalOpen(true);
        }}
        className={cn(
          "rounded-[4px] border px-3 py-2 text-center shadow-sm transition-shadow hover:shadow-md",
          style,
        )}
        style={{ width: data.width, minHeight: data.height }}
      >
        <div className={cn("whitespace-pre-line font-semibold", isTop ? "text-2xl leading-tight" : "text-[15px] leading-tight")}>
          {data.name}
        </div>
        {data.subtitle && (
          <div className={cn("mt-1 whitespace-pre-line", data.slug === "sl-ceo" ? "text-[18px] leading-tight" : "text-[12px] leading-snug")}>
            {data.subtitle}
          </div>
        )}
      </div>

      <div className="absolute -top-3 left-1 hidden gap-1 group-hover:flex">
        {data.onUpdate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setModalOpen(true);
            }}
            title="تعديل القسم"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-card ring-1 ring-border hover:text-cyan"
          >
            <Pencil className="size-3" />
          </button>
        )}
        {data.onAddChild && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddChild?.(data.id);
            }}
            title="إضافة قسم فرعي"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-card ring-1 ring-border hover:text-emerald-500"
          >
            <Plus className="size-3" />
          </button>
        )}
        {data.onDelete && !data.isProtected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`حذف "${data.name}"؟`)) data.onDelete?.(data.id);
            }}
            title="حذف"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-card ring-1 ring-border hover:text-cc-red"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-transparent" />
      {data.onUpdate && modalOpen && (
        <EditDeptModal
          key={`${data.id}:${data.name}:${data.headEmployeeId ?? ""}`}
          data={data}
          open={modalOpen}
          onOpenChange={setModalOpen}
        />
      )}
    </div>
  );
}

function PersonNode({ data }: NodeProps<Node<PersonNodeData>>) {
  const lines = personNodeLabel(data);
  const classes =
    data.visual === "manager"
      ? "bg-blue-700 text-white border-blue-700"
      : data.visual === "lead"
        ? "bg-white text-blue-700 border-blue-600"
        : data.visual === "highlight"
          ? "bg-[#e8fff0] text-[#18a04e] border-[#18a04e]"
          : "bg-white text-slate-900 border-sky-400 border-dashed";

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <div
        className={cn(
          "rounded-[4px] border px-2 py-1 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.4)]",
          classes,
        )}
        style={{ width: data.width, minHeight: data.height }}
      >
        {lines.map((line, idx) => (
          <div
            key={`${line}-${idx}`}
            className={cn(
              idx === 0 && data.visual !== "member" && data.visual !== "highlight"
                ? "text-[9px] leading-tight"
                : "text-[9px] leading-tight",
              idx === lines.length - 1 ? "font-medium" : "",
            )}
          >
            {line}
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-transparent" />
    </div>
  );
}

const NODE_TYPES = {
  dept: DeptNode,
  person: PersonNode,
};

function layoutWithDagre(nodes: Node<FlowNodeData>[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 36, nodesep: 22, edgesep: 8, marginx: 40, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    g.setNode(n.id, { width: n.data.width, height: n.data.height });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - n.data.width / 2, y: pos.y - n.data.height / 2 },
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

function buildFlowGraph(
  departments: OrgDepartment[],
  employees: EmployeeOption[],
  onUpdateDepartment?: (update: DepartmentUpdate) => Promise<void> | void,
  onAddChildDepartment?: (parentId: string) => Promise<void> | void,
  onDeleteDepartment?: (id: string) => Promise<void> | void,
) {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const personNodes = new Set<string>();

  const pushPersonNode = (
    id: string,
    person: PersonSummary,
    parentId: string,
    visualOverride?: PersonNodeData["visual"],
  ) => {
    if (personNodes.has(id)) return;
    const visual = visualOverride ?? classifyPerson(person);
    const size = PERSON_SIZES[visual];
    nodes.push({
      id,
      type: "person",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "person",
        name: person.name,
        title: person.title,
        visual,
        width: size.width,
        height: size.height,
      },
    });
    personNodes.add(id);
    edges.push({
      id: `e-${parentId}-${id}`,
      source: parentId,
      target: id,
      type: "smoothstep",
      style: { stroke: "#8f9197", strokeWidth: 1.15 },
    });
  };

  const lookup = new Map<string, PersonSummary>();

  for (const dept of departments) {
    const deptId = dept.id;
    const displayName = slugDisplayName(dept.slug, dept.name);
    const subtitle = buildDeptSubtitle(dept);
    const slug = dept.slug === "technical-section" && subtitle ? "technical-head" : dept.slug;
    const size = DEPT_SIZES[slug] ?? DEPT_SIZES[dept.slug] ?? { width: 130, height: subtitle ? 54 : 36 };
    nodes.push({
      id: deptId,
      type: "dept",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "dept",
        id: deptId,
        name: displayName,
        kind: (dept.kind as DeptKind) ?? "other",
        slug,
        description: dept.description ?? null,
        subtitle,
        width: size.width,
        height: size.height,
        headEmployeeId: dept.head?.id ?? null,
        memberEmployeeIds: [
          ...(dept.head ? [dept.head.id] : []),
          ...dept.teamLeads.map((p) => p.id),
          ...dept.members.map((p) => p.id),
        ],
        employees,
        onUpdate: onUpdateDepartment,
        onAddChild: onAddChildDepartment,
        onDelete: onDeleteDepartment,
        isProtected: dept.slug === "sl-ceo" || dept.slug === "sales-group" || dept.slug === "technical-section",
      },
    });
    if (dept.parent_department_id) {
      edges.push({
        id: `e-${dept.parent_department_id}-${dept.id}`,
        source: dept.parent_department_id,
        target: dept.id,
        type: "smoothstep",
        style: { stroke: "#8f9197", strokeWidth: 1.2 },
      });
    }

    for (const lead of dept.teamLeads) {
      lookup.set(lead.id, {
        id: lead.id,
        name: lead.full_name,
        title: lead.job_title,
        managerId: lead.manager_employee_id,
      });
    }
    for (const member of dept.members) {
      lookup.set(member.id, {
        id: member.id,
        name: member.full_name,
        title: member.job_title,
        managerId: member.manager_employee_id,
      });
    }
  }

  for (const dept of departments) {
    const deptNodeId = dept.id;
    const teamLeadIds = new Set(dept.teamLeads.map((lead) => lead.id));

    for (const lead of dept.teamLeads) {
      pushPersonNode(
        `person:${dept.id}:${lead.id}`,
        {
          id: lead.id,
          name: lead.full_name,
          title: lead.job_title,
          managerId: lead.manager_employee_id,
        },
        deptNodeId,
        "lead",
      );
    }

    for (const member of dept.members) {
      const person: PersonSummary = {
        id: member.id,
        name: member.full_name,
        title: member.job_title,
        managerId: member.manager_employee_id,
      };
      const nodeId = `person:${dept.id}:${member.id}`;
      const managerId =
        person.managerId && teamLeadIds.has(person.managerId)
          ? `person:${dept.id}:${person.managerId}`
          : deptNodeId;
      pushPersonNode(nodeId, person, managerId);
    }
  }

  return { nodes, edges };
}

function OrgChartFlowInner({
  departments,
  employees,
  onUpdateDepartment,
  onAddChildDepartment,
  onDeleteDepartment,
}: OrgChartFlowProps) {
  const employeeList = useMemo(() => employees ?? [], [employees]);
  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => buildFlowGraph(departments, employeeList, onUpdateDepartment, onAddChildDepartment, onDeleteDepartment),
    [departments, employeeList, onUpdateDepartment, onAddChildDepartment, onDeleteDepartment],
  );

  const laidOut = useMemo(() => layoutWithDagre(rawNodes, rawEdges), [rawNodes, rawEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, , onEdgesChange] = useEdgesState(rawEdges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(laidOut);
    // The container's real height can settle after this mount tick (sticky
    // header/toolbar layout, font load), so the initial `fitView` prop can
    // fit against a stale size and leave the chart scrolled out of view.
    // Re-fit once more after layout has a chance to stabilize.
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.08, minZoom: 0.35, duration: 0 });
    });
    return () => cancelAnimationFrame(raf);
  }, [laidOut, setNodes, fitView]);

  return (
    <div className="h-[82vh] w-full overflow-hidden rounded-2xl border border-soft bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.35 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.24}
        maxZoom={1.4}
      >
        <Background color="#f3f4f6" gap={24} size={1} />
        <Controls position="bottom-left" showInteractive={false} className="!bg-white !border !border-slate-200" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!bg-white !border !border-slate-200"
          maskColor="rgba(15,23,42,0.08)"
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

export function flattenOrgChart(roots: OrgDepartment[]): OrgDepartment[] {
  const out: OrgDepartment[] = [];
  const walk = (d: OrgDepartment) => {
    out.push(d);
    for (const child of d.children ?? []) walk(child);
  };
  for (const r of roots) walk(r);
  return out;
}
