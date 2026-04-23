# Pittsburgh Divorce

Static HTML lead-intake site. GitHub: `rcarhart/pghDivorce`.

## Structure

- `index.html` — main page
- `design-v2.html` through `design-v4.html` — design iterations
- `functions/api/leads.js` — Cloudflare Pages Function: form submission handler
- `schema.sql` — D1 database schema (leads + weekly_snapshots tables)
- `workers/weekly-review/` — standalone Cloudflare Worker, runs every Monday 9am ET
- `scripts/ads/` — Node.js scripts for Google Ads API (report, manage, auth)
- `scripts/sheets/` — Node.js scripts for Google Sheets export (export, auth)
- `.env` — local credentials (gitignored); see `.env.example` for required vars
- `.env.example` — template for all required environment variables

No build step, no framework.

## Cloudflare Infrastructure

- **Pages project:** `pghdivorce`
- **Domain:** pittsburghdivorces.com (also pghdivorce.pages.dev)
- **Account ID:** `0e84061cdb103bc2895fc03547a1e5fa`
- **D1 database:** `pittsburghdivorce-leads` (id: `6c1636aa-34a8-4bea-97d3-5daa70bb0ae7`), bound as `DB`
- **Turnstile widget:** sitekey `0x4AAAAAADAF9DWe0Cx92Qvo`
- **Weekly review worker:** `pittsburghdivorce-weekly-review` (cron: `0 13 * * 1`)

### Pages secrets (set via `wrangler pages secret put --project-name pghdivorce`)
- `TURNSTILE_SECRET_KEY`
- `RESEND_API_KEY`
- `GOOGLE_SHEETS_CLIENT_ID`
- `GOOGLE_SHEETS_CLIENT_SECRET`
- `GOOGLE_SHEETS_REFRESH_TOKEN`
- `GOOGLE_SHEET_ID`

### Weekly worker secrets (set via `wrangler secret put` in `workers/weekly-review/`)
- `RESEND_API_KEY`
- `GOOGLE_SHEETS_CLIENT_ID`
- `GOOGLE_SHEETS_CLIENT_SECRET`
- `GOOGLE_SHEETS_REFRESH_TOKEN`
- `GOOGLE_SHEET_ID`

## Form → Lead Flow

1. User submits form on index.html
2. Frontend validates and POSTs to `/api/leads` with form data + Turnstile token
3. `functions/api/leads.js`:
   - Validates input (required fields, length limits, email format)
   - Verifies Turnstile token server-side
   - Checks spam: flags if name matches known test patterns or is <2 chars
   - Checks duplicate: same email within 24 hours → status `duplicate`
   - Inserts lead into D1 with `status` = `new` | `spam` | `duplicate`
   - If `new`: fires Resend email to carhartconsulting@outlook.com AND appends row to Google Sheet (both via `waitUntil` — non-blocking)
4. Leads stored with: first_name, last_name, email, phone, county, divorce_stage, children_involved, asset_complexity, description, consent, ip_address, status

## Database

```bash
# Query leads
curl -X POST "https://api.cloudflare.com/client/v4/accounts/0e84061cdb103bc2895fc03547a1e5fa/d1/database/6c1636aa-34a8-4bea-97d3-5daa70bb0ae7/query" \
  -H "X-Auth-Key: $CF_API_KEY" -H "X-Auth-Email: $CF_EMAIL" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM leads ORDER BY created_at DESC"}'
```

### Tables
- `leads` — all submissions; `status` column: `new` | `spam` | `duplicate`
- `weekly_snapshots` — one row per Monday cron run; used for ROI trend data once Google Ads is connected

## Google Sheets Integration

- **Sheet ID:** `1nqld6jcikYBxKCd2LhWJ7xk55AQsDESdnjOS3uOIu5Q`
- **Tab name:** `Leads` (required — the code references this exact tab name)
- Columns A–K are ours: ID, Submitted, First Name, Last Name, Email, Phone, County, Divorce Stage, Children Involved, Asset Complexity, Description
- Columns L+ are reserved for the lawyer (Contacted, Follow-up Notes, Converted, etc.)
- **Never clear the sheet** — all sync operations are append-only, keyed on column A (lead ID)
- Real-time: new qualified lead appends instantly on submission
- Weekly: Monday cron catches any missed leads (idempotent — skips IDs already in sheet)
- On-demand: `node scripts/sheets/export.js` (requires `.env` with CF + Sheets credentials)

## Weekly Review Worker

Runs every Monday at 9am ET (`0 13 * * 1`). Does three things:
1. Counts past 7 days leads by status → sends digest email to carhartconsulting@outlook.com
2. Appends any qualified leads not yet in the Google Sheet
3. Saves a row to `weekly_snapshots` for ROI trend tracking

Deploy/update: `cd workers/weekly-review && CLOUDFLARE_API_KEY=... CLOUDFLARE_EMAIL=... npx wrangler deploy`

## Google Ads (Pending Setup)

Scripts are built and ready in `scripts/ads/`. Waiting on:
1. Google Ads account creation + one paused campaign
2. Google Cloud project with Ads API enabled + OAuth2 Desktop credentials
3. Developer token approval from Google (1–3 business days after applying at Ads → Tools → API Center)
4. Run `node scripts/ads/auth.js` to generate refresh token → add to `.env`

Once credentials are in `.env`:
- `node scripts/ads/report.js` — 7-day performance (spend, clicks, CTR, CPL)
- `node scripts/ads/report.js --days 30` — 30-day report
- `node scripts/ads/manage.js list` — list all campaigns
- `node scripts/ads/manage.js pause --campaign "Name"` — pause a campaign
- `node scripts/ads/manage.js budget --campaign "Name" --amount 50` — set daily budget

## Deployment

Pages deploys automatically on every push to `main` via GitHub → Cloudflare Pages.
Worker must be redeployed manually when `workers/weekly-review/index.js` changes:
```bash
cd workers/weekly-review
CLOUDFLARE_API_KEY=$CF_API_KEY CLOUDFLARE_EMAIL=$CF_EMAIL npx wrangler deploy
```

## Email

- Service: Resend (resend.com)
- Sending domain: `pittsburghdivorces.com` (verified via DNS TXT record)
- From: `leads@pittsburghdivorces.com`
- Recipient: `carhartconsulting@outlook.com`
