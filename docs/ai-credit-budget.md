# AI Credit budget and usage

Fill in this sheet before you build, update it at the mid-point check, and complete it at the end. Your trainer uses it to score **Plan** and **Token efficiency**.

## 1. Budget per phase

Complete the budget before you start building, and explain each model choice. The [README](../README.md#-ai-credit-budget) has an example budget from the kickoff.

| Phase | Copilot feature | Model choice and why | Budget (AI Credits) | Actual at mid-point | Actual at end |
|---|---|---|---:|---:|---:|
| Plan | Plan mode / Ask | Frontier (Opus): rule semantics, bursts and data-quality decisions drive everything after | 150 | | |
| Scaffold | Agent mode + instructions file | Haiku, low/medium effort: templated work (D0, D1) | 80 | | |
| Build features | Agent / Edit mode | Sonnet, high/medium effort for importer, money, VELOCITY, engine, review table; Haiku for API, UI wiring, time, schema | 450 | | |
| Tests + review | Skill for tests, chat review | Sonnet, high effort for rule tests and the Reviewer pass; Haiku for the other tests | 200 | | |
| Docs + demo | Ask, README generation | Haiku, low effort | 40 | | |
| **Total** | | | **920** | | |

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

- **Credits used so far, compared with the budget for the phases you've done:**
- **What's going better or worse than planned:**
- **What you'll change for the second half (scope, models, context or prompts):**
- **Updated budget for the remaining phases:**

## 4. Before and after optimization

Show one concrete change to a prompt, the context or the model that cut credits without hurting the output.

| | Before | After |
|---|---|---|
| **What you did** | | |
| **AI Credits used** | | |
| **Output quality (evidence)** | | |

**What changed, and why it worked:**
