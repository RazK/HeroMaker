---
id: H-032
title: "Fair visitors buy at home later"
status: untested
area: events
segment:
  drawer: "kid 4-12"
  payer: "parent"
  door: "fair/museum"
statement: "We believe at least 3% of browsers that came through a fair QR code will buy a pack within 14 days because the kid wants another hero at home."
metric: "`purchase_done` per browser with door `fair-...`, within 14 days of the first `visit`"
threshold:
  supported: "3% or more"
  rejected: "under 1%"
test: "funnel observation by door"
sample: "300 browsers through a fair QR"
duration: "2 weeks after one busy fair"
impact: 4
uncertainty: 5
priority: 20
experiments: []
---

# H-032: Fair visitors buy at home later

We believe at least 3% of browsers that came through a fair QR code will buy a pack within 14 days because the kid wants another hero at home.

**Why we think so.** A stand only pays if it seeds households.

**How we'll know.** Funnel observation by door. Supported: 3% or more. Rejected: under 1%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** A QR scanned on the stand's own tablet is the stand's browser, not the family's: hand out the QR for the family's phone.

**Result.** Not tested yet.
