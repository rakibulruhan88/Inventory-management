import { normalizeCustomerPhone } from '@afia/contracts';
export type CustomerPhoneAuditRecord = {
  id: string;
  name: string;
  phone: string | null;
  salesCount: number;
  paymentCount: number;
  outstanding: string;
  archivedAt: Date | null;
};
export function auditCustomerPhones(records: CustomerPhoneAuditRecord[]) {
  const rows = records.map((row) => {
    try {
      const normalizedPhone = normalizeCustomerPhone(row.phone);
      return {
        ...row,
        normalizedPhone,
        category: normalizedPhone ? 'valid' : 'blank',
      };
    } catch {
      return { ...row, normalizedPhone: null, category: 'invalid' };
    }
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows)
    if (row.normalizedPhone) {
      const group = groups.get(row.normalizedPhone) ?? [];
      group.push(row);
      groups.set(row.normalizedPhone, group);
    }
  const duplicates = [...groups]
    .filter(([, group]) => group.length > 1)
    .map(([normalizedPhone, customers]) => ({ normalizedPhone, customers }));
  for (const group of duplicates)
    for (const row of group.customers) row.category = 'duplicate';
  return {
    total: rows.length,
    validUnique: rows.filter((r) => r.category === 'valid'),
    blank: rows.filter((r) => r.category === 'blank'),
    invalid: rows.filter((r) => r.category === 'invalid'),
    duplicates,
  };
}
