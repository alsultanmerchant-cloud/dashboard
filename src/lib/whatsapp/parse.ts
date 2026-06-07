// WhatsApp chat-export (.txt) parser.
//
// Supports both iOS bracket format:
//   [23/04/2026, 3:45:26 PM] Sender Name: message
// and Android dash format:
//   23/04/2026, 15:45 - Sender Name: message
//
// WhatsApp prefixes system notifications and media placeholders with a U+200E
// (LRM) control char right after the "Sender: " — we use that, plus a set of
// known phrases, to drop everything that isn't a real human message. Messages
// can span multiple lines; continuation lines have no header and are appended.

const LRM = "‎";
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

// iOS: [d/m/yyyy, h:mm[:ss] AM/PM] Sender: body
const IOS_HEADER =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\]\s*([^:]+?):\s?([\s\S]*)$/;
// Android: d/m/yyyy, HH:mm[ AM/PM] - Sender: body
const ANDROID_HEADER =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\s*-\s*([^:]+?):\s?([\s\S]*)$/;

// System / non-conversational message bodies (after stripping bidi marks).
const SYSTEM_PATTERNS: RegExp[] = [
  /Messages and calls are end-to-end encrypted/i,
  /created group/i,
  /created the group/i,
  /added you/i,
  / added /i,
  / left$/i,
  / removed /i,
  /changed the group description/i,
  /changed this group's icon/i,
  /changed the subject/i,
  /changed their phone number/i,
  /joined using (this|a) group('s)? invite link/i,
  /joined using a group link/i,
  /You're now an admin/i,
  /now an admin/i,
  /turned on admin approval/i,
  /pinned a message/i,
  /This message was deleted/i,
  /You deleted this message/i,
  /<Media omitted>/i,
  /image omitted/i,
  /video omitted/i,
  /audio omitted/i,
  /sticker omitted/i,
  /GIF omitted/i,
  /document omitted/i,
  /Contact card omitted/i,
  /^<attached:/i,
  /‎audio omitted/i,
];

export interface ChatMessage {
  iso: string | null; // ISO timestamp (UTC assumption) or null if unparseable
  sender: string;
  body: string;
  isSystem: boolean;
}

export interface ParsedChat {
  messages: ChatMessage[]; // human messages only
  messageCount: number;
  participantCount: number;
  participants: string[];
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  transcript: string; // cleaned "[iso] sender: body" lines, human only
}

function toIso(
  d: string,
  mo: string,
  y: string,
  h: string,
  mi: string,
  s: string | undefined,
  ap: string | undefined,
): string | null {
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  let hour = parseInt(h, 10);
  if (ap) {
    const upper = ap.toUpperCase();
    if (upper === "PM" && hour < 12) hour += 12;
    if (upper === "AM" && hour === 12) hour = 0;
  }
  const day = parseInt(d, 10);
  const month = parseInt(mo, 10);
  const min = parseInt(mi, 10);
  const sec = s ? parseInt(s, 10) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stripBidi(s: string): string {
  return s.replace(BIDI, "").trim();
}

function isSystemBody(rawBody: string): boolean {
  // The raw body still has the leading LRM for system/media lines.
  const leadsWithLrm = rawBody.startsWith(LRM);
  const clean = stripBidi(rawBody);
  if (!clean) return true;
  if (leadsWithLrm && SYSTEM_PATTERNS.some((re) => re.test(clean))) return true;
  if (SYSTEM_PATTERNS.some((re) => re.test(clean))) return true;
  return false;
}

export function parseWhatsAppChat(raw: string): ParsedChat {
  // Normalise newlines; strip a possible BOM.
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  type Raw = { iso: string | null; sender: string; body: string };
  const all: Raw[] = [];
  let current: Raw | null = null;

  for (const line of lines) {
    const m = IOS_HEADER.exec(line) ?? ANDROID_HEADER.exec(line);
    if (m) {
      if (current) all.push(current);
      const [, d, mo, y, h, mi, s, ap, sender, body] = m;
      current = {
        iso: toIso(d, mo, y, h, mi, s, ap),
        sender: stripBidi(sender),
        body,
      };
    } else if (current) {
      current.body += "\n" + line;
    }
    // lines before the first header (rare) are ignored
  }
  if (current) all.push(current);

  const messages: ChatMessage[] = [];
  const participants = new Set<string>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const r of all) {
    const sys = isSystemBody(r.body);
    const body = stripBidi(r.body);
    if (sys || !body) continue;
    messages.push({ iso: r.iso, sender: r.sender, body, isSystem: false });
    participants.add(r.sender);
    if (r.iso) {
      if (!firstAt || r.iso < firstAt) firstAt = r.iso;
      if (!lastAt || r.iso > lastAt) lastAt = r.iso;
    }
  }

  const transcript = messages
    .map((m) => `[${m.iso ? m.iso.slice(0, 16).replace("T", " ") : "?"}] ${m.sender}: ${m.body}`)
    .join("\n");

  return {
    messages,
    messageCount: messages.length,
    participantCount: participants.size,
    participants: Array.from(participants),
    firstMessageAt: firstAt,
    lastMessageAt: lastAt,
    transcript,
  };
}
