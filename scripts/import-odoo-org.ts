#!/usr/bin/env bun
// import-odoo-org.ts — Phase T1 Odoo → Supabase organization importer.
//
// READ-ONLY against Odoo. Reads the live `res.users` (≈110 records),
// classifies each by Odoo group membership:
//
//   * `manager-group` (rwasem_security.group_manager, ≈28 members)
//       → suggested position = team_lead
//   * `member-group`  (rwasem_security.group_member,  ≈39 members)
//       → suggested position = agent
//   * Anyone else → position is left blank for human review.
//
// We DO NOT auto-write the position column. Output is a CSV at
// tmp/org-import-review.csv that the owner reviews before running the
// real assignment pass via `setEmployeePosition` in the UI.
//
// Usage: bun run scripts/import-odoo-org.ts

import fs from "node:fs";
import path from "node:path";
import { odooFromEnv, OdooClient } from "../src/lib/odoo/client";

type OdooUser = {
  id: number;
  name: string;
  login: string;
  email: string | false;
  partner_id: [number, string] | false;
  groups_id: number[];
  active: boolean;
};

type OdooGroup = {
  id: number;
  name: string;
  full_name: string;
  category_id: [number, string] | false;
};

const MANAGER_GROUP_HINTS = ["manager", "lead", "head", "supervisor"];
const MEMBER_GROUP_HINTS = ["member", "user", "agent", "employee"];

function rankGroupForPosition(name: string): "team_lead" | "agent" | null {
  const lc = name.toLowerCase();
  if (MANAGER_GROUP_HINTS.some((h) => lc.includes(h))) return "team_lead";
  if (MEMBER_GROUP_HINTS.some((h) => lc.includes(h))) return "agent";
  return null;
}

async function main() {
  const odoo: OdooClient = odooFromEnv();
  console.log("[import-odoo-org] authenticating against Odoo…");
  await odoo.authenticate();

  console.log("[import-odoo-org] reading res.groups for context…");
  const groups = await odoo.searchRead<OdooGroup>(
    "res.groups",
    [],
    ["id", "name", "full_name", "category_id"],
    { limit: 5000 },
  );
  const groupById = new Map<number, OdooGroup>();
  for (const g of groups) groupById.set(g.id, g);

  console.log("[import-odoo-org] reading res.users…");
  const users = await odoo.searchRead<OdooUser>(
    "res.users",
    [["active", "=", true]],
    ["id", "name", "login", "email", "partner_id", "groups_id", "active"],
    { limit: 1000 },
  );

  console.log(`[import-odoo-org] processing ${users.length} users…`);

  const tmpDir = path.resolve(new URL(".", import.meta.url).pathname, "..", "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const csvPath = path.join(tmpDir, "org-import-review.csv");

  const rows: string[] = [];
  rows.push(
    [
      "odoo_user_id",
      "name",
      "login",
      "email",
      "partner_display_name",
      "matched_group_names",
      "suggested_position",
      "notes",
    ]
      .map(csvCell)
      .join(","),
  );

  let teamLeadCount = 0;
  let agentCount = 0;
  let unsetCount = 0;

  for (const u of users) {
    const matchedGroupNames: string[] = [];
    let suggested: "team_lead" | "agent" | null = null;
    for (const gid of u.groups_id ?? []) {
      const g = groupById.get(gid);
      if (!g) continue;
      const candidate = rankGroupForPosition(g.full_name || g.name);
      if (candidate) {
        matchedGroupNames.push(g.full_name || g.name);
        // team_lead wins over agent if both match.
        if (candidate === "team_lead") suggested = "team_lead";
        else if (suggested !== "team_lead") suggested = "agent";
      }
    }

    if (suggested === "team_lead") teamLeadCount++;
    else if (suggested === "agent") agentCount++;
    else unsetCount++;

    rows.push(
      [
        String(u.id),
        u.name ?? "",
        u.login ?? "",
        u.email === false ? "" : u.email,
        u.partner_id === false ? "" : u.partner_id[1],
        matchedGroupNames.join(" | "),
        suggested ?? "",
        suggested
          ? "Auto-suggested. Owner must review before applying."
          : "No matching group — manual classification needed.",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  fs.writeFileSync(csvPath, rows.join("\n") + "\n", "utf8");

  console.log(`[import-odoo-org] wrote ${csvPath}`);
  console.log(`  total users        : ${users.length}`);
  console.log(`  suggested team_lead: ${teamLeadCount}`);
  console.log(`  suggested agent    : ${agentCount}`);
  console.log(`  unclassified       : ${unsetCount}`);
  console.log("");
  console.log(
    "Review the CSV with the owner, then assign positions via /organization/departments/[id] in the dashboard.",
  );
}

function csvCell(value: string): string {
  if (value == null) return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

main().catch((err) => {
  console.error("[import-odoo-org] failed:", err);
  process.exit(1);
});
