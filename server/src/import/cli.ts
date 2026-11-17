import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '../config.js';
import { createFreshDatabase, DEFAULT_DB_PATH } from '../db.js';
import { ImportError, importAll } from './importer.js';
import { applyRules } from '../rules/engine.js';

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data');

try {
  const config = loadConfig();
  const db = createFreshDatabase(process.env.AML_DB_PATH ?? DEFAULT_DB_PATH);

  const report = importAll(db, {
    transactions: resolve(dataDir, 'transactions.csv'),
    accounts: resolve(dataDir, 'accounts.csv'),
    highRiskCountries: config.highRiskCountriesPath,
  });

  const rejects = db.prepare('SELECT reason, COUNT(*) AS n FROM import_rejects GROUP BY reason').all();
  console.log('Import report:', report);
  console.log('Rejected or dropped rows by reason:', rejects);
  console.log('Rule summary:', applyRules(db, config));
  db.close();
} catch (err) {
  if (err instanceof ImportError || err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
