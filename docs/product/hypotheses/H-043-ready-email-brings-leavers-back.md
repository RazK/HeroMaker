---
id: H-043
title: "A ready email brings leavers back"
status: untested
area: activation
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe parents who leave the wait will open their hero within 24 hours at least 30 points more often when we email them that it is ready, because today nothing tells them."
metric: "of browsers with `wait_left`, the share with `hero_opened` (from: mine) or `screen_viewed` (screen: hero) within 24 hours, by arm; needs: `ready_email_sent`"
threshold:
  supported: "30 points or more higher with the email"
  rejected: "under 10 points higher"
test: "A/B experiment"
sample: "about 45 `wait_left` per arm (from 40% to 70%)"
duration: "about 5 to 6 weeks at campaign traffic"
impact: 4
uncertainty: 3
priority: 12
experiments: [E-008]
---

# H-043: A ready email brings leavers back

We believe parents who leave the wait will open their hero within 24 hours at least 30 points more often when we email them that it is ready, because today nothing tells them.

**Why we think so.** A hero takes about 8 minutes and nobody is told when it is ready (H-015). The account's email is already known, and the app already sends email (`backend/app/services/mailer.py`, the password reset).

**How we'll know.** A/B experiment. Supported: 30 points or more higher with the email. Rejected: under 10 points. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** If H-015's baseline, read for free during E-002, is already 70% or more, this test is not worth running.

**Result.** Not tested yet.
