import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtCurrency, parseNumber, uuid } from '../src/utils.js';

describe('parseNumber', () => {
  it('converts different value types to safe numbers', () => {
    expect(parseNumber('42.5')).toBe(42.5);
    expect(parseNumber(10)).toBe(10);
    expect(parseNumber('')).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber('not-a-number')).toBe(0);
  });
});

describe('fmtCurrency', () => {
  it('formats currency using USD locale defaults', () => {
    expect(fmtCurrency(1234.56)).toBe('$1,234.56');
  });

  it('defaults to zero when value is not finite', () => {
    expect(fmtCurrency(Number.NaN)).toBe('$0.00');
    expect(fmtCurrency('' as unknown as number)).toBe('$0.00');
  });
});

describe('uuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn().mockReturnValue('crypto-uuid');
    vi.stubGlobal('crypto', { randomUUID });

    expect(uuid()).toBe('crypto-uuid');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to a deterministic format when crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    const result = uuid();

    expect(result).toMatch(/^id-[0-9a-z]+-[0-9a-f]{8}$/);
  });
});
