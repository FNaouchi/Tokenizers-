import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RulesConfig {
  /** Decimal string with at most 3 places, e.g. "3000.000". */
  largeAmountKwd: string;
  velocity: {
    minCount: number;
    windowMinutes: number;
  };
  /** Absolute path to the high-risk countries CSV. */
  highRiskCountriesPath: string;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid rules configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_CONFIG_PATH = resolve(repoRoot, 'config/rules.json');

const KWD_PATTERN = /^\d+(\.\d{1,3})?$/;
const POSITIVE_INT_PATTERN = /^[1-9]\d*$/;

interface RawConfig {
  large_amount_kwd?: unknown;
  velocity?: { min_count?: unknown; window_minutes?: unknown };
  high_risk_countries_csv?: unknown;
}

export interface LoadConfigOptions {
  /** Path to the JSON file. Defaults to config/rules.json at the repo root. */
  file?: string;
  /** Environment for overrides. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Loads the rule limits. Environment variables override the file:
 * AML_LARGE_AMOUNT_KWD, AML_VELOCITY_MIN_COUNT, AML_VELOCITY_WINDOW_MINUTES.
 * Throws ConfigError listing every problem found.
 */
export function loadConfig(options: LoadConfigOptions = {}): RulesConfig {
  const file = options.file ?? DEFAULT_CONFIG_PATH;
  const env = options.env ?? process.env;

  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as RawConfig;
  } catch (err) {
    throw new ConfigError([`Cannot read or parse ${file}: ${(err as Error).message}`]);
  }

  const problems: string[] = [];

  const largeAmount = env.AML_LARGE_AMOUNT_KWD ?? raw.large_amount_kwd;
  if (typeof largeAmount !== 'string' || !KWD_PATTERN.test(largeAmount)) {
    problems.push(
      `large_amount_kwd must be a decimal string with at most 3 places, got ${JSON.stringify(largeAmount)}`,
    );
  }

  const minCount = parseIntSetting(
    'velocity.min_count',
    env.AML_VELOCITY_MIN_COUNT ?? raw.velocity?.min_count,
    problems,
  );
  const windowMinutes = parseIntSetting(
    'velocity.window_minutes',
    env.AML_VELOCITY_WINDOW_MINUTES ?? raw.velocity?.window_minutes,
    problems,
  );

  const csv = raw.high_risk_countries_csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    problems.push('high_risk_countries_csv must be a non-empty path');
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  const csvPath = csv as string;
  return {
    largeAmountKwd: largeAmount as string,
    velocity: { minCount, windowMinutes },
    highRiskCountriesPath: isAbsolute(csvPath) ? csvPath : resolve(repoRoot, csvPath),
  };
}

function parseIntSetting(name: string, value: unknown, problems: string[]): number {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !POSITIVE_INT_PATTERN.test(text)) {
    problems.push(`${name} must be a positive whole number, got ${JSON.stringify(value)}`);
    return NaN;
  }
  return Number(text);
}
