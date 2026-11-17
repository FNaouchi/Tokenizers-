import { describe, expect, it } from 'vitest';
import { formatFils, formatFilsGrouped, parseKwdToFils } from '../src/money.js';

describe('parseKwdToFils', () => {
  it('parses whole, partial and full 3-decimal amounts into integer fils', () => {
    expect(parseKwdToFils('1234')).toBe(1_234_000);
    expect(parseKwdToFils('0.1')).toBe(100);
    expect(parseKwdToFils('8.674')).toBe(8_674);
    expect(parseKwdToFils('0.001')).toBe(1);
  });

  it('keeps the values on either side of the 3,000.000 limit exact', () => {
    expect(parseKwdToFils('3000.000')).toBe(3_000_000);
    expect(parseKwdToFils('2999.999')).toBe(2_999_999);
    expect(parseKwdToFils('3000.001')).toBe(3_000_001);
  });

  it('has no floating-point drift when amounts are added', () => {
    expect(parseKwdToFils('0.1')! + parseKwdToFils('0.2')!).toBe(parseKwdToFils('0.3'));
  });

  it.each(['', '  ', 'abc', '-5', '1.2345', '1,000.500', '1e3', '.5', '5.', '12 000'])('rejects %j', (text) => {
    expect(parseKwdToFils(text)).toBeNull();
  });

  it('rejects a value too large to hold exactly', () => {
    expect(parseKwdToFils('99999999999999999')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats fils with exactly 3 decimals', () => {
    expect(formatFils(3_000_000)).toBe('3000.000');
    expect(formatFils(5)).toBe('0.005');
    expect(formatFils(2_999_999)).toBe('2999.999');
  });

  it('adds thousands separators for reasons', () => {
    expect(formatFilsGrouped(4_830_000)).toBe('4,830.000');
    expect(formatFilsGrouped(12_499_999)).toBe('12,499.999');
    expect(formatFilsGrouped(999)).toBe('0.999');
  });
});
