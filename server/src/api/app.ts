import express, { type ErrorRequestHandler, type Express } from 'express';
import type Database from 'better-sqlite3';
import type { RulesConfig } from '../config.js';
import { formatFils, parseKwdToFils } from '../money.js';
import { parseFlagsQuery, parseSummaryQuery, sendNotFound, sendValidationError } from './http.js';
import { flagSummary, getHighRiskCountries, getImportReport, getTransaction, listFlagged } from './queries.js';

/** Builds the API. Route handlers only validate input, call the query layer and shape the response. */
export function createApp(db: Database.Database, config: RulesConfig): Express {
  const app = express();
  const api = express.Router();

  api.get('/flags', (req, res) => {
    const parsed = parseFlagsQuery(req.query);
    if (!parsed.ok) return sendValidationError(res, parsed.errors);
    const { limit, offset, ...filters } = parsed.value;
    res.json(listFlagged(db, filters, { limit, offset }));
  });

  api.get('/flags/summary', (req, res) => {
    const parsed = parseSummaryQuery(req.query);
    if (!parsed.ok) return sendValidationError(res, parsed.errors);
    res.json(flagSummary(db, parsed.value.account_id));
  });

  api.get('/transactions/:transaction_id', (req, res) => {
    const transaction = getTransaction(db, req.params.transaction_id);
    if (!transaction) return sendNotFound(res, `Transaction ${req.params.transaction_id} does not exist.`);
    res.json(transaction);
  });

  api.get('/config', (_req, res) => {
    res.json({
      large_amount_kwd: formatFils(parseKwdToFils(config.largeAmountKwd) ?? 0),
      velocity: { min_count: config.velocity.minCount, window_minutes: config.velocity.windowMinutes },
      high_risk_countries: getHighRiskCountries(db),
    });
  });

  api.get('/import-report', (_req, res) => {
    const report = getImportReport(db);
    if (!report) return sendNotFound(res, 'No import report found. Run npm run import.');
    res.json(report);
  });

  app.use('/api', api);

  app.use((_req, res) => sendNotFound(res, 'No such endpoint.'));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  };
  app.use(onError);

  return app;
}
