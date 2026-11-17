import { loadConfig } from '../config.js';
import { DEFAULT_DB_PATH, openDatabase } from '../db.js';
import { applyRules } from './engine.js';

const db = openDatabase(process.env.AML_DB_PATH ?? DEFAULT_DB_PATH);
console.log('Rule summary:', applyRules(db, loadConfig()));
db.close();
