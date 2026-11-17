import { existsSync } from 'node:fs';
import { createApp } from './api/app.js';
import { loadConfig } from './config.js';
import { DEFAULT_DB_PATH, openDatabase } from './db.js';
import { applyRules } from './rules/engine.js';

const dbPath = process.env.AML_DB_PATH ?? DEFAULT_DB_PATH;
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}. Run "npm run import" first.`);
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(dbPath);
// Re-apply the rules so the stored flags always match the current config.
console.log('Rule summary:', applyRules(db, config));

const port = Number(process.env.PORT ?? 3001);
createApp(db, config).listen(port, () => {
  console.log(`AML API listening on http://localhost:${port}`);
});
