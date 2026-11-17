---
name: rule-tests
description: Writes automated tests for an AML rule, importer step or API endpoint in this project. Covers the normal case, the exact limits and every data-quality issue in data/README.md, using small inline fixtures. Use when adding or changing a rule, the importer or an endpoint, or when asked for tests.
---

# Rule tests

Write Vitest tests for the code in the request. Follow `.github/copilot-instructions.md` for conventions. Tests live in `server/test/` and run with `npm test`.

## 1. Read before writing

- The rule or step under test, and its decision in `docs/plan.md` ("Locked decisions" table).
- `data/README.md`, for the data issues.
- Read only those files, not the whole repo.

## 2. Cover each of these

For a rule:

- **Normal case:** a clear hit, and a clear miss. Assert the whole `reason` text and the main `details` values.
- **Exact limits:** the value exactly at the limit, one step below it and one step above. Examples: 3000.000 and 2999.999 KWD; a span of exactly 60:00, and 60:01; 4 versus 5 transactions.
- **Config:** a different limit changes the result with no code change.
- **Data-quality cases:** a missing amount or country, a country in the wrong case or with spaces, duplicate ids (counted once), rows out of time order, a `Z` timestamp mixed with `+03:00`, and a burst that crosses midnight.
- **Multiple flags:** one transaction that fires several rules keeps all of them.

For the importer: a fixture file with one row per issue. Check the row counts add up (`rows_read` = loaded + duplicates dropped + rejected), the stored values, the data-quality notes, and that each dropped or rejected row has a reason in `import_rejects`.

For an endpoint (supertest): a success with the response shape, each filter alone and combined, paging, invalid input (all problems reported at once), and a missing item (404). Check the error format `{error: {code, message, details}}`.

## 3. Rules for the tests

- Money is integer fils. Never use floats in expected values.
- Use small inline fixtures (`server/test/helpers.ts`). Use the real CSVs only for the one golden test.
- Name each test after the behaviour it proves, for example `flags a span of exactly 60 minutes`.
- Write each case once. Don't copy the same case into several files.
- A bug fix needs a regression test that fails without the fix.

## 4. Check

Run `npm test`. Every test must pass, and a test you add must fail when the behaviour it covers is broken. Then update the traceability table in the README.
