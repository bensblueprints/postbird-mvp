# 🕊️ Postbird — Self-Hosted Email Campaigns

## Demo



https://github.com/user-attachments/assets/59d3f08b-ce2b-4f1c-a195-dda5603b4a8c



[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Own your list. Own your sender. Stop renting your audience back at per-contact prices.**

Postbird is a self-hosted email marketing app: subscriber lists + segments, a drag-block builder that compiles to bulletproof email-safe HTML, throttled campaign sending through **your own SMTP**, open/click tracking, and CAN-SPAM/GDPR compliance built in as hard guarantees — not checkboxes.

Pay **once**. No monthly bill that scales with your list. No vendor holding your subscribers hostage.

![Postbird dashboard](docs/screenshot.png)

## ☕ Skip the setup — get the 1-click installer

Want the packaged installer with zero terminal time? Grab the one-time paid version:

**→ [https://whop.com/onetime-suite](https://whop.com/onetime-suite)**

Same code, packaged and ready. Buying it also funds development of this open-source version.

## Features

- **Lists & subscribers** — CRUD lists, CSV import with dedupe + invalid-email rejection report, manual add, public signup endpoint per list, CSV export. Statuses: `pending`, `subscribed`, `unsubscribed`, `bounced`, `complained`.
- **Double opt-in** (default ON, per list) — signup → confirmation email with a signed token; only confirmed subscribers ever receive campaigns. Consent timestamp + IP stored for GDPR.
- **Segments** — saved filters: email domain, name contains, custom field equals, subscribed-after date, opened/clicked any of the last N campaigns. AND/OR rules with a live count while you edit.
- **Drag-block email builder** — heading, rich text, image (upload), bulletproof button, divider, spacer, 2-column, footer. Drag to reorder, per-block styles, desktop/mobile/HTML-source/plain-text previews, test-send. **Compiles to table-based HTML with inline styles only** — no flexbox, no grid, no surprises in Outlook.
- **Campaigns** — list ± segment, subject/from/reply-to, send now or schedule. Throttled sending queue (default 30 msgs/min, configurable) over a pooled nodemailer connection. Pause/cancel mid-send, live progress bar. Queue lives in SQLite — a restart resumes where it left off.
- **Opens & clicks** — 1×1 pixel + rewritten links with HMAC-signed tokens (no forgery/enumeration). Per-campaign report: delivered, unique/total opens and clicks, per-URL click map, recipient-level activity.
- **Compliance, enforced** — see below. Sending is *blocked* until it passes.
- **Bounce handling** — webhook endpoint accepting SES-SNS / Postmark / Mailgun / generic payloads, plus SMTP-time 5xx rejections treated as hard bounces. Bounced/complained addresses are suppressed forever.
- **Merge tags** — `{{name}}`, `{{email}}`, `{{unsubscribe_url}}`, `{{field.yourfield}}`.
- 100% local. No telemetry, no phone-home, SQLite file you can back up with `cp`.

## ⚖️ CAN-SPAM / GDPR — compliance as a feature

Most self-hosters get burned here. Postbird makes the legal minimums impossible to skip:

| Requirement | How Postbird enforces it |
|---|---|
| Working unsubscribe link | Every send includes a signed one-click unsubscribe link — no login, immediate effect, confirmation page. The footer block is **non-removable**: if a template has no footer, the compiler appends one. |
| `List-Unsubscribe` headers | `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) on every campaign email. Gmail & Yahoo **require** these for bulk senders since 2024. |
| Physical mailing address | Required settings field, rendered in every footer. **Sending is blocked with a 400 while it's empty.** |
| Honor opt-outs immediately | Unsubscribes are global-per-list and instant; suppressed from queues mid-send too. |
| Consent records (GDPR) | Double opt-in default ON; consent timestamp + IP stored per subscriber. |

What Postbird does *not* do: make a rented IP look reputable. Deliverability (SPF/DKIM/DMARC, IP warming) is your SMTP provider's job — use Amazon SES or Postmark credentials and you inherit their reputation.

## Quick start

```bash
git clone https://github.com/bensblueprints/postbird
cd postbird
npm i
npm run build   # build the admin UI once
npm start       # → http://localhost:5327/admin  (password: admin)
```

Set `ADMIN_PASSWORD` and `BASE_URL` in `.env` (see `.env.example`) before real use. **`BASE_URL` matters**: tracking pixels, click redirects, confirm and unsubscribe links are absolute URLs built from it — it must be reachable by your recipients.

### Desktop app or $5 VPS — your choice

**Run it as a desktop app, or deploy to a $5 VPS when you need it public.**

```bash
npm run desktop   # Electron window, auto-logged-in, data in your user profile
```

> Desktop-mode caveat: tracking pixels and unsubscribe links only resolve while the app is running and reachable from the recipient's mail client. Desktop mode is great for authoring templates and small same-network sends — use a VPS (public `BASE_URL`) for real campaigns.

### Docker

```bash
docker compose up -d   # port 5327, SQLite persisted in the postbird-data volume
```

## SMTP throttle guidance

Postbird's default is a conservative **30 emails/minute**. Adjust per provider:

| Provider | Notes |
|---|---|
| Amazon SES | Default 14/sec after sandbox exit — throttle 300+/min is usually fine. Cheapest at scale ($0.10/1k). |
| Postmark | 300 req/min on standard plans. Excellent deliverability for transactional-style sending. |
| Mailgun | Plan-dependent; start at 100/min. |
| Gmail / Google Workspace | **~500 recipients/day (2,000 on Workspace)** — fine for testing, not for real campaigns. |

Credentials are never bundled or transmitted anywhere except to your SMTP host.

## Bounce webhook payloads

Point your provider's bounce/complaint webhook at `POST /api/hooks/bounce`. Accepted shapes:

```jsonc
// Generic
{ "email": "person@example.com", "type": "bounce" }        // or "complaint"

// Postmark
{ "RecordType": "Bounce", "Email": "person@example.com" }
{ "RecordType": "SpamComplaint", "Email": "person@example.com" }

// Mailgun
{ "event-data": { "event": "failed", "severity": "permanent", "recipient": "person@example.com" } }

// Amazon SES via SNS (raw SES JSON also accepted)
{ "Type": "Notification", "Message": "{\"notificationType\":\"Bounce\",\"bounce\":{\"bounceType\":\"Permanent\",\"bouncedRecipients\":[{\"emailAddress\":\"person@example.com\"}]}}" }
```

Hard bounce → status `bounced`; complaint → `complained`; both suppressed from all future sends. SMTP-time 5xx rejections during a send are recorded as bounces automatically.

## Public API (per-list signup form)

```bash
curl -X POST https://your-host/api/public/lists/1/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"person@example.com","name":"Person","fields":{"plan":"pro"}}'
```

With double opt-in ON the subscriber lands as `pending` and gets a confirmation email; only after clicking do they become `subscribed`.

## Postbird vs Mailchimp vs Sendy

| | **Postbird** | Mailchimp | Sendy |
|---|---|---|---|
| Price | **$59 once** | $20+/mo @ 1k contacts, $100+/mo @ 10k | $69 once |
| SMTP | **Any provider (BYO)** | Theirs only | Amazon SES only |
| Your data | **Your SQLite file** | Their cloud | Your MySQL server |
| Contact limits | **None** | Priced per contact | None |
| Double opt-in | ✔ default | ✔ | ✔ |
| RFC 8058 one-click unsub headers | ✔ | ✔ | Partial |
| Compliance send-blocking | **✔ hard block** | Soft warnings | ✖ |
| Segments | ✔ | ✔ (paid tiers) | Basic |
| Runs as desktop app | **✔** | ✖ | ✖ |
| Source code | **MIT** | Closed | Closed (PHP, license key) |

At 1,000 contacts, Mailchimp Standard costs more than Postbird **every three months, forever**.

## Tech stack

Node 20+ · Express · better-sqlite3 (WAL) · nodemailer (pooled) · React 18 + Vite · Tailwind CSS 4 · Framer Motion · Lucide · Electron (desktop mode) · Docker

## Development

```bash
npm run dev      # Vite dev server on :5328, proxying API to :5327
npm start        # API server
npm test         # end-to-end smoke test with a local SMTP capture server
```

`npm test` boots the real server plus an in-process SMTP server and walks the whole loop: double opt-in → CSV import → builder render (asserts table-based, banned-CSS-free HTML) → compliance send-block → throttled send (asserts unsub link, physical address and RFC 8058 headers on the wire) → open/click tracking → unsubscribe suppression → bounce webhook.

Outlook rendering quirks beyond the table-based baseline (VML backgrounds, DPI scaling) are documented territory, not solved in MVP — the compiler output is deliberately conservative so it degrades gracefully.

## License

MIT © 2026 Ben (bensblueprints)
