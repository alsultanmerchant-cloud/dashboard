import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { CeoBriefData } from "./data";
import { formatSar } from "./data";

// =========================================================================
// CEO brief cards — server-rendered PNGs (satori via next/og, no headless
// browser). Satori has no bidi algorithm: it shapes Arabic glyphs correctly
// but lays out space-separated words LEFT-to-right, reversing phrase order.
// Every Arabic phrase therefore renders through <Ar/>, which splits the
// phrase into word tokens inside a row-reverse flex container (visually
// correct RTL, digits stay LTR within their token). Avoid parentheses in
// card copy — bracket glyphs don't mirror.
// =========================================================================

const W = 1080;
const H = 1350;

const BG = "#0b1020";
const PANEL = "rgba(255,255,255,0.045)";
const BORDER = "rgba(148,163,184,0.18)";
const TEXT = "#e2e8f0";
const MUTED = "#94a3b8";
const CYAN = "#22d3ee";
const GREEN = "#34d399";
const AMBER = "#fbbf24";
const RED = "#f87171";
const VIOLET = "#a78bfa";

let fontsPromise: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 | 800 }[]> | null = null;
function loadFonts() {
  fontsPromise ??= Promise.all(
    (
      [
        ["Tajawal-Regular.ttf", 400],
        ["Tajawal-Bold.ttf", 700],
        ["Tajawal-ExtraBold.ttf", 800],
      ] as const
    ).map(async ([file, weight]) => ({
      name: "Tajawal",
      data: (await readFile(path.join(process.cwd(), "src/lib/brief/fonts", file)))
        .buffer as ArrayBuffer,
      weight,
    })),
  );
  return fontsPromise;
}

async function toPng(node: React.ReactElement): Promise<Buffer> {
  const res = new ImageResponse(node, { width: W, height: H, fonts: await loadFonts() });
  return Buffer.from(await res.arrayBuffer());
}

const scoreColor = (s: number) => (s >= 70 ? GREEN : s >= 55 ? CYAN : s >= 40 ? AMBER : RED);

// RTL phrase: satori has no bidi, so it lays space-separated words LTR.
// Reversing the word order in a single text node makes the visual order
// read correctly right-to-left with natural spacing. Keep card copy short
// enough not to wrap — wrapped lines would come out in reversed order.
function Ar({
  text,
  size,
  weight = 400,
  color = TEXT,
  align = "right",
}: {
  text: string;
  size: number;
  weight?: 400 | 700 | 800;
  color?: string;
  align?: "right" | "center" | "left";
}) {
  // NBSP-join: satori segments on regular spaces and lays the segments LTR
  // with broken gaps; joining with U+00A0 keeps the whole phrase one shaped
  // run, so the text engine handles RTL order and spacing itself. Satori has
  // no bidi though, so digit groups INSIDE the run scramble their Arabic
  // neighbours — digits are split out as LTR tokens laid row-reverse.
  const visual = text.trim().split(/\s+/).join("\u00A0");
  const textStyle = {
    fontSize: size,
    fontWeight: weight,
    color,
    lineHeight: 1.35,
  } as const;
  const segments = visual.split(/(\d[\d,.:%]*)/).filter(Boolean);
  if (segments.length === 1) {
    return <div style={{ ...textStyle, textAlign: align }}>{visual}</div>;
  }
  const justify =
    align === "center" ? "center" : align === "left" ? "flex-end" : "flex-start";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        alignItems: "baseline",
        justifyContent: justify,
        columnGap: Math.round(size * 0.26),
      }}
    >
      {segments.map((s, i) => (
        <div key={i} style={textStyle}>
          {s.replace(/^\u00A0+|\u00A0+$/g, "")}
        </div>
      ))}
    </div>
  );
}

function Shell({
  title,
  subtitle,
  date,
  accent,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  date: string;
  accent: string;
  children: React.ReactNode;
  footer: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        backgroundImage:
          "radial-gradient(900px 500px at 85% -10%, rgba(167,139,250,0.16), transparent), radial-gradient(700px 420px at 10% 110%, rgba(34,211,238,0.12), transparent)",
        padding: "56px 60px",
        fontFamily: "Tajawal",
        color: TEXT,
      }}
    >
      {/* header — title block on the right, brand chip on the left */}
      <div style={{ display: "flex", flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <Ar text={title} size={52} weight={800} />
          <div style={{ display: "flex", marginTop: 6 }}>
            <Ar text={subtitle} size={28} color={MUTED} />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            padding: "14px 26px",
            borderRadius: 18,
            backgroundColor: PANEL,
            border: `1px solid ${BORDER}`,
          }}
        >
          <Ar text="سكاي لايت" size={30} weight={800} color={accent} />
          <div style={{ display: "flex", marginTop: 2 }}>
            <Ar text={date} size={22} color={MUTED} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", height: 3, backgroundColor: accent, opacity: 0.65, borderRadius: 2, margin: "36px 0" }} />

      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>{children}</div>

      <div style={{ display: "flex", flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 28 }}>
        <Ar text={footer} size={22} color={MUTED} />
        <Ar text="غرفة القيادة Rawasm" size={22} color={MUTED} />
      </div>
    </div>
  );
}

// ---- Card 1: executive scores ---------------------------------------------

export async function renderScoresCard(d: CeoBriefData): Promise<Buffer> {
  return toPng(
    <Shell
      title="المؤشرات التنفيذية"
      subtitle="نبض الشركة في خمسة أرقام"
      date={d.dateLabel}
      accent={CYAN}
      footer="محسوبة من بيانات التشغيل الفعلية لآخر 30 يومًا"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {d.scores.map((s) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              alignItems: "center",
              backgroundColor: PANEL,
              border: `1px solid ${BORDER}`,
              borderRadius: 22,
              padding: "26px 34px",
            }}
          >
            {/* right: label */}
            <div style={{ display: "flex", width: 420 }}>
              <Ar text={s.label} size={36} weight={700} />
            </div>
            {/* middle: delta (optional) */}
            <div style={{ display: "flex", flexGrow: 1, justifyContent: "center" }}>
              {s.delta !== null && s.delta !== 0 ? (
                <div
                  style={{
                    display: "flex",
                    fontSize: 26,
                    fontWeight: 700,
                    color: s.delta > 0 ? GREEN : RED,
                  }}
                >
                  {s.delta > 0 ? `▲ +${Math.round(s.delta)}` : `▼ ${Math.round(s.delta)}`}
                </div>
              ) : null}
            </div>
            {/* left: grade + score */}
            <div
              style={{
                display: "flex",
                width: 86,
                height: 86,
                borderRadius: 43,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 40,
                fontWeight: 800,
                color: "#0b1020",
                backgroundColor: scoreColor(s.score),
              }}
            >
              {s.grade}
            </div>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 800, color: scoreColor(s.score), width: 170, justifyContent: "center" }}>
              {s.score}%
            </div>
          </div>
        ))}
      </div>
    </Shell>,
  );
}

// ---- Card 2: accountability ------------------------------------------------

export async function renderPeopleCard(d: CeoBriefData): Promise<Buffer> {
  return toPng(
    <Shell
      title="المساءلة"
      subtitle="من يحتاج وقفة هذا الأسبوع"
      date={d.dateLabel}
      accent={AMBER}
      footer="مبنية على سجل المراحل والمواعيد، والتفاصيل في صفحة المساءلة"
    >
      <div style={{ display: "flex", marginBottom: 18 }}>
        <Ar
          text={`أدنى التزام بالمواعيد عبر الشركة، ${d.overdueTotal} مهمة متأخرة حاليًا`}
          size={30}
          weight={700}
          color={AMBER}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {d.people.map((p) => (
          <div
            key={p.name}
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              alignItems: "center",
              backgroundColor: PANEL,
              border: `1px solid ${BORDER}`,
              borderRadius: 18,
              padding: "20px 30px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexGrow: 1 }}>
              <Ar text={p.name} size={32} weight={700} />
              <Ar text={p.roleLabel} size={22} color={MUTED} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 170 }}>
              <Ar text="متأخرات" size={24} color={MUTED} align="center" />
              <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: p.overdue > 0 ? RED : GREEN }}>
                {String(p.overdue)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 170 }}>
              <Ar text="الدرجة" size={24} color={MUTED} align="center" />
              <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: scoreColor(p.score ?? 0) }}>
                {p.score ?? 0}%
              </div>
            </div>
          </div>
        ))}
      </div>

      {d.reviewers.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
          <div style={{ display: "flex", marginBottom: 14 }}>
            <Ar
              text="مراجعات تحتاج تدقيقًا، تمرير سريع ثم رجوع من العميل"
              size={30}
              weight={700}
              color={VIOLET}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {d.reviewers.map((r) => (
              <div
                key={r.name}
                style={{
                  display: "flex",
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  backgroundColor: "rgba(167,139,250,0.08)",
                  border: `1px solid rgba(167,139,250,0.25)`,
                  borderRadius: 16,
                  padding: "16px 28px",
                }}
              >
                <div style={{ display: "flex", flexGrow: 1, justifyContent: "flex-end" }}>
                  <Ar text={r.name} size={30} weight={700} />
                </div>
                <div style={{ display: "flex", marginLeft: 24 }}>
                  <Ar text={`${r.reviews} مراجعة`} size={26} color={MUTED} />
                </div>
                <Ar text={`رجوع ${Math.round(r.reworkPct ?? 0)}%`} size={30} weight={800} color={AMBER} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>,
  );
}

// ---- Card 3: money -----------------------------------------------------------

export async function renderMoneyCard(d: CeoBriefData): Promise<Buffer> {
  const m = d.money;
  const blocks = [
    {
      label: "عقود تستحق التجديد خلال 30 يومًا",
      big: String(m.renew30Count),
      sub: `بقيمة ${formatSar(m.renew30Value)}`,
      color: CYAN,
    },
    {
      label: "دفعات متأخرة التحصيل",
      big: String(m.overdueInstallments),
      sub: `بقيمة ${formatSar(m.overdueValue)}`,
      color: RED,
    },
    {
      label: "المحصَّل فعليًا هذا الشهر",
      big: formatSar(m.paidThisMonth),
      sub: "من الدفعات المسجلة",
      color: GREEN,
    },
  ];
  return toPng(
    <Shell
      title="المال والعقود"
      subtitle="ما يستحق المتابعة المالية اليوم"
      date={d.dateLabel}
      accent={GREEN}
      footer="المصدر سجل العقود والدفعات، والتفاصيل في صفحة العقود"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 30, justifyContent: "center", flexGrow: 1 }}>
        {blocks.map((b) => (
          <div
            key={b.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              backgroundColor: PANEL,
              border: `1px solid ${BORDER}`,
              borderRadius: 24,
              padding: "38px 42px",
            }}
          >
            <Ar text={b.label} size={32} weight={700} color={MUTED} />
            <div style={{ display: "flex", flexDirection: "row-reverse", alignItems: "baseline", marginTop: 10, columnGap: 22 }}>
              <Ar text={b.big} size={76} weight={800} color={b.color} />
              <Ar text={b.sub} size={32} />
            </div>
          </div>
        ))}
      </div>
    </Shell>,
  );
}

export async function renderAllCards(d: CeoBriefData): Promise<{ name: string; png: Buffer }[]> {
  // Sequential — satori + resvg are CPU-bound; parallel rendering just
  // fragments the same core.
  return [
    { name: "scores", png: await renderScoresCard(d) },
    { name: "people", png: await renderPeopleCard(d) },
    { name: "money", png: await renderMoneyCard(d) },
  ];
}
