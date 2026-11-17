# API contract

Base path `/api`. JSON, snake_case. Money is a string with 3 decimals. Timestamps are ISO 8601 in Kuwait time (`+03:00`). Rule limits come from `config/rules.json`.

## Shared shapes

**Flag**

```json
{
  "rule_id": "VELOCITY",
  "reason": "VELOCITY: 6 transactions in 39 min (limit: 5 in 60 min)",
  "details": {
    "count": 6,
    "span_seconds": 2346,
    "window_start": "2026-10-14T02:10:14+03:00",
    "window_end": "2026-10-14T02:49:20+03:00",
    "limit_count": 5,
    "limit_window_minutes": 60,
    "related_transaction_ids": ["TXN-000580", "TXN-000581"]
  }
}
```

`details` by rule:
- `LARGE_AMOUNT`: `{amount_kwd, limit_kwd}`
- `HIGH_RISK_COUNTRY`: `{country_code, country_name, list_reason}`
- `VELOCITY`: as above. `reason` shows the largest qualifying window that contains the transaction, and `related_transaction_ids` lists the other transactions in it.

**Flagged transaction**

```json
{
  "transaction_id": "TXN-000585",
  "timestamp": "2026-10-01T02:31:40+03:00",
  "account": {"account_id": "ACC-100118", "customer_segment": "SME", "home_branch": "Jahra"},
  "direction": "DEBIT",
  "transaction_type": "TRANSFER_INTERNATIONAL",
  "channel": "ONLINE",
  "amount_kwd": "1250.500",
  "counterparty_country": "XB",
  "flags": [{"rule_id": "VELOCITY", "reason": "...", "details": {}}, {"rule_id": "HIGH_RISK_COUNTRY", "reason": "...", "details": {}}],
  "data_quality": ["COUNTRY_NORMALISED"]
}
```

`amount_kwd` and `counterparty_country` are `null` when missing. `data_quality` holds zero or more of `MISSING_AMOUNT`, `MISSING_COUNTRY`, `INVALID_COUNTRY` (the country value was not a 2-letter code, so it was stored as `null`), `COUNTRY_NORMALISED`, `UTC_TIMESTAMP`.

**Error** (all errors)

```json
{"error": {"code": "VALIDATION_FAILED", "message": "The request has 1 invalid field.", "details": [{"field": "rule", "problem": "Must be one of LARGE_AMOUNT, VELOCITY, HIGH_RISK_COUNTRY.", "value": "FOO"}]}}
```

`details` is always present. It lists the invalid fields for `VALIDATION_FAILED` and is `[]` for the other codes: `BAD_REQUEST` (400, a request that can't be read, such as a badly encoded URL), `NOT_FOUND` (404) and `INTERNAL_ERROR` (500, with a general message only).

## GET /api/flags

Returns flagged transactions, newest first. Each transaction appears once with all the flags that fired.

- **Query:** `rule` (optional, one of `LARGE_AMOUNT`, `VELOCITY`, `HIGH_RISK_COUNTRY`), `account_id` (optional, `ACC-` followed by digits), `limit` (optional, 1 to 500, default 50), `offset` (optional, default 0).
- **Filter behaviour:** with `rule`, only transactions that fired that rule are returned, and their `flags` still list every rule that fired.
- **Response 200:** `{"items": [Flagged transaction], "total": 115, "limit": 50, "offset": 0}`
- **Errors:** `400` `VALIDATION_FAILED` for an unknown `rule`, a malformed `account_id`, or a bad `limit` or `offset`. All problems are reported together. An account with no flags returns `200` with an empty list.

## GET /api/flags/summary

Counts used by the dashboard cards.

- **Query:** `account_id` (optional). When set, the counts only cover that account.
- **Response 200:**

```json
{
  "by_rule": {"LARGE_AMOUNT": 73, "VELOCITY": 28, "HIGH_RISK_COUNTRY": 16},
  "flagged_transactions": 115,
  "total_transactions": 3077
}
```

`by_rule` always has all 3 rules, with `0` for rules that didn't fire. A transaction with 2 flags counts once under each rule and once in `flagged_transactions`.
- **Errors:** `400` for a malformed `account_id`.

## GET /api/transactions/{transaction_id}

Returns one loaded transaction, flagged or not.

- **Request:** no body
- **Response 200:** a Flagged transaction, with `flags` as `[]` if nothing fired
- **Errors:** `404` `NOT_FOUND` if the id doesn't exist

## GET /api/not-assessed

Lists transactions that a rule could not check because a value was missing or unusable, so an analyst can review them by hand. A transaction with no amount can't be tested for `LARGE_AMOUNT`, and one with no usable country can't be tested for `HIGH_RISK_COUNTRY`. A transaction here may also have flags from the rules that could run.

- **Query:** `account_id` (optional), `limit` (optional, 1 to 500, default 50), `offset` (optional, default 0).
- **Response 200:** `{"items": [Flagged transaction + not_assessed], "total": 4, "limit": 50, "offset": 0}`, newest first. `not_assessed` is a list of rule ids, for example `["LARGE_AMOUNT"]` for a missing amount and `["HIGH_RISK_COUNTRY"]` for a missing or invalid country.
- **Errors:** `400` `VALIDATION_FAILED` for a malformed `account_id` or a bad `limit` or `offset`.

## GET /api/config

Returns the limits the rules are using, so the dashboard can show them.

- **Response 200:**

```json
{
  "large_amount_kwd": "3000.000",
  "velocity": {"min_count": 5, "window_minutes": 60},
  "high_risk_countries": [{"country_code": "XA", "country_name": "Xandria", "reason": "Fictional: strategic AML/CFT deficiencies"}]
}
```

## GET /api/import-report

Returns what the import did with the data issues.

- **Response 200:**

```json
{
  "rows_read": 3079,
  "rows_loaded": 3077,
  "duplicates_dropped": 2,
  "rows_rejected": 0,
  "missing_amount": 1,
  "missing_country": 3,
  "country_normalised": 2,
  "invalid_country": 0,
  "utc_timestamps": 3
}
```

- **Errors:** `404` `NOT_FOUND` if the database has no import report (run `npm run import`).

Rows read equals rows loaded plus duplicates dropped plus rows rejected. Rows in `accounts.csv` that are rejected are written to `import_rejects`, and their transactions are rejected as `UNKNOWN_ACCOUNT`, so they show up in `rows_rejected`. A malformed row in `high_risk_countries.csv` stops the import.
