export const meta = {
  name: 'dashboard-metric-tooltips',
  description: 'Add bilingual hover tooltips to every numeric indicator across all dashboard pages',
  phases: [
    { title: 'Annotate', detail: 'one agent per route wraps indicators + returns i18n keys' },
    { title: 'Shared', detail: 'one agent handles reported top-level shared components' },
    { title: 'Merge', detail: 'single agent writes all keys into en.json + ar.json' },
    { title: 'Verify', detail: 'typecheck + i18n parity + accuracy audit' },
    { title: 'Fix', detail: 'repair typecheck/accuracy issues if any' },
  ],
}

// ---------------------------------------------------------------------------
// Shared spec handed to every annotate agent so the convention is identical.
// ---------------------------------------------------------------------------
const API_SPEC = `
COMPONENT API (import from "@/components/metric-info"):
  <MetricInfo text={t("metricTooltips.<key>")} label="optional aria label" />
    → renders a small ⓘ button. Place it NEXT TO a header/column-label/metric label.
  <Explained text={t("metricTooltips.<key>")}>{theValueNode}</Explained>
    → wraps a STATIC display node (a number, %, score, badge span) and shows the
      tooltip on hover. Explained renders a <span tabindex=0 class="cursor-help">.

HARD RULES (a verifier will check these — violations get rejected):
1. NEVER place <Explained> or <MetricInfo> INSIDE an interactive element
   (<a>, <button>, <Link>, or anything with onClick). That creates a
   nested-interactive / focusable-in-focusable hydration violation.
   - If the indicator value sits inside a <Link>/<button> row, DO NOT wrap the
     value. Instead add ONE <MetricInfo> next to the SECTION HEADER or the
     COLUMN LABEL (which lives outside the interactive element) explaining that
     metric generally.
   - Only use <Explained> to wrap values that are NOT inside any interactive ancestor.
2. Tooltip text must describe the REAL computation. Before writing each text,
   open the data-layer function that produces the value (usually under
   src/lib/data/**) and base the explanation on the actual formula / source /
   thresholds. No vague filler like "this shows the value".
3. i18n: reuse the file's existing translation function + namespace.
   - Client file ('use client'): const t = useTranslations("<Namespace>")
   - Server file: const t = await getTranslations("<Namespace>")
   - If the file has neither, add the correct one for that page's namespace.
   - Nest every new key under a "metricTooltips" object inside that namespace.
   - Key names MUST be globally unique: prefix with the route, e.g.
     "metricTooltips.contracts_achievementPct".
   - Report the FULL dotted JSON path from root, e.g.
     "Contracts.metricTooltips.contracts_achievementPct".
4. DO NOT edit messages/en.json or messages/ar.json. Return the entries instead.
5. DO NOT edit anything under src/components/ui/**, src/components/metric-info.tsx,
   or any top-level src/components/*.tsx file. If a numeric indicator lives in
   such a shared file, list it under "sharedSkipped" with the file path and a
   short note — another agent will handle it.
6. Arabic text: natural RTL phrasing, and use Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩)
   for any digits, matching the existing examples in messages/ar.json.
7. A "numeric indicator" = any KPI number, stat tile, percentage, count, score,
   ratio, delta/change pill, gauge, or status badge derived from data. Wrap/annotate ALL of them.
   Plain labels, nav items, and free-text are NOT indicators.

Existing examples of the convention live in:
  src/components/executive/scores-band.tsx and
  src/components/executive/ceo-brief-card.tsx
  keys "scoreTooltips", "q1ScoreHelp", "riskHelp" in messages/en.json + ar.json.
`

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['route', 'filesEdited', 'indicatorsAnnotated', 'entries', 'sharedSkipped', 'notes'],
  properties: {
    route: { type: 'string' },
    filesEdited: { type: 'array', items: { type: 'string' } },
    indicatorsAnnotated: { type: 'number' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'en', 'ar', 'source'],
        properties: {
          path: { type: 'string', description: 'full dotted JSON path from root, e.g. Contracts.metricTooltips.contracts_achievementPct' },
          en: { type: 'string' },
          ar: { type: 'string' },
          source: { type: 'string', description: 'file:symbol the explanation is grounded in' },
        },
      },
    },
    sharedSkipped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'note'],
        properties: { file: { type: 'string' }, note: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

const ROUTES = [
  { r: 'dashboard', dirs: ['src/app/(dashboard)/dashboard', 'src/components/executive', 'src/components/activity', 'src/components/cockpit', 'src/components/department', 'src/components/dm'], extra: 'NOTE: scores-band.tsx and ceo-brief-card.tsx are ALREADY annotated — skip indicators that already have <Explained>/<MetricInfo>; cover every OTHER section component (hero-row, pulse-strip, client-health, delivery-flow, team-capacity, service-health, stuck-projects, upcoming-deadlines, wip-aging, stage-flow-matrix, top-revised, financial-summary, activity-pulse-band) AND the AnalysisStat/MiniCount tiles inside dashboard/page.tsx.' },
  { r: 'contracts', dirs: ['src/app/(dashboard)/contracts'], extra: '' },
  { r: 'accountability', dirs: ['src/app/(dashboard)/accountability'], extra: '' },
  { r: 'finance', dirs: ['src/app/(dashboard)/finance'], extra: '' },
  { r: 'reports', dirs: ['src/app/(dashboard)/reports'], extra: '' },
  { r: 'satisfaction', dirs: ['src/app/(dashboard)/satisfaction'], extra: '' },
  { r: 'projects', dirs: ['src/app/(dashboard)/projects', 'src/components/projects'], extra: '' },
  { r: 'tasks', dirs: ['src/app/(dashboard)/tasks'], extra: '' },
  { r: 'ai-insights', dirs: ['src/app/(dashboard)/ai-insights', 'src/components/ai'], extra: '' },
  { r: 'sales', dirs: ['src/app/(dashboard)/sales'], extra: '' },
  { r: 'targets', dirs: ['src/app/(dashboard)/targets'], extra: '' },
  { r: 'team-activity', dirs: ['src/app/(dashboard)/team-activity'], extra: '' },
  { r: 'hr', dirs: ['src/app/(dashboard)/hr'], extra: '' },
  { r: 'governance', dirs: ['src/app/(dashboard)/governance'], extra: '' },
  { r: 'attendance', dirs: ['src/app/(dashboard)/attendance'], extra: '' },
  { r: 'escalations', dirs: ['src/app/(dashboard)/escalations'], extra: '' },
  { r: 'warnings', dirs: ['src/app/(dashboard)/warnings'], extra: '' },
  { r: 'clients', dirs: ['src/app/(dashboard)/clients'], extra: '' },
  { r: 'handover', dirs: ['src/app/(dashboard)/handover'], extra: '' },
  { r: 'messages', dirs: ['src/app/(dashboard)/messages'], extra: '' },
  { r: 'notifications', dirs: ['src/app/(dashboard)/notifications'], extra: '' },
  { r: 'my-activities', dirs: ['src/app/(dashboard)/my-activities'], extra: '' },
  { r: 'uploads', dirs: ['src/app/(dashboard)/uploads'], extra: '' },
  { r: 'chart', dirs: ['src/app/(dashboard)/chart'], extra: '' },
  { r: 'am', dirs: ['src/app/(dashboard)/am'], extra: '' },
  { r: 'settings', dirs: ['src/app/(dashboard)/settings'], extra: '' },
  { r: 'service-categories', dirs: ['src/app/(dashboard)/service-categories'], extra: '' },
  { r: 'task-templates', dirs: ['src/app/(dashboard)/task-templates'], extra: '' },
  { r: 'governance', dirs: ['src/app/(dashboard)/governance'], extra: '' },
]

// De-dup routes (governance listed twice by accident-proofing above)
const SEEN = new Set()
const UNIQUE_ROUTES = ROUTES.filter((x) => (SEEN.has(x.r) ? false : (SEEN.add(x.r), true)))

// ---------------------------------------------------------------------------
phase('Annotate')
log(`Annotating numeric indicators across ${UNIQUE_ROUTES.length} routes`)

const annotatePrompt = (route) => `You are adding hover-tooltip "how is this computed?" affordances to EVERY numeric
indicator rendered by the **${route.r}** dashboard page.

Files you OWN and may edit (edit any .tsx under these that renders indicators):
${route.dirs.map((d) => '  - ' + d).join('\n')}
${route.extra ? '\nSPECIAL INSTRUCTIONS: ' + route.extra : ''}

Do NOT edit any file outside the owned paths above.

${API_SPEC}

WORKFLOW:
1. Read every .tsx in your owned paths. Find each numeric indicator.
2. For each indicator, open the data function that computes it (trace the prop
   back to src/lib/data/** or the server loader) so your explanation is accurate.
3. Edit the component: wrap the value with <Explained> OR add a <MetricInfo> by
   its label/header, per the HARD RULES. Import from "@/components/metric-info".
   Reference t("metricTooltips.<route>_<key>").
4. Ensure the translation hook/namespace exists in the file (add if missing).
5. Return the structured result: every new key as an entry with its FULL dotted
   JSON path, English text, Arabic text (Arabic-Indic numerals), and the
   file:symbol source you grounded it in. Set filesEdited and indicatorsAnnotated.
   If the route has no numeric indicators, return entries: [] and say so in notes.

Verify your edits compile mentally (balanced JSX, imports present). Be thorough —
the goal is that hovering ANY indicator on this page reveals how it was computed.`

const annotateResults = (await parallel(
  UNIQUE_ROUTES.map((route) => () =>
    agent(annotatePrompt(route), {
      label: `annotate:${route.r}`,
      phase: 'Annotate',
      schema: ENTRY_SCHEMA,
    }),
  ),
)).filter(Boolean)

const totalIndicators = annotateResults.reduce((s, r) => s + (r.indicatorsAnnotated || 0), 0)
log(`Annotated ~${totalIndicators} indicators; collecting shared-component reports`)

// ---------------------------------------------------------------------------
phase('Shared')
const sharedReports = annotateResults.flatMap((r) =>
  (r.sharedSkipped || []).map((s) => ({ ...s, fromRoute: r.route })),
)

let sharedResult = null
if (sharedReports.length > 0) {
  const sharedPrompt = `Other agents reported numeric indicators living in TOP-LEVEL shared components
that they were not allowed to edit. Annotate those now. Reported files:

${sharedReports.map((s) => `  - ${s.file} (from ${s.fromRoute}): ${s.note}`).join('\n')}

${API_SPEC}

Edit ONLY the reported top-level shared files (src/components/*.tsx). Use a
"metricTooltips.shared_<key>" prefix. Trace each value to its data source for an
accurate explanation. Return the same structured result (route="shared").`

  sharedResult = await agent(sharedPrompt, { label: 'annotate:shared', phase: 'Shared', schema: ENTRY_SCHEMA })
} else {
  log('No shared-component indicators were reported.')
}

// ---------------------------------------------------------------------------
phase('Merge')
const allEntries = [
  ...annotateResults.flatMap((r) => r.entries || []),
  ...(sharedResult?.entries || []),
]
log(`Merging ${allEntries.length} bilingual keys into en.json + ar.json`)

const MERGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['enAdded', 'arAdded', 'collisions', 'jsonValid', 'notes'],
  properties: {
    enAdded: { type: 'number' },
    arAdded: { type: 'number' },
    collisions: { type: 'array', items: { type: 'string' } },
    jsonValid: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const mergeResult = await agent(
  `Insert these tooltip translation keys into BOTH messages/en.json and
messages/ar.json. Each entry has a full dotted path from the JSON root.

For en.json set the value at <path> to the entry's "en".
For ar.json set the value at <path> to the entry's "ar".
Deep-create intermediate objects ("metricTooltips" etc.) as needed. If a path
already exists with DIFFERENT text, do NOT overwrite — record it in "collisions".
Preserve the files' existing formatting/indentation and key ordering as much as
possible. After writing, JSON.parse both files to confirm they are valid (set
jsonValid). Report how many keys you added to each file.

ENTRIES (JSON):
${JSON.stringify(allEntries)}`,
  { label: 'merge:i18n', phase: 'Merge', schema: MERGE_SCHEMA },
)

// ---------------------------------------------------------------------------
phase('Verify')
const addedPaths = allEntries.map((e) => e.path)

const TYPECHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'errorCount', 'errors'],
  properties: {
    passed: { type: 'boolean' },
    errorCount: { type: 'number' },
    errors: { type: 'array', items: { type: 'string' }, description: 'file:line: message for each error (cap at 50)' },
  },
}

const PARITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['missingInEn', 'missingInAr', 'jsonValid'],
  properties: {
    missingInEn: { type: 'array', items: { type: 'string' } },
    missingInAr: { type: 'array', items: { type: 'string' } },
    jsonValid: { type: 'boolean' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checked', 'inaccurate'],
  properties: {
    checked: { type: 'number' },
    inaccurate: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'problem'],
        properties: { path: { type: 'string' }, problem: { type: 'string' } },
      },
    },
  },
}

// Sample up to 18 entries spread across routes for an accuracy audit.
const sample = []
const step = Math.max(1, Math.floor(allEntries.length / 18))
for (let i = 0; i < allEntries.length && sample.length < 18; i += step) sample.push(allEntries[i])

const [typecheck, parity, audit] = await parallel([
  () =>
    agent(
      `Run a TypeScript typecheck to confirm the tooltip edits compile. From the
project root run: bunx tsc --noEmit -p tsconfig.json (timeout generous). Report
whether it passed, the error count, and up to 50 "file:line: message" errors.
Focus on errors plausibly caused by the new <Explained>/<MetricInfo> JSX, missing
imports, or translation-hook additions.`,
      { label: 'verify:typecheck', phase: 'Verify', schema: TYPECHECK_SCHEMA },
    ),
  () =>
    agent(
      `Verify i18n parity. Read messages/en.json and messages/ar.json (JSON.parse
both — report jsonValid=false if either fails). For each of these dotted paths,
confirm it resolves to a non-empty string in BOTH files. Return any paths missing
from en (missingInEn) or ar (missingInAr).

PATHS (JSON):
${JSON.stringify(addedPaths)}`,
      { label: 'verify:parity', phase: 'Verify', schema: PARITY_SCHEMA },
    ),
  () =>
    agent(
      `Adversarial accuracy audit. For each entry below, open its "source"
file:symbol and the data function behind it, then judge whether the English
explanation ACCURATELY describes the real computation (formula, source, thresholds).
Be skeptical — flag anything vague, wrong, or unverifiable. Return only the
inaccurate ones with a short "problem".

ENTRIES (JSON):
${JSON.stringify(sample.map((e) => ({ path: e.path, en: e.en, source: e.source })))}`,
      { label: 'verify:accuracy', phase: 'Verify', schema: AUDIT_SCHEMA },
    ),
])

// ---------------------------------------------------------------------------
phase('Fix')
let fixResult = null
const needTypeFix = typecheck && !typecheck.passed && typecheck.errorCount > 0
const needParityFix = parity && ((parity.missingInEn?.length || 0) + (parity.missingInAr?.length || 0) > 0)
const needAccFix = audit && (audit.inaccurate?.length || 0) > 0

if (needTypeFix || needParityFix || needAccFix) {
  log(`Fixing: ${needTypeFix ? typecheck.errorCount + ' type errors; ' : ''}${needParityFix ? 'i18n parity gaps; ' : ''}${needAccFix ? audit.inaccurate.length + ' inaccurate texts' : ''}`)
  const fixPrompt = `Repair the following issues from the tooltip rollout. Make minimal, correct edits.
${needTypeFix ? `\nTYPECHECK ERRORS:\n${typecheck.errors.join('\n')}` : ''}
${needParityFix ? `\nI18N PARITY GAPS — add these paths (with correct en/ar text; Arabic-Indic numerals) to the file(s) where missing:\nmissingInEn: ${JSON.stringify(parity.missingInEn)}\nmissingInAr: ${JSON.stringify(parity.missingInAr)}` : ''}
${needAccFix ? `\nINACCURATE EXPLANATIONS — rewrite these keys in messages/en.json AND messages/ar.json to match the real computation (read the source first):\n${audit.inaccurate.map((x) => `  - ${x.path}: ${x.problem}`).join('\n')}` : ''}

After editing, JSON.parse messages/en.json and messages/ar.json to confirm validity.
Return a short summary of what you changed.`
  fixResult = await agent(fixPrompt, { label: 'fix:issues', phase: 'Fix' })
} else {
  log('Verification clean — no fixes needed.')
}

return {
  routesProcessed: UNIQUE_ROUTES.length,
  totalIndicators,
  keysMerged: allEntries.length,
  shared: sharedResult ? { files: sharedResult.filesEdited, keys: sharedResult.entries.length } : null,
  merge: mergeResult,
  verify: {
    typecheck: typecheck && { passed: typecheck.passed, errorCount: typecheck.errorCount },
    parity: parity && { missingInEn: parity.missingInEn, missingInAr: parity.missingInAr, jsonValid: parity.jsonValid },
    accuracy: audit && { checked: audit.checked, inaccurate: audit.inaccurate },
  },
  fixed: Boolean(fixResult),
  fixSummary: fixResult,
}
