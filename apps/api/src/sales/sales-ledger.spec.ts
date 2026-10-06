import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ledgerDateRange, ledgerWhere } from './sales-ledger.js';
import { SalesLedgerQueryDto } from './ledger-query.dto.js';

describe('sales ledger date boundaries and validation', () => {
  const now = new Date('2026-10-06T19:00:00Z'); // October 7 in Dhaka
  it.each([
    ['today', '2026-10-06T18:00:00.000Z', '2026-10-07T18:00:00.000Z'],
    ['yesterday', '2026-10-05T18:00:00.000Z', '2026-10-06T18:00:00.000Z'],
    ['week', '2026-10-04T18:00:00.000Z', '2026-10-11T18:00:00.000Z'],
    ['month', '2026-09-30T18:00:00.000Z', '2026-10-31T18:00:00.000Z'],
  ] as const)('resolves %s in the business timezone', (date, from, until) => {
    const result = ledgerDateRange({ date }, now)!;
    expect(result.from.toISOString()).toBe(from);
    expect(result.until.toISOString()).toBe(until);
  });
  it('handles leap dates, month/year boundaries and inclusive end days', () => {
    expect(
      ledgerDateRange({
        date: 'specific',
        from: '2024-02-29',
      })?.until.toISOString(),
    ).toBe('2024-02-29T18:00:00.000Z');
    expect(
      ledgerDateRange({
        date: 'range',
        from: '2025-12-31',
        to: '2026-01-02',
      })?.until.toISOString(),
    ).toBe('2026-01-02T18:00:00.000Z');
    expect(
      ledgerDateRange(
        { date: 'month' },
        new Date('2026-12-31T19:00:00Z'),
      )?.until.toISOString(),
    ).toBe('2027-01-31T18:00:00.000Z');
  });
  it.each([
    { date: 'specific', from: '2026-02-30' },
    { date: 'range', from: '2026-10-07', to: '2026-10-06' },
    { date: 'range', from: '2026-10-07' },
  ] as const)('rejects invalid/inverted dates', (q) =>
    expect(() => ledgerDateRange(q)).toThrow(),
  );
  it('rejects inverted money ranges', () => {
    expect(() => ledgerWhere({ minTotal: 20, maxTotal: 10 })).toThrow();
    expect(() => ledgerWhere({ minDue: 20, maxDue: 10 })).toThrow();
  });
  it('validates and bounds query input without weakening authentication', async () => {
    expect(
      await validate(
        plainToInstance(SalesLedgerQueryDto, {
          page: '2',
          pageSize: '25',
          minTotal: '12.50',
          method: 'CASH',
        }),
      ),
    ).toHaveLength(0);
    for (const input of [
      { page: 0 },
      { pageSize: 101 },
      { method: 'INVALID' },
      { status: 'DRAFT' },
      { minDue: -1 },
      { sort: 'injected' },
      { search: ['x'] },
      { minTotal: 1.001 },
    ])
      expect(
        (await validate(plainToInstance(SalesLedgerQueryDto, input))).length,
      ).toBeGreaterThan(0);
  });
  it('parameterizes customer text, wildcard characters, and product input', () => {
    const attack = "%' OR TRUE --";
    const q = ledgerWhere({ customer: attack, product: '02#Pine_green' });
    expect(q.text).not.toContain(attack);
    expect(q.values).toContain("%\\%' OR TRUE --%");
    expect(q.values).toContain('%02#Pine\\_green%');
  });
});
