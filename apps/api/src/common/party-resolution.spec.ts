import { ConflictException } from '@nestjs/common';
import {
  missingPartyDetails,
  normalizePartyInput,
  normalizePhone,
  resolvePartyMatch,
  type PartyRecord,
} from './party-resolution.js';

const rahim: PartyRecord = {
  id: 'rahim',
  name: 'Rahim Traders',
  phone: '01712345678',
  email: 'accounts@rahim.com',
  address: 'Dhaka',
};
const karim: PartyRecord = {
  id: 'karim',
  name: 'Karim Leather',
  phone: '01812345678',
  email: 'office@karim.com',
  address: 'Chattogram',
};

describe('inline supplier resolution', () => {
  it('normalizes names, email and phone', () => {
    expect(
      normalizePartyInput({
        name: '  Rahim   Traders ',
        email: ' ACCOUNTS@RAHIM.COM ',
        phone: '017-123 45678',
      }),
    ).toMatchObject({
      name: 'Rahim Traders',
      email: 'accounts@rahim.com',
      phone: '01712345678',
    });
    expect(normalizePhone('+880 (171) 234-5678')).toBe('+8801712345678');
  });

  it.each([
    { name: 'rahim traders' },
    { name: 'Different', email: ' ACCOUNTS@RAHIM.COM ' },
    { name: 'Different', phone: '017-123 45678' },
  ])('reuses a supplier contact by an exact normalized identifier', (party) => {
    const input = normalizePartyInput(party);
    expect(resolvePartyMatch(input, [rahim], 'supplier')?.id).toBe('rahim');
  });

  it.each([
    { name: 'RAHIM TRADERS' },
    { name: 'Different', email: 'accounts@rahim.com' },
    { name: 'Different', phone: '01712 345678' },
  ])('reuses a supplier by an exact normalized identifier', (party) => {
    const input = normalizePartyInput(party);
    expect(resolvePartyMatch(input, [rahim], 'supplier')?.id).toBe('rahim');
  });

  it('returns no match for a genuinely new party', () => {
    const input = normalizePartyInput({ name: 'New Business' });
    expect(resolvePartyMatch(input, [rahim], 'supplier')).toBeUndefined();
  });

  it('uses an explicitly selected existing party', () => {
    const input = normalizePartyInput({ id: 'karim', name: 'Karim Leather' });
    expect(resolvePartyMatch(input, [rahim, karim], 'supplier')?.id).toBe(
      'karim',
    );
  });

  it('rejects conflicting email and phone matches', () => {
    const input = normalizePartyInput({
      name: 'Someone',
      email: rahim.email ?? undefined,
      phone: karim.phone ?? undefined,
    });
    expect(() => resolvePartyMatch(input, [rahim, karim], 'supplier')).toThrow(
      ConflictException,
    );
  });

  it('rejects ambiguous duplicate exact names', () => {
    const duplicate = { ...karim, name: rahim.name };
    const input = normalizePartyInput({ name: rahim.name });
    expect(() =>
      resolvePartyMatch(input, [rahim, duplicate], 'supplier'),
    ).toThrow(ConflictException);
  });

  it('only fills missing details on an existing party', () => {
    const existing = { ...rahim, email: null };
    const input = normalizePartyInput({
      name: rahim.name,
      phone: '01999999999',
      email: 'new@example.com',
      address: 'Sylhet',
    });
    expect(missingPartyDetails(existing, input)).toEqual({
      email: 'new@example.com',
    });
  });
});
