# Product knowledge: how we decide

Every product decision comes from a belief we wrote down, tested, and closed.
This folder holds them, next to the code that measures them.

| Where | What |
|---|---|
| [`HYPOTHESES.md`](HYPOTHESES.md) | The index, by priority. The five riskiest on top. What we cannot measure yet at the bottom. |
| `hypotheses/H-NNN-<slug>.md` | One belief each. |
| [`experiments/`](experiments/README.md) | One test each, `E-NNN-<slug>.md`, and the template. |
| [`DECISIONS.md`](DECISIONS.md) | What Raz decided, from which result. |
| `class-sessions.md`, `creator-and-group-leader.md` | Feature specs. They say what was built; this method says whether it worked. |

## A hypothesis

One segment, one behaviour we can see, one threshold:

> We believe **<segment>** will **<observable behaviour>** at least
> **<threshold>** because **<reason>**.

- **Segment**: who draws (a kid 4-6, 7-9, 10-12, 13+, or a grown-up), who
  pays (parent, giver, teacher, party host, venue), and the door they came
  through (family, gift/birthday, class, fair/museum, ad). "Everyone" is not a
  segment; a broad belief is split into one file per segment.
- **Metric**: an event that exists today, named exactly as in
  `backend/app/services/analytics.py`, or `needs: <new event>`. A hypothesis
  that needs a new event is listed under the gaps in `HYPOTHESES.md`.
- **Threshold**: one number for supported, one for rejected; between them is
  inconclusive. **Thresholds are targets we choose before looking, not facts.**
  We never move one after the data arrives.
- **Status**: `untested` → `testing` (an experiment that names it is running)
  → `supported`, `rejected` or `inconclusive`.

The YAML header holds the fields; the body says why we believe it, in a few
lines. Copy any file in `hypotheses/` to start a new one; take the next free
number.

## Scoring

- **Impact 1-5**: 5 = if this is false, we change who we sell to, what we
  charge, or whether to run the campaign. 1 = a detail of one screen.
- **Uncertainty 1-5**: 5 = no evidence at all. 1 = already measured.
- **Priority = impact × uncertainty.** Highest first. On a tie, the cheaper
  test first.

## Choosing the test

We have tens of visitors a day without a campaign. Planning numbers, until the
first real week replaces them (**assumptions, not measurements**): **30
visits a day** without a campaign, **200 a day** while one runs.

Rule of thumb for comparing two rates: each arm needs about
**16 × p × (1 − p) / d²** people, where p is the rate (midway between the
two) and d the difference we want to see. From 30% to 40% that is about 360
per arm; from 3% to 4%, about 5,400. So:

| Test | Use it when | At our traffic |
|---|---|---|
| **Funnel observation by door** | The question is "how many" or "which door" | The default. Free; every event already has its door. |
| **A/B experiment** | Every visitor sees the thing (the gallery, a sheet) and the rate is high | Weeks during a campaign, months without one. |
| **Fake door** | The thing does not exist yet (a voucher, shipping) | A button and an honest "Not yet" answer. Collects nothing. |
| **Observed session** | We need to see a child's face, a class, a stand | Ten sessions beat a month of events for "do they love it". |
| **Interview** | Price, budget, who pays, why they left | Five people. Raz runs them or says yes to them. |
| **Price test** | A price | One price per period, never two prices side by side. Interviews first. |

A test that would take more than six weeks at the planning numbers is the
wrong test: use observation, a fake door or interviews.

## Running an experiment

1. **Draft** it from the template in `experiments/README.md`, and link it from
   each hypothesis it tests (`experiments: [E-NNN]`).
2. **Raz says yes.** Nothing runs without it. Anything that changes a price,
   touches children's data or shows a fake door needs that yes explicitly.
3. **Build** what it needs on a branch, through staging like every change.
   Set `status: running`, the start date and the stop date. Mark its
   hypotheses `testing`.
4. **Do not peek and stop.** Read it at the stop date, or when the sample is
   reached, whichever is later.
5. **Close** it: write the result with its numbers, set each hypothesis's
   status, remove the flag from the code, and add the decision to
   `DECISIONS.md` once Raz has made it.

Observed sessions and interviews are written into the experiment file:
what was seen or said, **never a child's name, photo or drawing**.

## Who updates what

| Who | Does |
|---|---|
| The product agent (Compass) | Writes and scores hypotheses, drafts experiments, keeps the index sorted, reads results, proposes the decision. |
| Raz | Says yes to every experiment, every price and every change to what is collected about children. Makes the decision. |
| Whoever builds an experiment | Uses its exact flag key from the experiment file, and removes it when the experiment closes. |
| CI (`devops/scripts/product_docs_check.py`) | Fails a PR when a flag key in the code has no experiment file, an experiment names a hypothesis that does not exist, or a header is malformed. |
