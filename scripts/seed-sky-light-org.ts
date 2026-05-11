#!/usr/bin/env bun
// Seed Sky Light's org structure as captured in "Sky light organization 2.pdf".
//
// What this does (idempotent — safe to re-run):
//   1. Upserts every department in PDF_TREE into public.departments
//      keyed on (organization_id, slug). Sets `kind` per leaf.
//   2. Wires parent_department_id so the hierarchy renders correctly on
//      /organization/chart.
//   3. For every employee whose Arabic full_name matches one we listed in
//      the tree, updates employee_profiles.job_title + department_id.
//   4. Stamps department.head_employee_id for the explicit "HEAD: …" rows.
//   5. Inserts department_team_leads rows for every "Team leader: …".
//
// Names where we couldn't confidently match the DB row are listed at the
// end so you (or the team) can fill in arName later.
//
// Usage: bun run scripts/seed-sky-light-org.ts [org-slug]

import { supabaseAdmin } from "@/lib/supabase/admin";

const slug = process.argv[2] || process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "rawasm-demo";

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();
if (!org) {
  console.error(`org ${slug} not found`);
  process.exit(1);
}
const orgId = org.id as string;
console.log(`[seed-org] target org: ${slug} (${orgId})`);

// =========================================================================
// PDF tree — transcribed from "Sky light organization 2.pdf"
// =========================================================================
type Person = {
  pdfName: string;
  /** Arabic full_name as it appears in employee_profiles.full_name. */
  arName: string | null;
  title?: string;
};
type Team = {
  leaderTitle: string;
  leader: Person;
  members: Person[];
  /** Default job_title applied to members when their `title` is unset. */
  memberTitle: string;
};
type Dept = {
  slug: string;
  /** Arabic name shown on /organization/chart. */
  name: string;
  kind:
    | "group"
    | "account_management"
    | "main_section"
    | "supporting_section"
    | "quality_control"
    | "other";
  parentSlug?: string;
  head?: Person;
  members?: Person[];
  /** Default title for plain members of this department. */
  memberTitle?: string;
  teams?: Team[];
};

const PDF_TREE: Dept[] = [
  // Top group nodes (kind=group, no employees attached directly).
  { slug: "technical-section", name: "القسم التقني", kind: "group" },
  { slug: "technical-main", name: "القسم الأساسي", kind: "group", parentSlug: "technical-section" },
  { slug: "technical-supporting", name: "القسم المساند", kind: "group", parentSlug: "technical-section" },
  { slug: "sales-group", name: "إدارة المبيعات", kind: "group" },
  { slug: "administration", name: "الإدارة", kind: "group" },

  // ----- Technical / Quality control -----
  {
    slug: "quality-control",
    name: "ضبط الجودة",
    kind: "quality_control",
    parentSlug: "technical-section",
    head: { pdfName: "Gihad", arName: "جهاد رمضان", title: "Head of Quality Control" },
    memberTitle: "Quality Control Specialist",
    members: [{ pdfName: "Menna Ibrahim", arName: "منة ابراهيم" }],
  },

  // ----- Main section -----
  {
    slug: "account-management",
    name: "إدارة الحسابات",
    kind: "account_management",
    parentSlug: "technical-main",
    head: { pdfName: "Aya Khafagy", arName: "اية خفاجي", title: "Head of Account Management" },
    memberTitle: "Account Manager",
    teams: [
      {
        leaderTitle: "Account Manager — Team Leader",
        leader: { pdfName: "Shaimaa", arName: "شيماء هيثم" },
        memberTitle: "Account Manager",
        members: [
          { pdfName: "Bassant", arName: "بسنت محمد الصلب" },
          { pdfName: "Sally", arName: "سالي محمد" },
        ],
      },
      {
        leaderTitle: "Account Manager — Team Leader",
        leader: { pdfName: "Sara", arName: "سارة الامين" },
        memberTitle: "Account Manager",
        members: [{ pdfName: "Basmala", arName: "بسملة محمد" }],
      },
      {
        leaderTitle: "Account Manager — Team Leader",
        leader: { pdfName: "Aya Reda", arName: "اية رضا" },
        memberTitle: "Account Manager",
        members: [{ pdfName: "Dina Elhoseiny", arName: "دينا الحسيني" }],
      },
    ],
  },
  {
    // Correction: SEO box in the PDF lists only Hassan as Head. Eatimad +
    // Shrouq + Zyad Heji are in Social Content / Programming (see below) —
    // they were mis-attached here in the earlier seed.
    slug: "seo",
    name: "السيو (SEO)",
    kind: "main_section",
    parentSlug: "technical-main",
    head: { pdfName: "Hassan", arName: "حسن ياسر", title: "Head of SEO" },
    memberTitle: "SEO Specialist",
  },
  {
    slug: "social-media",
    name: "السوشيال ميديا",
    kind: "main_section",
    parentSlug: "technical-main",
    head: { pdfName: "Hala Fathi", arName: "الاء فتحي", title: "Head of Social Media" },
    memberTitle: "Social Media Specialist",
    members: [
      { pdfName: "Gannah Ahmed", arName: "جنة احمد" },
      { pdfName: "Nour Mashaal", arName: "نور مشعل" },
    ],
  },
  {
    slug: "media-buying",
    name: "الميديا (الحملات الإعلانية)",
    kind: "main_section",
    parentSlug: "technical-main",
    head: { pdfName: "Ashraf Mokhtar", arName: "اشرف مختار", title: "Head of Media Buying" },
    memberTitle: "Media Buying Specialist",
    members: [
      { pdfName: "Zakaria", arName: "محمد زكريا", title: "Co-Head of Media Buying" },
      { pdfName: "Asmaa", arName: "اسما صلاح" },
    ],
  },

  // ----- Supporting section -----
  // Correction: zoomed PDF view shows Programming has only Zyad Heji.
  // Yehya Alaa and Dina Singab are actually under Art Direction / Graphic.
  {
    slug: "programming",
    name: "البرمجة",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    memberTitle: "Software Engineer",
    members: [
      { pdfName: "Zyad Heji", arName: "زياد حجي" },
    ],
  },
  // Correction: Social Content (Head: Nouf) actually has 3 members shown
  // in the PDF — Ghazi, Eatimad, Shrouq. Ghazi was previously mis-listed
  // under Management Floor.
  {
    slug: "social-content",
    name: "محتوى السوشيال",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    head: { pdfName: "Nouf", arName: "نوف العتيبي", title: "Head of Social Content" },
    memberTitle: "Social Content Writer",
    members: [
      { pdfName: "Ghazi", arName: "غازي العتيبي" },
      { pdfName: "Eatimad", arName: "اعتماد مصطفي" },
      { pdfName: "Shrouq", arName: "شروق سليمان" },
    ],
  },
  {
    slug: "seo-content",
    name: "محتوى السيو",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    head: { pdfName: "Mohamed Adel", arName: "محمد عادل", title: "Head of SEO Content" },
    memberTitle: "SEO Content Writer",
  },
  // Art Direction Designs (Head: Mohamed Heji) — restructured to match the
  // zoomed PDF view: the department has 5 sub-tracks (UI / Graphic / Motion /
  // Video Editing / AI Videos) modelled here as their own child departments.
  // Previously I had speculative team-leader groups under it (Nagham, Haneen,
  // Mona, Mariam Shaaban, Ahmed Mohsen, Rawan Mansour) — those people are
  // visible elsewhere in the PDF the user said, but not in this zoom. They
  // get cleared by RESET_NAMES below so they don't show wrong data.
  {
    slug: "art-direction-designs",
    name: "الإخراج الفني والتصميمات",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    head: { pdfName: "Mohamed Heji", arName: "محمد حجي", title: "Head of Art Direction" },
    memberTitle: "Designer",
  },
  {
    slug: "art-ui",
    name: "UI",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "UI Designer",
    members: [
      { pdfName: "Hager Tarek", arName: "هاجر طارق" },
    ],
  },
  {
    slug: "art-graphic",
    name: "Graphic",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "Graphic Designer",
    members: [
      { pdfName: "Dina Singab", arName: "دينا سنجاب" },
      { pdfName: "Yehya Alaa", arName: "يحيى علاء" },
      { pdfName: "Ahmed Mahmoud", arName: "احمد محمود" },
      { pdfName: "Mohamed Yousri", arName: "محمد يسري" },
      { pdfName: "Bola Tharwat", arName: "بولا ثروت" },
      // Mohamed Reda + Foash visible in the PDF — no confident DB match yet,
      // leave them off until the team confirms which row they map to.
    ],
  },
  {
    slug: "art-motion",
    name: "Motion",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "Motion Designer",
    members: [
      { pdfName: "Mohamed Tamer", arName: "محمد تامر" },
      // Mahmoud Eltohamy visible but no DB match.
    ],
  },
  {
    slug: "art-video-editing",
    name: "Video Editing",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "Video Editor",
    // Ali / Gasser visible but no confident DB match.
  },
  {
    slug: "art-ai-videos",
    name: "AI Videos",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "AI Video Specialist",
    // Anes / Walid visible but no confident DB match.
  },
  {
    slug: "moderation",
    name: "المشرفون",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    memberTitle: "Moderator",
    members: [
      { pdfName: "Smaa Mosbah", arName: "سماء مصباح" },
      { pdfName: "Fatima (Any desk)", arName: "فاطمة حسن", title: "Any Desk Specialist" },
    ],
  },
  {
    slug: "public-relationships",
    name: "العلاقات العامة",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    memberTitle: "PR Specialist",
    members: [{ pdfName: "Nermeen Gamal", arName: "نرمين جمال" }],
    teams: [
      {
        leaderTitle: "PR Team Leader",
        leader: { pdfName: "Ammar", arName: "عمار ياسر" },
        memberTitle: "PR Specialist",
        members: [{ pdfName: "Mohammed Habib", arName: "محمد حبيب" }],
      },
    ],
  },

  // ----- Sales -----
  {
    slug: "sales-team",
    name: "المبيعات",
    kind: "main_section",
    parentSlug: "sales-group",
    head: { pdfName: "El Shaer", arName: "محمد الشاعر", title: "Head of Sales" },
    memberTitle: "Sales Agent",
  },
  {
    slug: "telesales",
    name: "البيع الهاتفي",
    kind: "main_section",
    parentSlug: "sales-group",
    head: { pdfName: "Rania", arName: "رانيا عبدالعزيز", title: "Head of Telesales" },
    memberTitle: "Telesales Agent",
  },

  // ----- Administration -----
  {
    slug: "hr-department",
    name: "الموارد البشرية",
    kind: "other",
    parentSlug: "administration",
    head: { pdfName: "Magdy", arName: "مجدي محمد", title: "Head of HR" },
    memberTitle: "HR Specialist",
    members: [
      { pdfName: "Jelan", arName: "چيلان محمود" },
      { pdfName: "Gamila", arName: "جميلة محمود" },
    ],
  },
  {
    slug: "accountant",
    name: "المحاسبة",
    kind: "other",
    parentSlug: "administration",
    head: { pdfName: "Salah", arName: "صلاح حسونة", title: "Head of Accounting" },
    memberTitle: "Accountant",
  },
  {
    slug: "management-floor",
    name: "إدارة الموقع",
    kind: "other",
    parentSlug: "administration",
    memberTitle: "Operations Staff",
    members: [
      { pdfName: "Mennatullah Yasser", arName: "منة الله العربي", title: "Receptionist" },
      // Correction: Ghazi is in Social Content per the PDF zoomed view, not
      // Management Floor — see the social-content entry above.
    ],
  },
];

// =========================================================================
// 1. Build full_name → employee_profiles.id (+ user_id) lookup.
// =========================================================================
const { data: empRows } = await supabaseAdmin
  .from("employee_profiles")
  .select("id, full_name, user_id")
  .eq("organization_id", orgId);

const empByName = new Map<string, { id: string; user_id: string | null }>();
for (const e of empRows ?? []) {
  empByName.set(((e as { full_name: string }).full_name ?? "").trim(), {
    id: (e as { id: string }).id,
    user_id: (e as { user_id: string | null }).user_id ?? null,
  });
}
console.log(`[seed-org] loaded ${empByName.size} employee_profiles`);

// =========================================================================
// 1b. RESET — clear department_id + job_title for people whose earlier
// (speculative) assignment is now known to be wrong. The zoomed PDF view
// the team shared shows the Supporting section's Art Direction Designs
// sub-tracks are UI / Graphic / Motion / Video Editing / AI Videos, and the
// names below were not visible inside any of them. Until the team confirms
// where they actually belong, leave them unassigned rather than display a
// wrong title on their task cards.
// =========================================================================
const RESET_NAMES = [
  // Speculative "team leader" rows from the earlier seed.
  "نغم محمد",        // Nagham
  "حنين حسين",       // Haneen
  "هاجر السروي",    // Hager (designs)
  "مني  أبو سليمان", // Mona
  "مريم شعبان",      // Mariam Shaaban
  "احمد محسن",       // Ahmed Mohsen
  "روان محسن",       // Rawan Mansour (best-guess match)
  // Members previously placed under those speculative teams.
  "ياسر محمد",       // Yasser Khalaf (UI / Nagham)
  "وليد احمد",       // Waleed (UI / Nagham)
  "امل صالح",        // aml (UI / Nagham)
  "نسمه المنصوري",  // Nesma (Graphic / Haneen)
  "ساره عابد",       // Sara (Graphic / Haneen)
  "ميرنا جمال",      // Merna Gamal (Haneen)
  "نوران أيمن",      // Nouran (Hager)
  "ايمن مجدي",       // Ayman (Hager)
  "اسراء اسامه",    // Esraa Osama (Mona)
  "هبة النجار",      // Heba Elnaggar (Mariam Shaaban)
  "هبة قباري",       // Heba Adel (Ahmed Mohsen)
  "عبدالله غيث",     // Abdullah Ghaith (Ahmed Mohsen)
  "انس محمد",        // Anas Algenedy (Ahmed Mohsen)
  "حسام محمد",       // Hossam Mohamed (Ahmed Mohsen)
  "محمد حبيب",       // Ahmed Mohamed Habib (Ahmed Mohsen)
  "ادهم احمد",       // Adham Mohamed (Ahmed Mohsen)
  "محمد مسلماني",    // Almoslmany (Ahmed Mohsen)
  "فدوى امير",       // Fadwa (Rawan Mansour)
  "سميره الطوبجي",  // Samira (Rawan Mansour)
  "يارا صبرى",       // Yara (Rawan Mansour)
  "دنيا احمد",       // Donia (Art Direction loose member, not in zoomed view)
  "سلمي تامر",       // Salma (Art Direction loose member, not in zoomed view)
];

let resetCount = 0;
for (const name of RESET_NAMES) {
  const emp = empByName.get(name.trim());
  if (!emp) continue;
  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ department_id: null, job_title: null })
    .eq("id", emp.id);
  if (!error) resetCount += 1;
}
console.log(`[seed-org] reset dept+title on ${resetCount}/${RESET_NAMES.length} previously-speculative rows`);

// =========================================================================
// 2. Upsert every department by slug — pass 1 (no parent_department_id).
// =========================================================================
const deptIdBySlug = new Map<string, string>();
for (const d of PDF_TREE) {
  const { data, error } = await supabaseAdmin
    .from("departments")
    .upsert(
      {
        organization_id: orgId,
        slug: d.slug,
        name: d.name,
        kind: d.kind,
      },
      { onConflict: "organization_id,slug" },
    )
    .select("id")
    .single();
  if (error) {
    console.error(`dept ${d.slug}: ${error.message}`);
    continue;
  }
  deptIdBySlug.set(d.slug, data.id as string);
}
console.log(`[seed-org] upserted ${deptIdBySlug.size} departments`);

// Pass 2: parent_department_id.
for (const d of PDF_TREE) {
  if (!d.parentSlug) continue;
  const id = deptIdBySlug.get(d.slug);
  const parentId = deptIdBySlug.get(d.parentSlug);
  if (!id || !parentId) continue;
  await supabaseAdmin
    .from("departments")
    .update({ parent_department_id: parentId })
    .eq("id", id);
}

// =========================================================================
// 3. For every person in the tree → update employee_profiles.
// =========================================================================
const unmatched: string[] = [];
const updates: Array<{ pdfName: string; empId: string; deptSlug: string; title: string }> = [];

const queueUpdate = (person: Person, deptSlug: string, fallbackTitle: string) => {
  if (!person.arName) {
    unmatched.push(`${person.pdfName} (${deptSlug})`);
    return;
  }
  const emp = empByName.get(person.arName.trim());
  if (!emp) {
    unmatched.push(`${person.pdfName} → "${person.arName}" not in DB (${deptSlug})`);
    return;
  }
  updates.push({
    pdfName: person.pdfName,
    empId: emp.id,
    deptSlug,
    title: person.title ?? fallbackTitle,
  });
};

for (const d of PDF_TREE) {
  if (d.head) queueUpdate(d.head, d.slug, d.head.title ?? `Head of ${d.name}`);
  for (const m of d.members ?? []) {
    queueUpdate(m, d.slug, m.title ?? d.memberTitle ?? "Team Member");
  }
  for (const team of d.teams ?? []) {
    queueUpdate(team.leader, d.slug, team.leaderTitle);
    for (const m of team.members) {
      queueUpdate(m, d.slug, m.title ?? team.memberTitle ?? d.memberTitle ?? "Team Member");
    }
  }
}

let applied = 0;
for (const u of updates) {
  const deptId = deptIdBySlug.get(u.deptSlug)!;
  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ department_id: deptId, job_title: u.title })
    .eq("id", u.empId);
  if (error) {
    console.warn(`[${u.pdfName}] ${error.message}`);
    continue;
  }
  applied += 1;
}
console.log(`[seed-org] updated ${applied}/${updates.length} employees with dept+title`);

// =========================================================================
// 4. department.head_employee_id (HEAD: rows).
// =========================================================================
let headCount = 0;
for (const d of PDF_TREE) {
  if (!d.head?.arName) continue;
  const emp = empByName.get(d.head.arName.trim());
  if (!emp) continue;
  const deptId = deptIdBySlug.get(d.slug);
  if (!deptId) continue;
  const { error } = await supabaseAdmin
    .from("departments")
    .update({ head_employee_id: emp.id })
    .eq("id", deptId);
  if (!error) headCount += 1;
}
console.log(`[seed-org] wired ${headCount} department heads`);

// =========================================================================
// 5. department_team_leads (Team leader: rows). Needs a user_id, so we
//    skip team leaders whose employee_profile has no auth user yet.
// =========================================================================
let leadCount = 0, leadSkipped = 0;
for (const d of PDF_TREE) {
  for (const team of d.teams ?? []) {
    if (!team.leader.arName) continue;
    const emp = empByName.get(team.leader.arName.trim());
    if (!emp) continue;
    const deptId = deptIdBySlug.get(d.slug);
    if (!deptId) continue;
    if (!emp.user_id) { leadSkipped += 1; continue; }
    const { error } = await supabaseAdmin
      .from("department_team_leads")
      .upsert(
        { department_id: deptId, user_id: emp.user_id },
        { onConflict: "department_id,user_id" },
      );
    if (error) {
      console.warn(`leader ${team.leader.pdfName}: ${error.message}`);
      continue;
    }
    leadCount += 1;
  }
}
console.log(`[seed-org] wired ${leadCount} team-lead rows (${leadSkipped} skipped — no auth user_id)`);

// =========================================================================
// Report unmatched.
// =========================================================================
if (unmatched.length) {
  console.log("\n[seed-org] unmatched names (need an arName mapping):");
  for (const m of unmatched) console.log(`  - ${m}`);
}

console.log("\n[seed-org] done.");
