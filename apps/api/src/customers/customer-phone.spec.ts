import { normalizeCustomerPhone, customerPhoneError } from '@afia/contracts';
import { auditCustomerPhones } from './customer-phone-audit.js';
import {
  customerIdentityInput,
  isCustomerPhoneUniqueError,
} from './customer-identity.js';

describe('customer phone identity normalization', () => {
  it.each([
    '01712345678',
    '01712-345678',
    '01712 345678',
    '+8801712345678',
    '8801712345678',
    '+880 1712 345678',
    '+880 (1712) 345678',
  ])('normalizes %s identically', (phone) =>
    expect(normalizeCustomerPhone(phone)).toBe('8801712345678'),
  );
  it.each([
    'abc01712345678',
    '0171234567',
    '017123456789',
    '01012345678',
    '01112345678',
    '01212345678',
    '02012345678',
    '+01712345678',
    '++8801712345678',
    '01712--345678',
    '01712/345678',
    '(01712345678',
    '01712345678)',
    '01712.345678',
    'v01712345678',
    '01712\n345678',
    '01712345678ext2',
  ])('rejects malformed input %s without fabricating an identity', (phone) => {
    expect(() => normalizeCustomerPhone(phone)).toThrow(
      'valid Bangladesh mobile',
    );
    expect(() => customerIdentityInput({ name: 'Customer', phone })).toThrow(
      'valid Bangladesh mobile',
    );
    expect(customerPhoneError(phone)).toBeTruthy();
  });
  it.each([null, undefined, '', '  ', '\t\n\r\f\v'])(
    'permits omitted/blank phone %j',
    (phone) => expect(normalizeCustomerPhone(phone)).toBeNull(),
  );
  it('preserves display formatting separately and rejects non-string input', () => {
    expect(
      customerIdentityInput({ name: 'Rahim', phone: '+880 1712 345678' }),
    ).toMatchObject({
      phone: '+880 1712 345678',
      normalizedPhone: '8801712345678',
    });
    expect(() => normalizeCustomerPhone(123 as never)).toThrow();
  });
  it('audits all categories and reports duplicate owners without merging records', () => {
    const make = (id: string, phone: string | null) => ({
      id,
      phone,
      name: id,
      salesCount: 2,
      paymentCount: 1,
      outstanding: '20.00',
      archivedAt: null,
    });
    const records = [
      make('a', '01712-345678'),
      make('b', '+8801712345678'),
      make('c', null),
      make('d', '123'),
      make('e', '01822222222'),
    ];
    const before = JSON.stringify(records);
    const audit = auditCustomerPhones(records);
    expect(audit.duplicates[0].customers.map((c) => c.id)).toEqual(['a', 'b']);
    expect(audit.validUnique.map((c) => c.id)).toEqual(['e']);
    expect(audit.blank.map((c) => c.id)).toEqual(['c']);
    expect(audit.invalid.map((c) => c.id)).toEqual(['d']);
    expect(JSON.stringify(records)).toBe(before);
  });
  it.each([
    [{ code: 'P2002', meta: { target: ['normalizedPhone'] } }, true],
    [
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: 'Customer_normalizedPhone_key' } },
          },
        },
      },
      true,
    ],
    [
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: 'Sale_invoiceNumber_key' } },
          },
        },
      },
      false,
    ],
    [{ code: 'P2034' }, false],
  ])(
    'recognizes phone-specific uniqueness without intercepting invoice conflicts',
    (error, result) => expect(isCustomerPhoneUniqueError(error)).toBe(result),
  );
});
