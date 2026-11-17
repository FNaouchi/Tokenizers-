import express, { type ErrorRequestHandler, type Express } from 'express';
import type Database from 'better-sqlite3';
import type { RulesConfig } from '../config.js';
import { formatFils, parseKwdToFils } from '../money.js';
import {
  parseFlagsQuery,
  parseNotAssessedQuery,
  parseSummaryQuery,
  sendBadRequest,
  sendInternalError,
  sendNotFound,
  sendValidationError,
} from './http.js';
import {
  flagSummary,
  getFilterOptions,
  getHighRiskCountries,
  getImportReport,
  getTransaction,
  listFlagged,
  listNotAssessed,
} from './queries.js';

/** Builds the API. Route handlers only validate input, call the query layer and shape the response. */
export function createApp(db: Database.Database, config: RulesConfig): Express {
  const limitFils = parseKwdToFils(config.largeAmountKwd);
  if (limitFils === null) throw new Error(`Invalid large amount limit: ${config.largeAmountKwd}`);

  const app = express();
  const api = express.Router();

  api.get('/flags', (req, res) => {
    const parsed = parseFlagsQuery(req.query);
    if (!parsed.ok) return sendValidationError(res, parsed.errors);
    const { limit, offset, sort, ...filters } = parsed.value;
    res.json(listFlagged(db, filters, { limit, offset }, sort));
  });

  api.get('/flags/summary', (req, res) => {
    const parsed = parseSummaryQuery(req.query);
    if (!parsed.ok) return sendValidationError(res, parsed.errors);
    res.json(flagSummary(db, parsed.value));
  });

  api.get('/not-assessed', (req, res) => {
    const parsed = parseNotAssessedQuery(req.query);
    if (!parsed.ok) return sendValidationError(res, parsed.errors);
    const { limit, offset, account_id } = parsed.value;
    res.json(listNotAssessed(db, { account_id }, { limit, offset }));
  });

  api.get('/transactions/:transaction_id', (req, res) => {
    const transaction = getTransaction(db, req.params.transaction_id);
    if (!transaction) return sendNotFound(res, `Transaction ${req.params.transaction_id} does not exist.`);
    res.json(transaction);
  });

  api.get('/config', (_req, res) => {
    res.json({
      large_amount_kwd: formatFils(limitFils),
      velocity: { min_count: config.velocity.minCount, window_minutes: config.velocity.windowMinutes },
      high_risk_countries: getHighRiskCountries(db),
      ...getFilterOptions(db),
    });
  });

  api.get('/import-report', (_req, res) => {
    const report = getImportReport(db);
    if (!report) return sendNotFound(res, 'No import report found. Run npm run import.');
    res.json(report);
  });

  app.use('/api', api);

  app.use((_req, res) => sendNotFound(res, 'No such endpoint.'));

  const onError: ErrorRequestHandler = (err: { status?: number; statusCode?: number }, _req, res, _next) => {
    const status = err.status ?? err.statusCode;
    // Express reports unreadable requests (for example a bad percent-encoding) with a 4xx status.
    if (status !== undefined && status >= 400 && status < 500) return sendBadRequest(res);
    console.error(err);
    sendInternalError(res);
  };
  app.use(onError);

  return app;
}
