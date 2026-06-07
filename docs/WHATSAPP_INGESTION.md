# Live WhatsApp Ingestion (OpenWA → Dashboard)

Automates client-satisfaction by streaming WhatsApp **group** messages from a
self-hosted [OpenWA](https://github.com/rmyndharis/OpenWA) gateway into the
dashboard, where AI turns them into satisfaction / brief-adherence scores that
feed the **Execution Quality** and **Operational Stability** executive indices.

```
┌─────────────────────────┐   HMAC webhook    ┌──────────────────────────┐
│ OpenWA (Docker, your VPS)│ ───────────────▶ │ /api/wa/webhook (dashboard)│
│ • 1 dedicated WA number  │  group messages   │ • verify sig             │
│ • QR login once          │                   │ • normalise + upsert     │
│ • joined in all groups   │                   │   wa_messages            │
└─────────────────────────┘                   │ • auto-register chats    │
                                               └────────────┬─────────────┘
        /satisfaction/groups  ◀── map chat → client/kind ───┘
                                               │
                          daily cron /api/cron/wa-analyze
                                               ▼
                  client_satisfaction_analyses → Quality + Stability + AI report
```

## ⚠️ Before you start
- **Use a DEDICATED WhatsApp number** (a SIM you control, not anyone's personal
  WhatsApp). Unofficial automation violates WhatsApp's ToS; the number can be
  rate-limited or banned. Never use a number you can't afford to lose.
- The OpenWA gateway is **stateful** (a persistent WhatsApp-Web session) — it
  **cannot** run on Vercel/serverless. Host it on a small always-on VPS/container.
- History backfill via WhatsApp-Web is unreliable; keep the **one-time `.txt`
  import** (`/satisfaction`) for historical seed, and rely on the webhook going
  forward.

## 1. Deploy OpenWA

```yaml
# docker-compose.yml on your VPS
services:
  openwa:
    image: ghcr.io/rmyndharis/openwa:latest   # or build from the repo
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      - DATABASE_URL=postgres://openwa:openwa@db:5432/openwa
      - API_KEY=${OPENWA_API_KEY}              # protects OpenWA's own REST API
      - WEBHOOK_URL=https://<your-app-domain>/api/wa/webhook
      - WEBHOOK_SECRET=${WA_WEBHOOK_SECRET}     # MUST match the dashboard env
      - WEBHOOK_EVENTS=message                  # forward inbound messages
    volumes: ["./openwa-session:/app/session"]  # persist the WA session
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=openwa
      - POSTGRES_PASSWORD=openwa
      - POSTGRES_DB=openwa
    volumes: ["./openwa-db:/var/lib/postgresql/data"]
```

```bash
docker compose up -d
```

Then **connect the number from inside the dashboard**: open
**رضا العملاء → ربط رقم واتساب** (`/satisfaction/connect`), click **Connect**,
and scan the QR with the dedicated number (WhatsApp → Linked devices → Link a
device). The page shows live status (Not configured → Scan QR → Connecting →
Connected) and registers the webhook automatically. *(You can also scan from
`docker compose logs -f openwa`, but the in-app page is the supported flow.)*

Then add the dedicated number to **every** client + technical WhatsApp group
(or share group invite links to it).

> Exact env var names depend on the OpenWA version — check its README. The
> only contract the dashboard requires is: **POST message events to
> `/api/wa/webhook`, signed with HMAC-SHA256 of the raw body using the shared
> secret**, sent as `x-webhook-signature` (hex, or `sha256=<hex>`).

## 2. Dashboard environment

Add to `.env.local` (and your Vercel project):

```bash
WA_WEBHOOK_SECRET=<long-random-string>   # MUST equal OpenWA's WEBHOOK_SECRET
WA_API_URL=https://<vps-host>:8080       # optional — enables "Sync from OpenWA"
WA_API_KEY=<OPENWA_API_KEY>              # optional — for the sync call
```

The webhook path `/api/wa/webhook` is already exempt from session auth
(`src/proxy.ts`) and is protected by the HMAC signature instead.

## 3. Map groups → clients

Open **رضا العملاء → ربط مجموعات واتساب** (`/satisfaction/groups`):

- Groups appear automatically as their first message arrives (or click
  **Sync from OpenWA** to pull the full list).
- For each group pick the **client** and **kind** (`client` = customer group,
  `technical` = internal team group), and keep it **Active**.
- Saving **backfills** existing stored messages for that chat with the mapping,
  so they immediately join the client's transcript.

## 4. Automatic analysis

Register the daily cron (`supabase/migrations/0143_wa_analyze_cron.sql`) — set
the two vault secrets first:

```sql
select vault.create_secret('https://<your-app-domain>/api/cron/wa-analyze', 'wa_analyze_url');
select vault.create_secret('<CRON_SECRET value>', 'wa_analyze_cron_secret');
-- then run migration 0143
```

It runs at **05:30 UTC** and re-analyzes any client whose groups got new
messages in the last 36h (capped at 12/run). You can also trigger on-demand
from the `/satisfaction` page (the **Analyze** button), or:

```bash
curl -X POST https://<app>/api/cron/wa-analyze -H "x-cron-secret: $CRON_SECRET"
```

## Data model
- `wa_group_links` — chat_id → client_id + group_kind (+ cached name/counts).
- `wa_messages` — every group message (idempotent on `wa_message_id`).
- Transcript = one-time `.txt` import **+** live `wa_messages`, merged per
  client/kind (`buildClientTranscripts`), fed to `analyzeClientSatisfaction`.

## Current deployment (Rawasm)
- **Gateway URL:** `https://wa.menu-p.com` (TLS via Let's Encrypt; nginx vhost in `/etc/nginx/sites-enabled/wa.menu-p.com` proxying to `127.0.0.1:2785`)
- **VPS:** `31.97.197.16` (Ubuntu 25.04, OpenWA container `openwa-api` in `/opt/OpenWA`, SQLite database)
- **Session name:** `rawasm` (UUID resolved at runtime — OpenWA paths use UUID, not name)
- **API key:** auto-generated `owa_k1_…` on first boot (visible in `docker logs openwa-api`). OpenWA **ignores** `API_MASTER_KEY` from `.env`.
- **Coexists with:** the existing `bot.sufrah.sa`, `chat.sufrah.sa`, `storage.sufrah.sa` vhosts.

## Quirks discovered against the real OpenWA (vs docs)
- Status field is **lowercase** (`qr_ready`, `initializing`, `connected`) — not uppercase. `extractStatus()` in `openwa-client.ts` normalises both.
- QR endpoint returns `{ "qrCode": "data:image/png;base64,…", "status": "..." }` — not `{ data: { image } }`.
- Sessions are addressed by **UUID** (returned at `POST /api/sessions`), not by the human name. We look it up via `GET /api/sessions` matching `name === WA_SESSION_ID`.
- `/api/sessions/:id/status` returns 500 — use `/api/sessions/:id` instead, which includes a `status` field.

## Troubleshooting
- **401 from webhook** → `WA_WEBHOOK_SECRET` mismatch between OpenWA and the app.
- **Messages stored but no satisfaction** → the chat isn't mapped to a client
  on `/satisfaction/groups`, or only a technical group is mapped (need a
  `client` group for a satisfaction score).
- **Sync button errors** → `WA_API_URL` not set, or OpenWA API key wrong.
- **Group name shows a person's name** → fixed; names come from the group
  subject, not `notifyName`.
