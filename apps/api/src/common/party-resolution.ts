import { ConflictException } from '@nestjs/common';
import { normalizeText } from './normalize.js';

export type PartyInput = {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
};

export type PartyRecord = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export function normalizePartyInput(input: PartyInput) {
  return {
    id: input.id,
    name: normalizeText(input.name),
    phone: normalizePhone(input.phone) || null,
    email: normalizeText(input.email).toLowerCase() || null,
    address: normalizeText(input.address) || null,
  };
}

export function normalizePhone(value?: string | null) {
  const clean = normalizeText(value ?? '');
  if (!clean) return '';
  const digits = clean.replace(/\D/g, '');
  return clean.startsWith('+') ? `+${digits}` : digits;
}

export function resolvePartyMatch(
  input: ReturnType<typeof normalizePartyInput>,
  records: PartyRecord[],
  label: 'customer' | 'supplier',
) {
  if (input.id) {
    const selected = records.find((record) => record.id === input.id);
    if (!selected)
      throw new ConflictException(
        `The selected ${label} is no longer available.`,
      );
    return selected;
  }

  const nameMatches = records.filter(
    (record) =>
      normalizeText(record.name).toLowerCase() === input.name.toLowerCase(),
  );
  const emailMatches = input.email
    ? records.filter(
        (record) =>
          normalizeText(record.email ?? '').toLowerCase() === input.email,
      )
    : [];
  const phoneMatches = input.phone
    ? records.filter((record) => normalizePhone(record.phone) === input.phone)
    : [];
  const matches = new Map(
    [...nameMatches, ...emailMatches, ...phoneMatches].map((record) => [
      record.id,
      record,
    ]),
  );
  if (matches.size > 1) {
    throw new ConflictException(
      `These details match more than one ${label}. Please choose the correct existing ${label} from the suggestions.`,
    );
  }
  return matches.values().next().value as PartyRecord | undefined;
}

export function missingPartyDetails(
  existing: PartyRecord,
  input: ReturnType<typeof normalizePartyInput>,
) {
  return {
    ...(!existing.phone && input.phone ? { phone: input.phone } : {}),
    ...(!existing.email && input.email ? { email: input.email } : {}),
    ...(!existing.address && input.address ? { address: input.address } : {}),
  };
}
