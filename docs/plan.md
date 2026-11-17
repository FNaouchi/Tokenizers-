# AML Transaction Flagger: Plan (v2)

## Problem and approach
A compliance analyst needs a local app that flags suspicious transactions in the October 2026 data using 3 explainable rules: LARGE_AMOUNT, VELOCITY and HIGH_RISK_COUNTRY. Limits live in config. The back end serves a JSON API, and a React dashboard reads only from that API. The work is split into 8 deliverables (D0–D7). Each task is assigned to **Sonnet** or **Haiku** with a thinking effort that matches how hard it is.

**Model policy**
- **Sonnet** for tasks where a subtle mistake changes which transactions get flagged: time windows, decimal amounts, deduplication and review.
- **Haiku** for mechanical, well-specified tasks: scaffolding, boilerplate, documentation, UI wiring and tests that follow a skill.
- **Thinking effort:** `low` for copying a template, `medium` for following a clear spec, `high` for algorithms and edge cases.
- To keep context small, each task gets only the files listed in its **Context** line.

## Stack and layout
- Node 20+/TypeScript, using npm workspaces.
- `server/`: Express, better-sqlite3 (pinned to ^13, because 11.x does not compile on Node 26), csv-parse, Vitest and supertest, run with tsx.
  - `src/money.ts`: string ⇄ integer fils (KWD × 1000), never `parseFloat`.
  - `src/time.ts`: ISO-with-offset → UTC epoch ms → display in Kuwait time (+03:00).
  - `src/config.ts`: loads `config/rules.json` and validates it, with environment-variable overrides.
  - `src/import/`: profiling, cleaning and loading into `data/aml.db`.
  - `src/rules/`: pure functions plus `engine.ts`.
  - `src/api/`: thin Express routes.
  - `test/`: tests for each module, plus fixtures.
- `web/`: React + Vite, with a Vite proxy from `/api` to the server.
- `config/rules.json`: `{ "large_amount_kwd": "3000.000", "velocity": { "min_count": 5, "window_minutes": 60 }, "high_risk_countries_csv": "data/high_risk_countries.csv" }`
- Commands: `npm install`, `npm run import`, `npm run dev`, `npm test`.

## Locked decisions (each one has a test)
| # | Topic | Decision |
|---|---|---|
| 1 | Explainability | Each flag has a `reason` string and structured `details`. Examples: `LARGE_AMOUNT: 4,830.000 KWD (limit: ≥ 3,000.000 KWD)`, `VELOCITY: 6 transactions in 39 min (limit: 5 in 60 min)`, `HIGH_RISK_COUNTRY: XB Belvaria (Fictional: under increased monitoring)`. |
| 2 | Multiple flags | A transaction appears once, with an array of all the flags that fired. |
| 3 | Bursts | Every transaction in any qualifying window gets the flag. Its reason shows the largest window that contains it, and `details.related_transaction_ids` lists the others. |
| 4 | Boundaries | 3,000.000 KWD **is** flagged and 2,999.999 KWD is not. A span of exactly 60:00 **is** inside the window (ACC-100069), but 60:01 is not (ACC-100054). 4 transactions do not trigger VELOCITY. |
| 5a | Duplicate IDs (TXN-001166, TXN-002808) | Keep the first row and drop identical repeats, counting them in the report. A repeat with different content goes to `rejected_rows` as `DUPLICATE_CONFLICT`. Duplicates are removed before the rules run. Without this, ACC-100107 would get a false burst and TXN-001166 would be counted twice. |
| 5b | Missing country (TXN-001143, TXN-002893, TXN-003002) | Store NULL and add a `MISSING_COUNTRY` data-quality note. HIGH_RISK_COUNTRY can't fire, but the other rules still apply. |
| 5c | Missing amount (TXN-000921) | Keep the row with a NULL amount and add a `MISSING_AMOUNT` note. LARGE_AMOUNT is skipped, but the row still counts for VELOCITY and HIGH_RISK_COUNTRY. |
| 5d | Country case or spaces (`xd`, ` xb`) | Trim and upper-case the code before storing and comparing it, and add a `COUNTRY_NORMALISED` note. The high-risk list gets the same normalisation. |
| 5e | Late rows (TXN-003073 to TXN-003077) | File order is ignored, and VELOCITY sorts by UTC time for each account. TXN-003074 completes the ACC-100072 burst. |
| 5f | `Z` timestamps (TXN-001557, TXN-001857, TXN-002458) | Store as a UTC instant and display in +03:00. TXN-002458 (07:20Z = 10:20 Kuwait time) completes the ACC-100023 burst. |
| 5g | Other bad rows (bad timestamp or amount format, unknown account) | Reject to `rejected_rows` with a reason. None are expected in this data. |
| 6 | Money | Integer fils everywhere. The API returns `"3000.000"` strings. |

## Golden numbers (acceptance test on the real data)
These were computed while profiling with Python `Decimal` and the decisions above.
- Rows in the file: 3,079. Rows loaded: **3,077** (2 identical duplicates dropped). Rows rejected: 0.
- LARGE_AMOUNT **73**, VELOCITY **28**, HIGH_RISK_COUNTRY **16**.
- Flagged transactions (union): **115**. Transactions with more than one flag: **2** (TXN-003053 is LARGE + HRC, and TXN-000585 is VEL + HRC).

---

## Deliverables and tasks

### D0: Conventions and contracts (do this first)
| Task | Model | Effort | Context |
|---|---|---|---|
| D0.1: Copy this plan to `docs/plan.md`, and fill in the budget table in `docs/ai-credit-budget.md` | Haiku | low | plan.md, the budget doc |
| D0.2: Fill in the TODOs in `.github/copilot-instructions.md`: stack, layout, API conventions (`/api` prefix, snake_case, 3-decimal money strings, +03:00 timestamps, error format `{error:{code,message,details}}` from the `api-endpoint` skill, 400/404), how a rule returns `{rule_id, reason, details}`, and the test command | Haiku | medium | the instructions file, `api-endpoint` skill reference |
| D0.3: Write the `docs/api.md` contract for the 5 endpoints (see D4) | Sonnet | medium | the instructions file, plan D4 |

**Acceptance:** none of the 3 files contain TODOs, and the API contract has been reviewed by a person.

### D1: Scaffold
| Task | Model | Effort | Context |
|---|---|---|---|
| D1.1: Set up npm workspaces, the TypeScript config, `server` and `web` packages, scripts (`import`, `dev`, `test`), and `config/rules.json` | Haiku | low | plan stack section |
| D1.2: Write `config.ts` to load and validate the config (positive integers, decimal string limit), with environment-variable overrides | Haiku | medium | plan, rules.json |

**Acceptance:** `npm install && npm test` runs and passes with an empty suite. An invalid config fails with a clear error.

### D2: Data import (database)
| Task | Model | Effort | Context |
|---|---|---|---|
| D2.1: `money.ts`, a strict decimal parser to fils (rejects more than 3 decimal places, letters and empty strings), plus a formatter | Sonnet | medium | plan decision 6 |
| D2.2: `time.ts`, which parses offset and `Z` timestamps, converts to UTC epoch ms, and formats in Kuwait time | Haiku | medium | plan 5f |
| D2.3: SQLite schema (`accounts`, `high_risk_countries`, `transactions`, `rejected_rows`, `import_report`, `flags`) | Haiku | medium | plan |
| D2.4: Importer: deduplication (identical vs conflicting), country normalisation, NULL handling, data-quality notes, rejections, report counts. It must give the same result every time it runs (drop and rebuild). | Sonnet | high | data-import skill, data/README.md, plan 5a–5g |

**Acceptance:** after `npm run import`, the report shows read 3,079 / loaded 3,077 / duplicates 2 / rejected 0 / missing country 3 / missing amount 1 / country normalised 2 / UTC timestamps 3.

### D3: Rules engine (back end)
| Task | Model | Effort | Context |
|---|---|---|---|
| D3.1: `largeAmount` and `highRiskCountry`, as pure functions that return reasons | Haiku | medium | plan decisions 1, 4, 5b–5d |
| D3.2: `velocity`: two-pointer window for each account sorted by UTC time, inclusive span, flags every transaction in each qualifying window, picks the largest window for each transaction's reason, and lists related IDs | **Sonnet** | **high** | plan decisions 3, 4, 5e, 5f |
| D3.3: `engine.ts`: runs all the rules using the config, merges the flags for each transaction, and saves them to the `flags` table | Sonnet | medium | rules, the schema |

**Acceptance:** the golden numbers match, and changing the config (for example LARGE to 5000.000, or VELOCITY to 4 in 30) changes the results with no code changes.

### D4: API
| Task | Model | Effort | Context |
|---|---|---|---|
| D4.1: `GET /api/flags?rule=&account_id=` returns flagged items with account context (`customer_segment`, `home_branch`), flags with reasons and details, and data-quality notes. An unknown rule or an invalid account ID returns 400. | Haiku | high | docs/api.md, api-endpoint skill |
| D4.2: `GET /api/flags/summary` returns counts per rule, the number of flagged transactions and the total, using the same filters | Haiku | medium | docs/api.md |
| D4.3: `GET /api/transactions/:id` (404 if not found), `GET /api/config`, `GET /api/import-report` | Haiku | medium | docs/api.md |

**Acceptance:** `curl` responses match `docs/api.md`, and route handlers contain no rule logic.

### D5: Front end
| Task | Model | Effort | Context |
|---|---|---|---|
| D5.1: Typed API client and layout. Header shows the active limits from `/api/config`. | Haiku | medium | docs/api.md |
| D5.2: Summary cards with the count per rule (click a card to filter), a rule dropdown and an account search | Haiku | medium | docs/api.md |
| D5.3: Review table: time (Kuwait), account, segment, branch, amount, country, rule badges with reason text, and data-quality badges. Expanding a row shows related burst transactions. | Sonnet | medium | docs/api.md, D5.1 |
| D5.4: Data-quality panel, from `/api/import-report` | Haiku | low | docs/api.md |

**Acceptance:** all data comes from `fetch('/api/…')`. The rule and account filters work together, and the counts match the summary endpoint.

### D6: Tests (each rule, each endpoint, each data issue)
| Task | Model | Effort | Context |
|---|---|---|---|
| D6.1: Write the `.github/skills/rule-tests/SKILL.md` prompt: cover the normal case, the limits and every data-quality case, using small inline fixtures | Haiku | low | the README example prompt |
| D6.2: Tests for `money` and `time` (3000.000 vs 2999.999, more than 3 decimal places, `Z` vs +03:00, the same instant written two ways) | Haiku | medium | rule-tests skill, the modules |
| D6.3: Rule tests: LARGE limits and NULL, HRC case/spaces and NULL, VELOCITY 4 vs 5, 60:00 vs 60:01, midnight crossing, late row, `Z` row, duplicates not double-counted, largest-window reason text | **Sonnet** | **high** | rule-tests skill, rules |
| D6.4: Importer tests (identical vs conflicting duplicates, every data-quality note, report counts) and the golden-number test on the real data | Sonnet | medium | rule-tests skill, the importer |
| D6.5: Endpoint tests with supertest: 200 response shape, filters, combined filters, 400, 404, config endpoint | Haiku | medium | docs/api.md, the routes |

**Acceptance:** `npm test` passes, and every row in the traceability table points to a test file.

### D7: Review, docs and demo
| Task | Model | Effort | Context |
|---|---|---|---|
| D7.1: Reviewer agent checks the rules engine and importer against the README rules and limits, listing findings by severity | Sonnet | high | rules/, import/, README rules |
| D7.2: Fix the findings and add a regression test for each one | Sonnet | medium | the findings, affected files |
| D7.3: README "Your solution" section: run and test steps, traceability table, retrospective (including what the reviewer caught) | Haiku | low | README, test file list |
| D7.4: Budget sheet: mid-point re-plan, actual usage, and a before/after example (for example, the same task with full repo context vs scoped context, or Sonnet vs Haiku) | Haiku | low | the budget doc |

## Dependencies
D0 → D1 → D2 → D3 → D4 → D5. D6.1 can be done at any time. D6.2 needs D2.1–D2.2, D6.3 needs D3, D6.4 needs D2.4 + D3, and D6.5 needs D4. D7 comes after D5 and D6.

## Budget (AI Credits)
| Phase | Deliverables | Mix | Budget |
|---|---|---|---:|
| Plan | this plan | Opus (done) | 150 |
| Scaffold + conventions | D0, D1 | mostly Haiku | 80 |
| Build | D2–D5 | Sonnet for D2.1, D2.4, D3.2–3, D5.3 and Haiku for the rest | 450 |
| Tests + review | D6, D7.1–7.2 | Sonnet for D6.3–6.4 and D7.1–7.2, Haiku for the rest | 200 |
| Docs + demo | D7.3–7.4 | Haiku | 40 |
| **Total** | | | **920** |

**Mid-point check (after D3):** compare actual usage with the budget. If usage is more than 15% over, move D5.3 and D6.4 to Haiku at high effort, and narrow the context further.
