# Data import

- **Database:** SQLite at `data/aml.db` (generated, git-ignored). Schema in `server/src/db.ts`.
- **Import command:** `npm run import` from the repo root. It deletes and rebuilds the database, so it is safe to run again. Set `AML_DB_PATH` to write somewhere else.

## Tables

| Table | Source file | Primary key | Foreign keys | Notes |
|---|---|---|---|---|
| `accounts` | `accounts.csv` | `account_id` | none | Segment limited to RETAIL, SME, CORPORATE. |
| `high_risk_countries` | `high_risk_countries.csv` | `country_code` | none | Codes trimmed and upper-cased. The file path comes from `config/rules.json`. |
| `transactions` | `transactions.csv` | `transaction_id` | `account_id` → `accounts` | Times as UTC epoch ms (`ts_epoch_ms`) plus the original text. Money as integer fils (`amount_kwd_fils`). `source_row` is the line in the file (header is line 1). `dq_notes` is a JSON array. |
| `import_rejects` | all three | id | none | Every row that was dropped or rejected: file, source row, reason, raw values. |
| `import_report` | transactions | one row | none | The counts returned by `GET /api/import-report`. |
| `flags` | written by the rules engine (D3) | `transaction_id`, `rule_id` | `transaction_id` → `transactions` | Empty after import. |

## Data issues

| Issue | File and column | Rows | Decision | How | Test |
|---|---|---:|---|---|---|
| Identical duplicate `transaction_id` (TXN-001166, TXN-002808) | transactions, `transaction_id` | 2 | Reject as a duplicate | Keep the first row. The repeat is written to `import_rejects` as `DUPLICATE_IDENTICAL` and counted in `duplicates_dropped`, not `rows_rejected`. Done before any rule runs. | D6.4 |
| Same id, different content | transactions, `transaction_id` | 0 | Reject | Keep the first row. The repeat is rejected as `DUPLICATE_CONFLICT`. | D6.4 |
| Missing country | transactions, `counterparty_country` | 3 | Flag | Load with NULL and note `MISSING_COUNTRY`. | D6.4 |
| Missing amount (TXN-000921) | transactions, `amount_kwd` | 1 | Flag | Load with NULL and note `MISSING_AMOUNT`. | D6.4 |
| Country case or spaces (`xd`, ` xb`) | transactions, `counterparty_country` | 2 | Fix | Trim and upper-case, note `COUNTRY_NORMALISED`. | D6.4 |
| Country not two letters after cleaning | transactions, `counterparty_country` | 0 | Reject | `INVALID_COUNTRY_CODE`. | D6.4 |
| UTC timestamps ending in `Z` | transactions, `timestamp` | 3 | Fix | Stored as the same instant as UTC epoch ms, note `UTC_TIMESTAMP`. Shown in Kuwait time. | D6.2 |
| Late-arriving rows (last 5 of the file) | transactions, file order | 5 | Fix | Nothing is stored by file order. Rules sort by `ts_epoch_ms`. | D6.3 |
| Invalid timestamp, amount, direction, or missing required field | transactions | 0 | Reject | `INVALID_TIMESTAMP`, `INVALID_AMOUNT`, `INVALID_DIRECTION`, `MISSING_FIELD:<name>`. | D6.4 |
| Account not in `accounts.csv` | transactions, `account_id` | 0 | Reject | `UNKNOWN_ACCOUNT`. | D6.4 |

## Import report

Run on the real data:

| File | Rows read | Loaded | Fixed | Flagged | Rejected |
|---|---:|---:|---:|---:|---:|
| `transactions.csv` | 3,079 | 3,077 | 5 | 4 | 0 (plus 2 identical duplicates dropped) |
| `accounts.csv` | 150 | 150 | 0 | 0 | 0 |
| `high_risk_countries.csv` | 4 | 4 | 0 | 0 | 0 |

For transactions, rows read (3,079) = loaded (3,077) + duplicates dropped (2) + rejected (0). Fixed is 2 country codes and 3 UTC timestamps. Flagged is 3 missing countries and 1 missing amount.
