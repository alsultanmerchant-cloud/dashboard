import { odooFromEnv } from "@/lib/odoo/client";
const c = odooFromEnv(); await c.authenticate();
const rows = await c.searchRead<Record<string,unknown>>(
  "project.task",
  [["id","in",[16788,15133,16821,16809]]],
  ["id","name","current_stage_duration","duration_days","working_days_open","working_days_close","progress_slip","progress_percentage","expected_progress"],
  { limit: 10, context:{active_test:false} },
);
for (const r of rows) console.log(JSON.stringify(r));
