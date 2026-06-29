#!/usr/bin/env python3
"""Backfill tasks.stage_owner_positions from the team's task-template items.

The team maintains accurate per-deliverable owner maps in /task-templates; Odoo
tasks only carry the generic default (migration 0077). We match each task to its
template item by (service_id + normalised title) and copy that item's owner map
onto the task, so accountability attributes by the team's real ownership.

Match tiers:
  1. exact   — same service + normalised title  (~90%)
  2. service — same service, title no-match → service's MOST-COMMON item map
  3. skip    — no service_id (leave the generic default)

Usage:  python3 backfill-task-stage-owners.py            # dry-run (counts only)
        python3 backfill-task-stage-owners.py --apply    # write to prod DB
"""
import json, urllib.request, urllib.error, os, re, unicodedata, collections, sys

URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
REF = os.environ["SUPABASE_PROJECT_ID"]
TOK = os.environ["SUPABASE_ACCESS_TOKEN"]
APPLY = "--apply" in sys.argv


def rest(path):
    rows, off = [], 0
    while True:
        req = urllib.request.Request(
            URL + "/rest/v1/" + path + f"&limit=1000&offset={off}",
            headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        d = json.load(urllib.request.urlopen(req))
        rows += d
        if len(d) < 1000:
            return rows
        off += 1000


def mgmt_sql(sql):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json",
                 "User-Agent": "mr-dashboard-backfill/1.0"}, method="POST")
    try:
        r = urllib.request.urlopen(req)
        return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = "".join(c for c in s if not (0x1F000 <= ord(c) <= 0x1FAFF
                                      or 0x2600 <= ord(c) <= 0x27BF
                                      or ord(c) in (0xFE0F, 0x20E3)))
    s = s.translate(str.maketrans("ىئإأآةي", "يييااهي"))
    s = re.sub(r"[ـً-ْ]", "", s)   # tatweel + diacritics
    s = re.sub(r"[0-9٠-٩]", "", s)        # latin + arabic digits
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


tasks = rest("tasks?select=id,title,service_id,stage_owner_positions")
items = rest("task_template_items?select=title,task_template_id,stage_owner_positions")
tmpls = rest("task_templates?select=id,service_id")
svc_of = {t["id"]: t.get("service_id") for t in tmpls}

exact_idx = {}
svc_maps = collections.defaultdict(collections.Counter)
for it in items:
    sid = svc_of.get(it["task_template_id"])
    m = json.dumps(it["stage_owner_positions"], sort_keys=True)
    exact_idx.setdefault((sid, norm(it["title"])), m)
    svc_maps[sid][m] += 1
svc_mode = {sid: c.most_common(1)[0][0] for sid, c in svc_maps.items()}

updates, tiers = {}, collections.Counter()
for t in tasks:
    sid = t.get("service_id")
    if not sid:
        tiers["skip_no_service"] += 1
        continue
    key = (sid, norm(t["title"]))
    if key in exact_idx:
        newmap = exact_idx[key]; tiers["exact"] += 1
    elif sid in svc_mode:
        newmap = svc_mode[sid]; tiers["service_fallback"] += 1
    else:
        tiers["skip_no_templates"] += 1
        continue
    if json.dumps(t.get("stage_owner_positions"), sort_keys=True) != newmap:
        updates[t["id"]] = newmap
    else:
        tiers["already_correct"] += 1

print(f"tasks: {len(tasks)} | template items: {len(items)}")
for k, v in tiers.most_common():
    print(f"  {k:22} {v}")
print(f"  -> rows to UPDATE: {len(updates)}")
# distribution of new execution owners (sanity)
dist = collections.Counter(json.loads(m).get("client_changes") for m in updates.values())
print(f"  new client_changes owner distribution: {dict(dist)}")

if not APPLY:
    print("\nDRY-RUN. Re-run with --apply to write.")
    sys.exit(0)

ids = list(updates)
B = 200
for i in range(0, len(ids), B):
    chunk = ids[i:i + B]
    vals = ",".join(
        "('%s'::uuid,'%s'::jsonb)" % (tid, updates[tid].replace("'", "''"))
        for tid in chunk)
    sql = f"update public.tasks t set stage_owner_positions = v.m from (values {vals}) v(id,m) where t.id = v.id"
    code, body = mgmt_sql(sql)
    print(f"  batch {i//B+1}/{(len(ids)+B-1)//B}: HTTP {code} {body if code>=300 else ''}")
print("DONE.")
