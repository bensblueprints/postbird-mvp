# Launch Strategy — Postbird

## Positioning

"Own your list, own your sender, stop renting your audience back at $per-contact prices." One-time $59 vs Mailchimp Standard ≈ $20/mo @ 500–1k contacts (scaling past $100/mo @ 10k) and Sendy ($69 one-time but AWS-SES-only). **Postbird pays for itself in ~2 months vs Mailchimp at 1k contacts** — and the bigger your list gets, the more it saves.

## Target communities

| Community | Angle (rules-aware) |
|---|---|
| r/selfhosted | Genuine "I built a self-hosted Mailchimp alternative, MIT" show-off post. This sub loves BYO-SMTP + SQLite + Docker. Lead with the compose file and screenshots, link GitHub not the paid page. Answer every comment. |
| r/Emailmarketing | **No self-promo except on designated threads — follow the rules.** Participate first; share in the weekly promo thread. Angle: the compliance-enforcement story (send-blocking, RFC 8058), which is a real discussion topic there. |
| r/EntrepreneurRideAlong | Build-in-public revenue story: "I replaced my $50/mo Mailchimp bill with a $59 one-time tool I wrote." |
| r/webdev | Technical angle: "Compiling a block editor to email-safe table HTML — what I learned about Outlook." Postbird is the demo, not the pitch. |
| r/opensource | MIT release announcement; emphasize no telemetry, no phone-home. |
| Indie Hackers | Milestone post + the "compliance is a feature" essay. |

## Hacker News — Show HN draft

**Title:** Show HN: Postbird – self-hosted email campaigns with compliance enforced in code

**Body:**
I got tired of paying monthly rent on my own mailing list, and Sendy (the usual escape hatch) locks you to Amazon SES and is closed source.

Postbird is a Node + SQLite + React app: lists with double opt-in, segments compiled to SQL, a drag-block builder that outputs table-based inline-styled HTML (plain-text alternative auto-generated), a throttled sending queue over any SMTP via nodemailer, and open/click tracking with HMAC-signed tokens.

The design decision I'd most like feedback on: compliance is enforced, not suggested. The server returns 400 if you try to send without a physical postal address configured; the unsubscribe footer is appended by the compiler if a template lacks it; every message gets RFC 8058 List-Unsubscribe-Post headers (Gmail/Yahoo require them for bulk senders now). The smoke test boots a local SMTP server and asserts all of this on the wire.

Deliberately out of scope: deliverability magic (use SES/Postmark creds — it's their IP reputation), drip automations, A/B tests.

MIT licensed. Runs via npm, Docker, or as an Electron desktop app for authoring. Happy to answer anything about email HTML pain or the queue design.

## SEO keywords (10)

1. sendy alternative
2. self hosted mailchimp alternative
3. self hosted email marketing
4. self hosted newsletter software
5. mailchimp alternative one time payment
6. email campaign software lifetime deal
7. byo smtp email marketing
8. open source email marketing nodejs
9. can-spam compliant email software
10. email list management self hosted

## AppSumo / PitchGround pitch

Postbird is self-hosted email marketing for people done paying rent on their own audience: lists with double opt-in, segments, a drag-block builder that compiles to bulletproof email HTML, throttled campaigns over any SMTP, and open/click tracking — with CAN-SPAM compliance literally enforced at send time (physical-address send-block, non-removable unsubscribe footer, RFC 8058 one-click headers). It installs in minutes on any $5 VPS via Docker, or runs as a desktop app. Your subscribers live in a SQLite file you own — no contact-based pricing, ever. Lifetime-deal buyers get exactly what the label says, because there's no subscription to convert them to: pay once, own it, MIT-licensed source included.

## Pricing

**$59 one-time.** Competitor math:
- Mailchimp Standard @ 1k contacts ≈ $26.50/mo → **pays for itself in ~2 months**, saves ~$260/yr
- Mailchimp @ 10k contacts ≈ $100+/mo → saves $1,100+/yr
- Sendy $69 one-time + forced AWS SES → Postbird is cheaper AND SMTP-agnostic
- Position the Whop installer as "setup time bought back": $59 vs an evening of npm.
