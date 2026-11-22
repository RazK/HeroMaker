---
id: E-008
title: "Wait screen as today vs an email when the hero is ready"
status: draft
lever: "time to value, and LTV (heroes seen, refunds avoided)"
hypotheses: [H-043, H-015]
flag_key: ready-email
variants: [wait, email]
audience: "accounts with a hero being made from their own credits; not class heroes, not robots, not admins"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "of browsers with wait_left, the share with hero_opened (from: mine) or screen_viewed (screen: hero) within 24 hours, by arm"
guardrails: ["wait_left per hero started (the email must not push people away)", "emails marked spam or unsubscribed (Resend dashboard)", "refund requests (by hand)", "hero_failed per hero started"]
sample: "about 45 wait_left per arm (40% to 70% come back)"
stop_date: "set when it starts: the sample plus 24 hours, or 6 weeks"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-008: Wait screen as today vs "we'll tell you when it's ready" email

**Question.** If we email parents when their hero is ready, do more of those
who leave the wait come back to see it?

**Variants.**
- `wait`: today. The being-made screen; nothing tells anyone when the hero
  is ready.
- `email`: the same screen says "We'll email you when it's ready. You can
  close this." When `hero_ready` fires, one email goes to the account's
  address with a link to the hero.

**Audience and share.** Accounts with a hero being made from their own
credits, 50/50 by a hash of the visitor id. Left out: class heroes (a child in
a class has no email of theirs with us, and must not get one), robots, admins.

**Metrics.**
- Primary: of browsers with `wait_left`, the share with `hero_opened`
  (from: mine) or `screen_viewed` (screen: hero) within 24 hours, by arm
  (H-043; H-015 is the `wait` arm's number). Supported at 30 points or more.
- Return through the email itself: the email's link carries
  `?via=ready-email`, so the door machinery counts it with no new event.
- needs: `ready_email_sent` (server, no properties), so the email arm can be
  checked to have actually sent.
- Guardrails: `wait_left` per hero started (telling people they may go must
  not just make them go and forget); spam and unsubscribe counts from Resend;
  refund requests, by hand; `hero_failed`.

**Sample and stop.** From an assumed 40% (H-015's rejected line) to 70% (its
supported line) needs about 45 leavers per arm. At about 4 to 5 heroes a day
during a campaign and half of them left, 2 to 3 leavers a day: about 5 to 6
weeks. It sees a 30-point difference, not a 10-point one. If H-015's
baseline, read free during E-002, is already 70% or more, do not run it.

**Needs before it runs.**
- H-015's baseline from E-002.
- Raz's yes on the email's words and on emailing the account at all (it is
  the grown-up's address, already ours, used for one new purpose).
- Email working on production: `RESEND_API_KEY` and `MAIL_FROM` on a
  verified domain (`backend/app/services/mailer.py`).
- Built behind the flag: the sentence on the screen, the email on
  `hero_ready`, and `ready_email_sent` in the allow-list.
- The experiment plumbing (`README.md`).

**Result.** Not run.

**Decision.** None yet.
