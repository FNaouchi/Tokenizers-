# AI Credit budget and usage

Fill in this sheet before you build, update it at the mid-point check, and complete it at the end. Your trainer uses it to score **Plan** and **Token efficiency**.

## 1. Budget per phase

Complete the budget before you start building, and explain each model choice. The [README](../README.md#-ai-credit-budget) has an example budget from the kickoff.

| Phase | Copilot feature | Model choice and why | Budget (AI Credits) | Actual at mid-point | Actual at end |
|---|---|---|---:|---:|---:|
| Plan | Plan mode / Ask | Frontier (Opus): rule semantics, bursts and data-quality decisions drive everything after | 150 | | 141|
| Scaffold | Agent mode + instructions file | Haiku, low/medium effort: templated work (D0, D1) | 80 | | 40|
| Build features | Agent / Edit mode | Sonnet, high/medium effort for importer, money, VELOCITY, engine, review table; Haiku for API, UI wiring, time, schema | 450 | | 329|
| Tests + review | Skill for tests, chat review | Sonnet, high effort for rule tests and the Reviewer pass; Haiku for the other tests | 200 | | 160|
| Docs + demo | Ask, README generation | Haiku, low effort | 40 | | 30|
| **Total** | | | **920** | | 700|

**Variance at the end** = (actual − budget) ÷ budget = ____ %

Solid is within ±30% of budget; Strong is within ±15%.

If you can't measure each phase directly, split your trainer's readings across the phases and explain how you did it.

## 2. Usage readings

Your trainer records each team member's AI Credit usage at the start of the build, at the mid-point check and at the end. Each reading is a running total that includes earlier use, so subtract the start reading to see what each person used during the build. Copy the readings here.

| Team member | Start of build | Mid-point | End | Used (end − start) |
|---|---:|---:|---:|---:|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| **Team total** | | | | |

## 3. Mid-point re-plan

The mid-point check was planned after D3 (rules engine). Credit readings come from the trainer, so the numbers below are blank for the team to copy in. What changed in the plan is recorded here.

- **Credits used so far, compared with the budget for the phases you've done:** _(copy from the trainer's mid-point reading)_
- **What's going better or worse than planned:**
  - Better: profiling the CSVs with a script before planning meant the expected counts (73 / 28 / 16 flagged, 115 in total) were known up front, so D3 was checked against real numbers the first time it ran.
  - Worse: the first importer rejected rows too eagerly. The Reviewer found this in D7 rather than during D2, so it cost a fix and a new endpoint late in the build.
- **What you'll change for the second half (scope, models, context or prompts):** keep the plan's rule that Sonnet takes tasks where a small mistake changes which transactions get flagged. Add a short review of the importer decisions right after D2, instead of waiting for D7.
- **Updated budget for the remaining phases:** _(team to fill in with the trainer's numbers)_

## 4. Before and after optimization

Show one concrete change to a prompt, the context or the model that cut credits without hurting the output.

| | Alternative (not run) | What was done |
|---|---|---|
| **What you did** | Put the three CSVs (about 3,200 rows) into the chat to find the data issues. | Ran a small profiling script and read only its summary, then looked at the few rows it named. |
| **AI Credits used** | _(not measured)_ | _(team to fill in from the trainer's readings)_ |
| **Output quality (evidence)** | _(not measured)_ | Every data issue is tied to named rows (TXN-001166, TXN-000921 and so on), and the golden test in `server/test/importer.test.ts` asserts the exact counts. |

**Why this should cut credits:** the model never needs the raw rows in its context. The summary holds what the decisions need (which ids repeat, which rows have no amount, which countries need cleaning). Each task in `docs/plan.md` also lists only the files it needs, which keeps later prompts small.

## 5. Model assignment

The models assigned to each phase in `docs/plan.md`. Actual model use per phase is for the team to confirm from its own usage history.

| Phase | Work | Model tier assigned |
|---|---|---|
| Plan | Rules, data decisions, deliverable split (D0–D7) | Frontier |
| Scaffold and conventions | D0, D1 | Low-cost for templated work |
| Build | D2 importer, D3 rules engine, D4 API, D5 dashboard | Sonnet for logic that decides what gets flagged, Haiku for scaffolding and wiring |
| Tests and review | D6 tests, D7 Reviewer pass and fixes | Sonnet |
| Docs | D7.3, D7.4 | Low-cost |
