"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Employee, FollowUpNote } from "@/types";
import { fetchFollowUpNotes, createFollowUpNote, fetchEmployees, createMentionNotification } from "@/lib/supabase/db";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Send, Clock, AtSign } from "lucide-react";

interface FollowUpLogProps {
  entityType: "deal" | "renewal";
  entityId: string;
  entityName: string;
}

export function FollowUpLogButton({ entityType, entityId, entityName }: FollowUpLogProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<FollowUpNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteType, setNoteType] = useState<string>("note");
  const { user } = useAuth();

  const NOTE_TYPES = [
    { value: "note", label: "ملاحظة", icon: "📝" },
    { value: "call", label: "اتصال", icon: "📞" },
    { value: "whatsapp", label: "واتساب", icon: "💬" },
    { value: "followup", label: "متابعة", icon: "🔁" },
    { value: "meeting", label: "اجتماع", icon: "🤝" },
    { value: "demo", label: "عرض Demo", icon: "🖥" },
    { value: "quote", label: "عرض سعر", icon: "📄" },
  ];

  /* Employees for @mention */
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1); // cursor position of @
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      fetchFollowUpNotes(entityType, entityId),
      fetchEmployees(),
    ]).then(([n, e]) => {
      setNotes(n);
      setEmployees(e);
    }).catch(console.error).finally(() => setLoading(false));
  }, [open, entityType, entityId]);

  const filteredEmployees = employees.filter((e) =>
    !mentionFilter || e.name.includes(mentionFilter)
  );

  const insertMention = useCallback((name: string) => {
    const textarea = textareaRef.current;
    if (!textarea || mentionStart === -1) return;
    // Replace from @ position to current cursor with @name
    const before = newNote.slice(0, mentionStart); // everything before @
    const cursor = textarea.selectionStart;
    const after = newNote.slice(cursor);
    const inserted = before + `@${name} ` + after;
    setNewNote(inserted);
    setShowMentions(false);
    setMentionFilter("");
    setMentionStart(-1);
    setTimeout(() => {
      textarea.focus();
      const pos = before.length + name.length + 2; // @ + name + space
      textarea.setSelectionRange(pos, pos);
    }, 0);
  }, [newNote, mentionStart]);

  function handleNoteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setNewNote(val);

    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);

    // Find the last @ that isn't followed by a completed mention
    const atIdx = before.lastIndexOf("@");
    if (atIdx !== -1 && (atIdx === 0 || before[atIdx - 1] === " " || before[atIdx - 1] === "\n")) {
      const query = before.slice(atIdx + 1);
      // Only show dropdown if no newline after @
      if (!query.includes("\n")) {
        setMentionStart(atIdx);
        setMentionFilter(query);
        setShowMentions(true);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showMentions && filteredEmployees.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredEmployees.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredEmployees[mentionIndex].name);
      } else if (e.key === "Escape") {
        setShowMentions(false);
      }
      return;
    }
    if (e.key === "Enter" && e.ctrlKey) handleAdd();
  }

  /* Extract mentioned employee names from text by matching against known employees */
  function extractMentions(text: string): string[] {
    const mentioned: string[] = [];
    for (const emp of employees) {
      if (text.includes(`@${emp.name}`)) {
        mentioned.push(emp.name);
      }
    }
    return [...new Set(mentioned)];
  }

  async function handleAdd() {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const authorName = user?.name || user?.email || "مستخدم";
      const created = await createFollowUpNote(entityType, entityId, newNote.trim(), authorName, noteType);
      setNotes((prev) => [created, ...prev]);

      /* Send mention notifications */
      const mentionedNames = extractMentions(newNote);
      for (const name of mentionedNames) {
        createMentionNotification(created.id, entityType, entityId, entityName, name, authorName, newNote.trim()).catch(console.error);
      }

      setNewNote("");
      setNoteType("note");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function formatDateTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }) +
      " — " +
      d.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
  }

  /* Render note text with highlighted mentions */
  function renderNoteText(text: string) {
    if (employees.length === 0) return text;
    // Build regex from employee names sorted by length (longest first to avoid partial matches)
    const names = employees.map((e) => e.name).sort((a, b) => b.length - a.length);
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      part.startsWith("@") && names.some((n) => part === `@${n}`) ? (
        <span key={i} className="text-amber font-bold">{part}</span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-md hover:bg-amber/10 text-amber transition-colors"
        title="سجل المتابعة"
      >
        <MessageSquarePlus className="w-3.5 h-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-right">
              سجل متابعة — {entityName}
            </DialogTitle>
          </DialogHeader>

          {/* Note type selector */}
          <div className="flex gap-1.5 flex-wrap">
            {NOTE_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setNoteType(t.value)}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${
                  noteType === t.value
                    ? "border-cyan bg-cyan/15 text-cyan font-bold"
                    : "border-border/50 text-muted-foreground hover:border-border"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Add note input */}
          <div className="relative">
            <div className="flex gap-2 items-start">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={newNote}
                  onChange={handleNoteChange}
                  onKeyDown={handleKeyDown}
                  placeholder="أضف تعليق... اكتب @ لمنشن موظف"
                  className="w-full min-h-[70px] rounded-lg border border-border bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan resize-none"
                  dir="rtl"
                />
                {/* Mention suggestions dropdown */}
                {showMentions && filteredEmployees.length > 0 && (
                  <div className="absolute bottom-full mb-1 right-0 w-full bg-card border border-border rounded-lg shadow-lg z-50 max-h-[200px] overflow-y-auto">
                    {filteredEmployees.map((emp, idx) => (
                      <button
                        key={emp.id}
                        onClick={() => insertMention(emp.name)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-right text-sm transition-colors ${
                          idx === mentionIndex ? "bg-cyan/10 text-cyan" : "text-foreground hover:bg-white/5"
                        }`}
                      >
                        <div className="w-7 h-7 rounded-full bg-amber/15 text-amber flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {emp.name.charAt(0)}
                        </div>
                        <span className="font-medium">{emp.name}</span>
                        {emp.role && <span className="text-[10px] text-muted-foreground mr-auto">{emp.role}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  onClick={handleAdd}
                  disabled={!newNote.trim() || saving}
                  size="sm"
                  className="bg-cyan hover:bg-cyan/80 text-background"
                >
                  <Send className="w-4 h-4 mx-3" />
                  {saving ? "..." : "إضافة"}
                </Button>
                <button
                  onClick={() => {
                    const textarea = textareaRef.current;
                    if (textarea) {
                      const cursor = textarea.selectionStart;
                      const before = newNote.slice(0, cursor);
                      const after = newNote.slice(cursor);
                      const needSpace = before.length > 0 && before[before.length - 1] !== " " && before[before.length - 1] !== "\n";
                      const prefix = needSpace ? " @" : "@";
                      setNewNote(before + prefix + after);
                      setMentionStart(before.length + (needSpace ? 1 : 0));
                      setShowMentions(true);
                      setMentionFilter("");
                      setTimeout(() => {
                        textarea.focus();
                        const pos = cursor + prefix.length;
                        textarea.setSelectionRange(pos, pos);
                      }, 0);
                    }
                  }}
                  className="p-1.5 rounded-md border border-amber/30 text-amber hover:bg-amber/10 transition-colors"
                  title="منشن موظف @"
                >
                  <AtSign className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Notes list */}
          <div className="flex-1 overflow-y-auto space-y-3 mt-2">
            {loading ? (
              <div className="text-center text-muted-foreground text-sm py-8">جاري التحميل...</div>
            ) : notes.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">لا توجد ملاحظات بعد</div>
            ) : (
              notes.map((n) => {
                const typeInfo = NOTE_TYPES.find((t) => t.value === n.note_type) || NOTE_TYPES[0];
                return (
                  <div key={n.id} className="p-3 rounded-lg border border-border/50 bg-card/50">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-cyan">{n.author_name}</span>
                        {n.note_type && n.note_type !== "note" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan/10 text-cyan">{typeInfo.icon} {typeInfo.label}</span>
                        )}
                      </div>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(n.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{renderNoteText(n.note)}</p>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
