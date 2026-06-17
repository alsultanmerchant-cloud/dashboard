// Parser for the Sky Light sheet's PRE-COMPUTED dashboard tabs.
//
// Unlike excel-parser.ts (which reads the raw contract/installment rows so we can
// re-derive numbers), this reads the three tabs the sheet itself computes for the
// currently-selected month, so the dashboard can mirror them verbatim:
//
//   "CEO_Dashboared"        — the headline tiles (income, movement, account/sales
//                             department splits, on-target / overdue counts)
//   "TARGET_CONTRACTS"      — the per-contract bucket lists (on-target / overdue /
//                             renewed / lost) behind the count tiles
//   "Acc_Target_Breakdown"  — the per-account-manager target rollup
//
// The sheet only ever shows ONE month at a time (a dropdown). We read which month
// that is from the tabs and freeze the numbers under it; switching the sheet's
// dropdown and re-pulling captures a different month. Layout is anchored on label
// TEXT (not absolute cell coordinates) so small row shifts in the sheet don't break
// parsing; when an anchor can't be found we emit a warning and leave that field 0.

import "server-only";

export type Aoa = unknown[][];

export type SheetDashboardTotals = {
  // Income
  total_expected: number;
  total_actual: number;
  // Account department
  acc_exp_overdue_inst: number;
  acc_exp_inst: number;
  acc_exp_ontarget: number;
  acc_exp_overdue_clients: number;
  acc_expected: number;
  acc_act_sd_renewed: number;
  acc_act_inst: number;
  acc_act_ontarget: number;
  acc_act_overdue_clients: number;
  acc_actual: number;
  acc_upsell: number;
  acc_winback: number;
  acc_gap: number;
  // Sales department
  sales_exp_overdue_inst: number;
  sales_exp_inst: number;
  sales_expected: number;
  sales_act_inst: number;
  sales_upsell: number;
  sales_new_income: number;
  sales_total_income: number;
  sales_gap: number;
  // Movement (this month)
  mov_new: number;
  mov_renewed: number;
  mov_lost: number;
  mov_upsell: number;
  mov_winback: number;
  mov_closed: number;
  // Client status overview (point-in-time roster) — the sheet's top strip.
  cnt_total_clients: number;
  cnt_roster_new: number;
  cnt_roster_renew: number;
  cnt_roster_hold: number;
  cnt_roster_upsell: number;
  cnt_roster_winback: number;
  cnt_on_target: number;
  cnt_overdue: number;
  cnt_sales_deposit: number;
};

export type SheetBucketRow = {
  // on_target/overdue/renewed/lost = the Monthly-Target buckets (left of the tab).
  // acc_inst_*/sales_inst_* = the "Clients with Installments" lists (right of the
  // tab), split by collecting department. *_overdue = the Overdue sub-column;
  // *_expected = the Expected (due-this-month) sub-column. Both carry the amount.
  bucket:
    | "on_target"
    | "overdue"
    | "renewed"
    | "lost"
    | "acc_inst_overdue"
    | "sales_inst_overdue"
    | "acc_inst_expected"
    | "sales_inst_expected";
  contractKey: string;
  clientName: string | null;
  value: number;
};

export type SheetAmRow = {
  name: string; // raw sheet name (with emoji/stars)
  expected: number;
  achieved: number;
  // TEAM_TARGET rollup (right side of the tab). Present only on team-leader
  // (🌟) and department-manager rows; null for plain account managers.
  teamExpected: number | null;
  teamAchieved: number | null;
  teamRole: "team_lead" | "dept_manager" | null;
};

export type SheetDashboardParse = {
  monthIso: string | null; // YYYY-MM-01
  totals: SheetDashboardTotals;
  buckets: SheetBucketRow[];
  amRows: SheetAmRow[];
  warnings: string[];
};

// ── helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  // strip thousands separators, currency, %, spaces, RTL marks
  const n = Number(
    String(v)
      .replace(/[,\s٪%]/g, "")
      .replace(/[^\d.+-]/g, ""),
  );
  return Number.isFinite(n) ? n : 0;
}

// Normalize a label cell for matching: drop emoji/symbols/diacritics, collapse
// whitespace, lower-case. Keeps Arabic + Latin letters and digits only.
function normLabel(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/[ً-ْٰ]/g, "") // Arabic diacritics
    .replace(/[‎‏‪-‮]/g, "") // bidi marks
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // emoji/symbols/punct → space
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const KEY_RE = /^C\d+\s*\|\s*\d{6,8}$/i;
function asKey(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return KEY_RE.test(s) ? s.replace(/\s+/g, "") : null;
}
function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

/** First [row,col] in [r0,r1) whose normalized cell matches `re`. */
function findRC(
  grid: Aoa,
  re: RegExp,
  r0 = 0,
  r1 = grid.length,
): [number, number] | null {
  for (let r = r0; r < Math.min(r1, grid.length); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (re.test(normLabel(row[c]))) return [r, c];
    }
  }
  return null;
}

function cellNum(grid: Aoa, r: number, c: number): number {
  return num(grid[r]?.[c]);
}

/**
 * Read a "label row → value row directly below" block. Within [r0,r1), find the
 * row that matches the MOST field regexes (the label row), then for each field
 * read the value in the cell one row below its label column.
 */
function readBlock(
  grid: Aoa,
  fields: Record<string, RegExp>,
  r0: number,
  r1: number,
): { values: Record<string, number>; found: boolean; labelRow: number } {
  const keys = Object.keys(fields);
  let bestRow = -1;
  let bestScore = 0;
  for (let r = r0; r < Math.min(r1, grid.length); r++) {
    const row = grid[r] ?? [];
    const labels = row.map(normLabel);
    let score = 0;
    for (const k of keys) if (labels.some((l) => fields[k].test(l))) score++;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  const values: Record<string, number> = {};
  for (const k of keys) values[k] = 0;
  if (bestRow < 0 || bestScore === 0) {
    return { values, found: false, labelRow: -1 };
  }
  const row = grid[bestRow] ?? [];
  const labels = row.map(normLabel);
  for (const k of keys) {
    const c = labels.findIndex((l) => fields[k].test(l));
    if (c >= 0) values[k] = cellNum(grid, bestRow + 1, c);
  }
  return { values, found: true, labelRow: bestRow };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// ── CEO_Dashboared ─────────────────────────────────────────────────────────

function parseCeo(grid: Aoa, warnings: string[]): {
  monthIso: string | null;
  totals: SheetDashboardTotals;
} {
  const t: SheetDashboardTotals = {
    total_expected: 0, total_actual: 0,
    acc_exp_overdue_inst: 0, acc_exp_inst: 0, acc_exp_ontarget: 0,
    acc_exp_overdue_clients: 0, acc_expected: 0,
    acc_act_sd_renewed: 0, acc_act_inst: 0, acc_act_ontarget: 0,
    acc_act_overdue_clients: 0, acc_actual: 0, acc_upsell: 0, acc_winback: 0,
    acc_gap: 0,
    sales_exp_overdue_inst: 0, sales_exp_inst: 0, sales_expected: 0,
    sales_act_inst: 0, sales_upsell: 0, sales_new_income: 0,
    sales_total_income: 0, sales_gap: 0,
    mov_new: 0, mov_renewed: 0, mov_lost: 0, mov_upsell: 0,
    mov_winback: 0, mov_closed: 0,
    cnt_total_clients: 0, cnt_roster_new: 0, cnt_roster_renew: 0,
    cnt_roster_hold: 0, cnt_roster_upsell: 0, cnt_roster_winback: 0,
    cnt_on_target: 0, cnt_overdue: 0, cnt_sales_deposit: 0,
  };

  // Month: "Month:" → value to the right; "Year:" → value to the right.
  let monthIso: string | null = null;
  const mRC = findRC(grid, /^month$/);
  const yRC = findRC(grid, /^year$/);
  if (mRC) {
    const rawMonth = asText(grid[mRC[0]]?.[mRC[1] + 1]);
    const monNum = rawMonth ? MONTHS[rawMonth.slice(0, 3).toLowerCase()] : undefined;
    const year = yRC ? num(grid[yRC[0]]?.[yRC[1] + 1]) : 0;
    if (monNum && year > 2000) {
      monthIso = `${year}-${String(monNum).padStart(2, "0")}-01`;
    }
  }
  if (!monthIso) warnings.push("CEO: could not read the selected month from the sheet.");

  // Client status overview (roster) — value directly below each label.
  const roster = readBlock(
    grid,
    {
      cnt_new: /new contracts/,
      cnt_renew: /renewed clien|on going renewed/,
      cnt_hold: /^hold$/,
      cnt_total: /total clients/,
    },
    0,
    14,
  );
  t.cnt_total_clients = roster.values.cnt_total ?? 0;
  t.cnt_roster_new = roster.values.cnt_new ?? 0;
  t.cnt_roster_renew = roster.values.cnt_renew ?? 0;
  t.cnt_roster_hold = roster.values.cnt_hold ?? 0;
  // UPSELL / Win-Back sit in a second label row of the same overview block.
  const roster2 = readBlock(
    grid,
    { up: /upsell contracts/, wb: /win.?back contracts/ },
    0,
    14,
  );
  t.cnt_roster_upsell = roster2.values.up ?? 0;
  t.cnt_roster_winback = roster2.values.wb ?? 0;

  // Income: same-row label → value (to the right).
  const teRC = findRC(grid, /total expected income/);
  if (teRC) t.total_expected = cellNum(grid, teRC[0], teRC[1] + 1);
  const taRC = findRC(grid, /total actual income/);
  if (taRC) t.total_actual = cellNum(grid, taRC[0], taRC[1] + 1);

  // Movement window — between "Contracts Movement" and "Company INCOME".
  const movStart = findRC(grid, /contracts movement/)?.[0] ?? 0;
  const incStart = findRC(grid, /company income/)?.[0] ?? movStart + 8;
  const mov1 = readBlock(
    grid,
    { mov_new: /^new$/, mov_renewed: /^renewed$/, mov_lost: /^lost$/, mov_upsell: /^upsell$/ },
    movStart,
    incStart,
  );
  t.mov_new = mov1.values.mov_new ?? 0;
  t.mov_renewed = mov1.values.mov_renewed ?? 0;
  t.mov_lost = mov1.values.mov_lost ?? 0;
  t.mov_upsell = mov1.values.mov_upsell ?? 0;
  const mov2 = readBlock(
    grid,
    { mov_winback: /win back/, mov_closed: /^closed$/ },
    movStart,
    incStart,
  );
  t.mov_winback = mov2.values.mov_winback ?? 0;
  t.mov_closed = mov2.values.mov_closed ?? 0;

  // Account vs Sales windows.
  const accStart = findRC(grid, /account m section|account m\b/)?.[0] ?? incStart;
  const salesStart = findRC(grid, /^sales section$|sales section/, accStart + 1)?.[0]
    ?? grid.length;

  // Account count tiles (Sales Deposit / On Target / Overdue).
  const accTiles = readBlock(
    grid,
    { sd: /sales deposit/, on: /^on target$/, ov: /^overdue$/ },
    accStart,
    salesStart,
  );
  t.cnt_sales_deposit = accTiles.values.sd ?? 0;
  t.cnt_on_target = accTiles.values.on ?? 0;
  t.cnt_overdue = accTiles.values.ov ?? 0;

  // Account expected breakdown.
  const accExp = readBlock(
    grid,
    {
      oi: /overdue installments/,
      inst: /^installments$/,
      on: /on target clients/,
      ov: /overdue clients/,
      tot: /total expected/,
    },
    accStart,
    salesStart,
  );
  t.acc_exp_overdue_inst = accExp.values.oi ?? 0;
  t.acc_exp_inst = accExp.values.inst ?? 0;
  t.acc_exp_ontarget = accExp.values.on ?? 0;
  t.acc_exp_overdue_clients = accExp.values.ov ?? 0;
  t.acc_expected = accExp.values.tot ?? 0;

  // Account actual breakdown (label row contains "S.D & Renewed").
  const accAct = readBlock(
    grid,
    {
      sd: /s d.*renewed|renewed/,
      inst: /^installments$/,
      on: /on target clients/,
      ov: /overdue clients/,
    },
    accExp.labelRow >= 0 ? accExp.labelRow + 1 : accStart,
    salesStart,
  );
  t.acc_act_sd_renewed = accAct.values.sd ?? 0;
  t.acc_act_inst = accAct.values.inst ?? 0;
  t.acc_act_ontarget = accAct.values.on ?? 0;
  t.acc_act_overdue_clients = accAct.values.ov ?? 0;

  // Account actual TOTAL sits two rows below the "Total Income from Account" label.
  const accActTotRC = findRC(grid, /total income from account/, accStart, salesStart);
  if (accActTotRC) t.acc_actual = cellNum(grid, accActTotRC[0] + 2, accActTotRC[1]);

  // Account upsell / winback / gap.
  const accUp = readBlock(
    grid,
    { up: /upsell.*acc/, wb: /win back/, gap: /revenue gap/ },
    accStart,
    salesStart,
  );
  t.acc_upsell = accUp.values.up ?? 0;
  t.acc_winback = accUp.values.wb ?? 0;
  t.acc_gap = accUp.values.gap ?? 0;

  // Sales expected breakdown.
  const salesExp = readBlock(
    grid,
    {
      oi: /overdue installments/,
      ei: /expected installments/,
      tot: /total expected/,
      ai: /actual installments/,
      gap: /^gap$/,
    },
    salesStart,
    grid.length,
  );
  t.sales_exp_overdue_inst = salesExp.values.oi ?? 0;
  t.sales_exp_inst = salesExp.values.ei ?? 0;
  t.sales_expected = salesExp.values.tot ?? 0;
  t.sales_act_inst = salesExp.values.ai ?? 0;
  t.sales_gap = salesExp.values.gap ?? 0;

  // Sales upsell / new income / total income.
  const salesAct = readBlock(
    grid,
    {
      up: /upsell.*sales/,
      ni: /actual income from new/,
      ti: /total income from sales/,
    },
    salesExp.labelRow >= 0 ? salesExp.labelRow + 1 : salesStart,
    grid.length,
  );
  t.sales_upsell = salesAct.values.up ?? 0;
  t.sales_new_income = salesAct.values.ni ?? 0;
  t.sales_total_income = salesAct.values.ti ?? 0;

  if (!accExp.found) warnings.push("CEO: account-expected block not found.");
  if (!salesExp.found) warnings.push("CEO: sales-expected block not found.");

  return { monthIso, totals: t };
}

// ── TARGET_CONTRACTS (per-contract buckets) ───────────────────────────────────

function parseTargetContracts(grid: Aoa, warnings: string[]): SheetBucketRow[] {
  // Locate the header row that labels the four bucket columns, then read each
  // block's (key, client, value) by the column of its header.
  const headerRow = findRC(grid, /^on target$|on target/)?.[0] ?? -1;
  // Column anchors come from the bucket header labels.
  const hdr = (grid[headerRow] ?? []).map(normLabel);
  const colOf = (re: RegExp) => hdr.findIndex((l) => re.test(l));
  const onCol = colOf(/^on target$|on target/);
  const ovCol = colOf(/^overdue$|overdue/);
  const reCol = colOf(/renewed from target/);
  const loCol = colOf(/lost from target/);

  if (headerRow < 0 || onCol < 0) {
    warnings.push("TARGET_CONTRACTS: bucket header row not found.");
    return [];
  }

  const rows: SheetBucketRow[] = [];
  const take = (
    bucket: SheetBucketRow["bucket"],
    keyCol: number,
    hasValue: boolean,
  ) => {
    if (keyCol < 0) return;
    for (let r = headerRow + 1; r < grid.length; r++) {
      const key = asKey(grid[r]?.[keyCol]);
      if (!key) continue;
      rows.push({
        bucket,
        contractKey: key,
        clientName: asText(grid[r]?.[keyCol + 1]),
        value: hasValue ? num(grid[r]?.[keyCol + 2]) : 0,
      });
    }
  };
  take("on_target", onCol, true);
  take("overdue", ovCol, true);
  take("renewed", reCol, false);
  take("lost", loCol, false);

  // ── "Clients with Installments" region (right side of the same tab) ──────────
  // A super-header row (one above the bucket header) carries two banners:
  // "Clients with Installments (FROM ACCOUNT)" and "(FROM SALES)". Under each,
  // the bucket header row has Expected / Overdue / Actual-paid sub-columns. We
  // surface the OVERDUE lists per department. Account overdue carries an amount
  // (key, name, value); Sales overdue is name-only (key, name).
  const superRow = headerRow - 1;
  const superCols: number[] = [];
  const superLabels = (grid[superRow] ?? []).map(normLabel);
  for (let c = 0; c < superLabels.length; c++) {
    if (/clients with installments/.test(superLabels[c])) superCols.push(c);
  }
  if (superCols.length >= 1) {
    const accLo = superCols[0];
    const accHi = superCols[1] ?? hdr.length;
    const salesLo = superCols[1] ?? hdr.length;
    const salesHi = hdr.length;
    const findColIn = (re: RegExp, lo: number, hi: number) => {
      for (let c = lo; c < hi; c++) if (re.test(hdr[c] ?? "")) return c;
      return -1;
    };
    const accOvCol = findColIn(/overdue/, accLo, accHi);
    const salesOvCol = findColIn(/overdue/, salesLo, salesHi);
    take("acc_inst_overdue", accOvCol, true);
    take("sales_inst_overdue", salesOvCol, false);
    // Expected (due-this-month) sub-column, same region. Both departments carry
    // an amount here, so capture the value for each.
    const accExpCol = findColIn(/expected/, accLo, accHi);
    const salesExpCol = findColIn(/expected/, salesLo, salesHi);
    take("acc_inst_expected", accExpCol, true);
    take("sales_inst_expected", salesExpCol, true);
  } else {
    warnings.push("TARGET_CONTRACTS: installments region not found.");
  }

  return rows;
}

// ── Acc_Target_Breakdown (per-AM) ─────────────────────────────────────────────

function parseAccBreakdown(grid: Aoa, warnings: string[]): SheetAmRow[] {
  // Header row labels the columns; per-AM rows follow.
  const headerRow = findRC(grid, /^account$/)?.[0] ?? -1;
  if (headerRow < 0) {
    warnings.push("Acc_Target_Breakdown: header row not found.");
    return [];
  }
  const hdr = (grid[headerRow] ?? []).map(normLabel);
  const nameCol = hdr.findIndex((l) => /^account$/.test(l));
  const expCol = hdr.findIndex((l) => /total expected/.test(l));
  const achCol = hdr.findIndex((l) => /actual achieved/.test(l));
  // TEAM_TARGET sub-headers are exactly "Expected" / "Achieved" (distinct from
  // "Total Expected" / "Actual Achieved" on the individual side).
  const teamExpCol = hdr.findIndex((l) => l === "expected");
  const teamAchCol = hdr.findIndex((l) => l === "achieved");
  if (nameCol < 0 || expCol < 0) {
    warnings.push("Acc_Target_Breakdown: name/expected columns not found.");
    return [];
  }

  const out: SheetAmRow[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const name = asText(grid[r]?.[nameCol]);
    if (!name) continue;
    // A non-empty TEAM_TARGET Expected cell marks a leader / dept-manager row.
    // 🌟 in the raw name = team leader; a team row without the star = the
    // department manager (blank individual target, whole-department rollup).
    const teamExpRaw = teamExpCol >= 0 ? grid[r]?.[teamExpCol] : null;
    const hasTeam =
      teamExpRaw !== null && teamExpRaw !== undefined && String(teamExpRaw).trim() !== "";
    const isLead = /\u{1F31F}/u.test(name);
    out.push({
      name,
      expected: num(grid[r]?.[expCol]),
      achieved: achCol >= 0 ? num(grid[r]?.[achCol]) : 0,
      teamExpected: hasTeam ? num(teamExpRaw) : null,
      teamAchieved: hasTeam && teamAchCol >= 0 ? num(grid[r]?.[teamAchCol]) : null,
      teamRole: hasTeam ? (isLead ? "team_lead" : "dept_manager") : null,
    });
  }
  return out;
}

// ── main ───────────────────────────────────────────────────────────────────

export function parseSheetDashboard({
  ceo,
  target,
  accBreak,
}: {
  ceo: Aoa;
  target: Aoa;
  accBreak: Aoa;
}): SheetDashboardParse {
  const warnings: string[] = [];
  const { monthIso, totals } = parseCeo(ceo, warnings);
  const buckets = parseTargetContracts(target, warnings);
  const amRows = parseAccBreakdown(accBreak, warnings);
  return { monthIso, totals, buckets, amRows, warnings };
}
