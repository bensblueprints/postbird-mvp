# Product Hunt Launch — Postbird

## Name
Postbird

## Tagline (60 chars)
Self-hosted email marketing. Pay once, own your list forever.

## Description (260 chars)
Postbird is self-hosted email campaigns without the monthly ransom: lists, segments, a drag-block builder that outputs bulletproof email HTML, throttled sending over YOUR SMTP, open/click tracking, and CAN-SPAM compliance enforced at send time. $59 once.

## Full description

Email marketing tools charge you rent on your own audience. Mailchimp is $20+/mo at 1,000 contacts and past $100/mo at 10k — for software that emails a list *you* built.

Postbird flips that: a one-time purchase, running on your VPS (or your desktop), storing everything in a SQLite file you control.

**What's inside**
- Lists & subscribers with CSV import (dedupe + rejection report), public signup endpoints, and full status tracking
- Double opt-in by default — signed confirmation links, consent timestamp + IP stored
- Segments: email domain, custom fields, subscribed-after, opened/clicked last-N-campaigns — with a live count as you build rules
- A drag-block builder that compiles to table-based, inline-styled email HTML (no flexbox horrors in Outlook), with desktop/mobile/source/plain-text previews and test sends
- Throttled sending queue over any SMTP (SES, Postmark, Mailgun, anything) — pause, cancel, resume after restart
- Open & click tracking with HMAC-signed tokens, per-URL click maps, recipient timelines
- **Compliance enforced, not suggested**: sending is hard-blocked until your physical address is set; every email carries a one-click unsubscribe + RFC 8058 List-Unsubscribe headers (the ones Gmail/Yahoo now require); the compliance footer cannot be removed
- Bounce/complaint webhooks (SES-SNS, Postmark, Mailgun, generic) with automatic suppression

Run `npm start` on a $5 VPS, `docker compose up`, or use desktop mode (Electron) for authoring. MIT-licensed source; the paid version is the 1-click installer.

## Maker first comment

Hey PH 👋

I got tired of paying $30+/mo to email a newsletter list I built myself — and it only goes up as the list grows. Sendy was the classic escape hatch but it locks you to Amazon SES and it's closed-source PHP.

So I built Postbird: Node + SQLite + React, bring-your-own SMTP, pay once.

The part I'm most proud of is that compliance is *enforced in code*. I've seen too many self-hosters get their domain trashed because their tool let them send without an unsubscribe link or a physical address. Postbird literally returns a 400 if you try. Every send carries the RFC 8058 one-click unsubscribe headers Gmail and Yahoo started requiring for bulk senders.

The smoke test actually boots a local SMTP server and asserts — on the wire — that every message contains the unsub link, the postal address, and the right headers. Compliance is a test, not a footnote.

Honest limitations: it won't fix deliverability for you (that's your SMTP provider's reputation — I recommend SES or Postmark creds), and there are no drip automations yet — this is campaigns, done properly.

MIT source on GitHub; the paid version is the packaged installer for people who don't want to touch a terminal. Ask me anything!

## Gallery shots (5)

1. **Dark dashboard** — recent campaigns with open/click percentages, stat tiles (lists, subscribers, delivered). Caption: "Your whole email operation, on your server."
2. **Drag-block builder** — palette on left, 600px canvas mid-drag, style panel right, mobile preview tab visible. Caption: "Blocks in, bulletproof table-based HTML out."
3. **Campaign wizard review step** — the compliance checklist with green checks (physical address ✔, unsub link ✔, RFC 8058 ✔) and the send button. Caption: "Sending is blocked until compliance passes. By design."
4. **Campaign report** — funnel stats, per-URL click map, recipient activity table. Caption: "Opens, clicks, per-link breakdown — tracked on your domain."
5. **CSV import result** — imported/rejected cards with a rejection reasons list. Caption: "Import thousands of contacts with dedupe and a rejection report."
