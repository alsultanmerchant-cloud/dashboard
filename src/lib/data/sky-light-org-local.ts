import "server-only";
import type { OrgChart, OrgDepartment, OrgEmployee } from "./org-chart";

type DeptKind =
  | "group"
  | "account_management"
  | "main_section"
  | "supporting_section"
  | "quality_control"
  | "other";

type PersonSeed = {
  pdfName: string;
  arName: string | null;
  title?: string;
};

type TeamSeed = {
  leaderTitle: string;
  leader: PersonSeed;
  members: PersonSeed[];
  memberTitle: string;
};

type DeptSeed = {
  slug: string;
  name: string;
  kind: DeptKind;
  parentSlug?: string;
  head?: PersonSeed;
  members?: PersonSeed[];
  memberTitle?: string;
  teams?: TeamSeed[];
};

const PDF_TREE: DeptSeed[] = [
  {
    slug: "sl-ceo",
    name: "Founder & CEO",
    kind: "group",
    head: { pdfName: "Mohammed Alsultan", arName: null, title: "Founder & CEO" },
    members: [{ pdfName: "Mahmoud Kamal", arName: null }],
  },
  {
    slug: "assistance",
    name: "Assistance",
    kind: "other",
    parentSlug: "sl-ceo",
    memberTitle: "Assistant",
    members: [
      { pdfName: "Abdelrahman", arName: null },
      { pdfName: "Dina", arName: null },
      { pdfName: "Eman", arName: null },
    ],
  },
  { slug: "technical-section", name: "القسم التقني", kind: "group", parentSlug: "sl-ceo" },
  { slug: "technical-main", name: "القسم الأساسي", kind: "group", parentSlug: "technical-section" },
  { slug: "technical-supporting", name: "القسم المساند", kind: "group", parentSlug: "technical-section" },
  { slug: "sales-group", name: "إدارة المبيعات", kind: "group", parentSlug: "sl-ceo" },
  { slug: "administration", name: "الإدارة", kind: "group", parentSlug: "sl-ceo" },
  {
    slug: "quality-control",
    name: "ضبط الجودة",
    kind: "quality_control",
    parentSlug: "technical-section",
    head: { pdfName: "Gihad", arName: "جهاد رمضان", title: "Head of Quality Control" },
    memberTitle: "Quality Control Specialist",
    members: [{ pdfName: "Menna Ibrahim", arName: "منة ابراهيم" }],
  },
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
        leader: { pdfName: "Sara", arName: "سارة الامين" },
        memberTitle: "Account Manager",
        members: [
          { pdfName: "Bassant", arName: "بسنت محمد الصلب" },
          { pdfName: "Hager", arName: null },
        ],
      },
      {
        leaderTitle: "Account Manager — Team Leader",
        leader: { pdfName: "Aya Reda", arName: "اية رضا" },
        memberTitle: "Account Manager",
        members: [{ pdfName: "Basmala", arName: "بسملة محمد" }],
      },
      {
        leaderTitle: "Account Manager — Team Leader",
        leader: { pdfName: "Shaimaa", arName: "شيماء هيثم" },
        memberTitle: "Account Manager",
        members: [
          { pdfName: "Bassant", arName: "بسنت محمد الصلب" },
          { pdfName: "Kareem", arName: null },
          { pdfName: "Sally", arName: "سالي محمد" },
          { pdfName: "Hager", arName: null },
        ],
      },
    ],
    members: [
      { pdfName: "Donia", arName: "دنيا احمد" },
      { pdfName: "Salma", arName: "سلمي تامر" },
      { pdfName: "Any desk Fatima", arName: "فاطمة حسن", title: "Any desk" },
    ],
  },
  {
    slug: "public-relationships",
    name: "العلاقات العامة",
    kind: "main_section",
    parentSlug: "technical-main",
    head: { pdfName: "Aya Reda", arName: "اية رضا", title: "Head of Public Relationships" },
    memberTitle: "PR Specialist",
    members: [
      { pdfName: "Donia", arName: "دنيا احمد" },
      { pdfName: "Salma", arName: "سلمي تامر" },
      { pdfName: "Fatima", arName: "فاطمة حسن", title: "Any desk" },
    ],
  },
  {
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
  {
    slug: "programming",
    name: "البرمجة",
    kind: "supporting_section",
    parentSlug: "technical-supporting",
    memberTitle: "Software Engineer",
    members: [{ pdfName: "Zyad Heji", arName: "زياد حجي" }],
  },
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
    members: [{ pdfName: "Hager Tarek", arName: "هاجر طارق" }],
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
      { pdfName: "Foash", arName: null },
      { pdfName: "Ahmed Mahmoud", arName: "احمد محمود" },
      { pdfName: "Mohamed Yousri", arName: "محمد يسري" },
      { pdfName: "Bola Tharwat", arName: "بولا ثروت" },
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
      { pdfName: "Mohamed Reda", arName: null },
      { pdfName: "Mahmoud Eltohamy", arName: null },
    ],
  },
  {
    slug: "art-video-editing",
    name: "Video Editing",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "Video Editor",
    members: [{ pdfName: "Ali Gasser", arName: null }],
  },
  {
    slug: "art-ai-videos",
    name: "AI Videos",
    kind: "supporting_section",
    parentSlug: "art-direction-designs",
    memberTitle: "AI Video Specialist",
    members: [
      { pdfName: "Anes", arName: null },
      { pdfName: "Walid", arName: null },
    ],
  },
  {
    slug: "moderation",
    name: "Moderator",
    kind: "main_section",
    parentSlug: "technical-main",
    memberTitle: "Moderator",
    members: [
      { pdfName: "Smaa Mosbah", arName: "سماء مصباح" },
      { pdfName: "Mada", arName: null },
    ],
  },
  {
    slug: "sales-team",
    name: "المبيعات",
    kind: "main_section",
    parentSlug: "sales-group",
    head: { pdfName: "El Shaer", arName: "محمد الشاعر", title: "Head of Sales" },
    memberTitle: "Sales Agent",
    teams: [
      {
        leaderTitle: "Sales Team Leader",
        leader: { pdfName: "Nagham", arName: "نغم محمد" },
        memberTitle: "Sales Agent",
        members: [
          { pdfName: "Yasser Khalaf", arName: "ياسر محمد" },
          { pdfName: "Waleed", arName: "وليد احمد" },
          { pdfName: "aml", arName: "امل صالح" },
          { pdfName: "Mahmoud saad abdallatif", arName: null },
        ],
      },
    ],
    members: [
      { pdfName: "Esraa Awad", arName: "اسراء عوض" },
      { pdfName: "Abd Alelah", arName: null },
    ],
  },
  {
    slug: "telesales",
    name: "البيع الهاتفي",
    kind: "main_section",
    parentSlug: "sales-group",
    head: { pdfName: "Rania", arName: "رانيا عبدالعزيز", title: "Head of Telesales" },
    memberTitle: "Telesales Agent",
    teams: [
      {
        leaderTitle: "Telesales Team Leader",
        leader: { pdfName: "Haneen", arName: "حنين حسين" },
        memberTitle: "Telesales Agent",
        members: [
          { pdfName: "Mariam", arName: null },
          { pdfName: "Nesma", arName: "نسمه المنصوري" },
          { pdfName: "Sara", arName: "ساره عابد" },
          { pdfName: "Eman", arName: null },
        ],
      },
    ],
    members: [
      { pdfName: "Alaa", arName: null },
      { pdfName: "Samira", arName: "سميره الطوبجي" },
      { pdfName: "Yara", arName: "يارا صبرى" },
    ],
  },
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
    members: [{ pdfName: "Ammar", arName: "عمار ياسر" }],
  },
  {
    slug: "management-floor",
    name: "إدارة الموقع",
    kind: "other",
    parentSlug: "administration",
    memberTitle: "Operations Staff",
    members: [
      { pdfName: "Mohahmed Mahmoud", arName: null, title: "Floor Supervisor" },
      { pdfName: "Mennatullah Yasser", arName: "منة الله العربي", title: "Receptionist" },
      { pdfName: "Om Aya", arName: null },
      { pdfName: "Dina Walid", arName: null },
    ],
  },
];

function makeLocalEmployee(
  person: PersonSeed,
  departmentId: string,
  role: string,
  uniqueKey: string,
): OrgEmployee {
  const fullName = person.arName?.trim() || person.pdfName;
  return {
    id: `local:${departmentId}:${uniqueKey}:${role}`,
    user_id: null,
    full_name: fullName,
    job_title: person.title ?? null,
    email: null,
    position: role,
    department_id: departmentId,
    manager_employee_id: null,
    employment_status: "active",
  };
}

export function buildLocalSkyLightOrgChart(): OrgChart {
  const byId = new Map<string, OrgDepartment>();
  const roots: OrgDepartment[] = [];
  const employees: OrgEmployee[] = [];
  const employeeSeq = new Map<string, number>();

  const nextEmployeeKey = (departmentId: string, person: PersonSeed, role: string) => {
    const base = `${departmentId}:${person.arName?.trim() || person.pdfName.trim()}:${role}`;
    const seq = employeeSeq.get(base) ?? 0;
    employeeSeq.set(base, seq + 1);
    return `${base}:${seq}`;
  };

  for (const seed of PDF_TREE) {
    const dept: OrgDepartment = {
      id: `local:${seed.slug}`,
      name: seed.name,
      slug: seed.slug,
      description: "مخطط محلي من ملف PDF المرجعي",
      kind: seed.kind,
      parent_department_id: seed.parentSlug ? `local:${seed.parentSlug}` : null,
      head_employee_id: seed.head ? `local:head:${seed.slug}` : null,
      head: null,
      teamLeads: [],
      members: [],
      children: [],
    };
    byId.set(dept.id, dept);
  }

  for (const seed of PDF_TREE) {
    const deptId = `local:${seed.slug}`;
    const dept = byId.get(deptId);
    if (!dept) continue;

    if (seed.head) {
      const head = makeLocalEmployee(
        { ...seed.head, title: seed.head.title ?? `Head of ${seed.name}` },
        deptId,
        "head",
        nextEmployeeKey(deptId, seed.head, "head"),
      );
      head.id = `local:head:${seed.slug}`;
      dept.head = head;
      dept.head_employee_id = head.id;
      employees.push(head);
    }

    for (const team of seed.teams ?? []) {
      const lead = makeLocalEmployee(
        { ...team.leader, title: team.leader.title ?? team.leaderTitle },
        deptId,
        "team_lead",
        nextEmployeeKey(deptId, team.leader, "team_lead"),
      );
      dept.teamLeads.push(lead);
      employees.push(lead);
      for (const member of team.members) {
        const emp = makeLocalEmployee(
          { ...member, title: member.title ?? team.memberTitle },
          deptId,
          "agent",
          nextEmployeeKey(deptId, member, "agent"),
        );
        emp.manager_employee_id = lead.id;
        dept.members.push(emp);
        employees.push(emp);
      }
    }

    for (const member of seed.members ?? []) {
      const emp = makeLocalEmployee(
        { ...member, title: member.title ?? seed.memberTitle ?? "Team Member" },
        deptId,
        "agent",
        nextEmployeeKey(deptId, member, "agent"),
      );
      dept.members.push(emp);
      employees.push(emp);
    }
  }

  for (const dept of byId.values()) {
    if (!dept.parent_department_id) {
      roots.push(dept);
      continue;
    }
    const parent = byId.get(dept.parent_department_id);
    if (parent) parent.children.push(dept);
    else roots.push(dept);
  }

  return { byId, roots, employees };
}

export function shouldUseLocalSkyLightOrgChart(chart: OrgChart) {
  const hasRealRoot =
    chart.byId.size > 0 &&
    Array.from(chart.byId.values()).some((dept) => dept.slug === "sl-ceo" || dept.slug === "technical-section");
  return !hasRealRoot || chart.byId.size < 8;
}
