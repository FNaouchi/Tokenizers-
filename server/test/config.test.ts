import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from '../src/config.js';

function writeConfig(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'aml-config-'));
  const file = join(dir, 'rules.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const validFile = {
  large_amount_kwd: '3000.000',
  velocity: { min_count: 5, window_minutes: 60 },
  high_risk_countries_csv: 'data/high_risk_countries.csv',
};

describe('loadConfig', () => {
  it('loads the default config/rules.json with the documented limits', () => {
    const config = loadConfig({ env: {} });
    expect(DEFAULT_CONFIG_PATH.endsWith('config/rules.json')).toBe(true);
    expect(config.largeAmountKwd).toBe('3000.000');
    expect(config.velocity).toEqual({ minCount: 5, windowMinutes: 60 });
    expect(config.highRiskCountriesPath.endsWith('data/high_risk_countries.csv')).toBe(true);
  });

  it('lets environment variables override the file', () => {
    const config = loadConfig({
      file: writeConfig(validFile),
      env: { AML_LARGE_AMOUNT_KWD: '5000.500', AML_VELOCITY_MIN_COUNT: '4', AML_VELOCITY_WINDOW_MINUTES: '30' },
    });
    expect(config.largeAmountKwd).toBe('5000.500');
    expect(config.velocity).toEqual({ minCount: 4, windowMinutes: 30 });
  });

  it('reports every invalid value at once', () => {
    const file = writeConfig({
      ...validFile,
      large_amount_kwd: '3000.0001',
      velocity: { min_count: 0, window_minutes: '60' },
    });
    const error = (() => {
      try {
        loadConfig({ file, env: {} });
      } catch (err) {
        return err;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).problems).toHaveLength(2);
  });

  it('rejects a money limit with more than 3 decimal places, and a non-integer count', () => {
    expect(() => loadConfig({ file: writeConfig({ ...validFile, large_amount_kwd: '3000.0001' }), env: {} })).toThrow(ConfigError);
    expect(() => loadConfig({ file: writeConfig({ ...validFile, velocity: { min_count: 5.5, window_minutes: 60 } }), env: {} })).toThrow(ConfigError);
  });
});
