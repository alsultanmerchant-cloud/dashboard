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

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Crown, Pencil, Plus, Trash2 } from "lucide-react";
import "@xyflow/react/dist/style.css";

import type { OrgDepartment } from "@/lib/data/org-chart";
import { cn } from "@/lib/utils";

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
    bg: "bg-violet-500/[0.18]",
    border: "border-violet-400/40",
    text: "text-violet-50",
    chip: "bg-violet-400/20 text-violet-100",
  },
  account_management: {
    bg: "bg-cyan/15",
    border: "border-cyan/40",
    text: "text-cyan-50",
    chip: "bg-cyan/20 text-cyan-100",
  },
  main_section: {
    bg: "bg-blue-500/[0.18]",
    border: "border-blue-400/40",
    text: "text-blue-50",
    chip: "bg-blue-400/20 text-blue-100",
  },
  supporting_section: {
    bg: "bg-emerald-500/[0.16]",
    border: "border-emerald-400/35",
    text: "text-emerald-50",
    chip: "bg-emerald-400/20 text-emerald-100",
  },
  quality_control: {
    bg: "bg-amber-500/[0.16]",
    border: "border-amber-400/40",
    text: "text-amber-50",
    chip: "bg-amber-400/20 text-amber-100",
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
  headName: string | null;
  memberCount: number;
  onRename?: (id: string, newName: string) => void;
  onAddChild?: (parentId: string) => void;
  onDelete?: (id: string) => void;
  isCEO?: boolean;
};

const NODE_WIDTH = 240;
const NODE_HEIGHT = 96;

function DeptNode({ id, data }: NodeProps<Node<NodeData>>) {
  const tone = KIND_TONES[data.kind] ?? KIND_TONES.other;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.name);

  return (
    <div
      onDoubleClick={() => {
        if (data.onRename) {
          setDraft(data.name);
          setEditing(true);
        }
      }}
      className={cn(
        "group relative rounded-2xl border px-4 py-3 backdrop-blur-md transition-shadow shadow-md hover:shadow-xl",
        tone.bg,
        tone.border,
        tone.text,
      )}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30 !w-2 !h-2 !border-0" />

      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft.trim() !== data.name && data.onRename) {
                data.onRename(id, draft.trim());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(data.name);
                setEditing(false);
              }
            }}
            className="w-full bg-transparent text-sm font-extrabold leading-tight outline-none border-b border-current/40"
          />
        ) : (
          <h3 className="text-sm font-extrabold leading-tight line-clamp-2">
            {data.name}
          </h3>
        )}

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wider",
            tone.chip,
          )}
        >
          {KIND_LABEL[data.kind] ?? data.kind}
        </span>
      </div>

      {data.headName && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[11px]">
          <Crown className="size-3 opacity-70" />
          <span className="font-medium">{data.headName}</span>
        </div>
      )}

      {data.memberCount > 0 && (
        <div className="absolute bottom-2 left-3 text-[10px] opacity-60">
          {data.memberCount} عضو
        </div>
      )}

      {/* Hover toolbar */}
      <div className="absolute -top-3 left-2 hidden gap-1 group-hover:flex">
        {data.onRename && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(data.name);
              setEditing(true);
            }}
            title="تعديل الاسم"
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
    </div>
  );
}

const NODE_TYPES = { dept: DeptNode };

function layoutWithDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 60, nodesep: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      // Required by react-flow when sourcePosition/targetPosition are present
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });
}

export type OrgChartFlowProps = {
  departments: OrgDepartment[];
  onRenameDepartment?: (id: string, newName: string) => Promise<void> | void;
  onAddChildDepartment?: (parentId: string) => Promise<void> | void;
  onDeleteDepartment?: (id: string) => Promise<void> | void;
};

function OrgChartFlowInner({
  departments,
  onRenameDepartment,
  onAddChildDepartment,
  onDeleteDepartment,
}: OrgChartFlowProps) {
  const initialNodes = useMemo<Node[]>(() => {
    return departments.map((d) => ({
      id: d.id,
      type: "dept",
      position: { x: 0, y: 0 },
      data: {
        name: d.name,
        kind: (d.kind as DeptKind) ?? "other",
        headName: d.head?.full_name ?? null,
        memberCount: (d.teamLeads?.length ?? 0) + (d.members?.length ?? 0),
        onRename: onRenameDepartment,
        onAddChild: onAddChildDepartment,
        onDelete: onDeleteDepartment,
        isCEO: d.slug === "sl-ceo",
      } satisfies NodeData,
    }));
  }, [departments, onRenameDepartment, onAddChildDepartment, onDeleteDepartment]);

  const initialEdges = useMemo<Edge[]>(() => {
    return departments
      .filter((d) => d.parent_department_id)
      .map((d) => ({
        id: `e-${d.parent_department_id}-${d.id}`,
        source: d.parent_department_id!,
        target: d.id,
        type: "smoothstep",
        style: { stroke: "rgba(255,255,255,0.25)", strokeWidth: 1.5 },
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
