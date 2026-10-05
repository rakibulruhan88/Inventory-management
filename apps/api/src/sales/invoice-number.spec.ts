import { allocateInvoiceNumber } from './invoice-number.js';

class ConcurrentSettingsStore {
  invoicePrefix = 'AF-';
  invoiceSequence = 0;
  private queue = Promise.resolve();

  update() {
    const result = this.queue.then(() => ({
      invoicePrefix: this.invoicePrefix,
      invoiceSequence: ++this.invoiceSequence,
    }));
    this.queue = result.then(() => undefined);
    return result;
  }
}

function transaction(
  settings: ConcurrentSettingsStore,
  historical = new Set<string>(),
) {
  return {
    storeSettings: settings,
    sale: {
      findUnique: ({ where }: { where: { invoiceNumber: string } }) =>
        Promise.resolve(
          historical.has(where.invoiceNumber) ? { id: 'historical' } : null,
        ),
    },
  };
}

describe('professional invoice number allocation', () => {
  it('generates sequential, zero-padded invoice numbers', async () => {
    const settings = new ConcurrentSettingsStore();
    await expect(allocateInvoiceNumber(transaction(settings))).resolves.toBe(
      'AF-000001',
    );
    await expect(allocateInvoiceNumber(transaction(settings))).resolves.toBe(
      'AF-000002',
    );
  });

  it('uses the current prefix from Store Settings', async () => {
    const settings = new ConcurrentSettingsStore();
    settings.invoicePrefix = 'SHOP-';
    await expect(allocateInvoiceNumber(transaction(settings))).resolves.toBe(
      'SHOP-000001',
    );
  });

  it('allocates unique numbers to concurrent callers', async () => {
    const settings = new ConcurrentSettingsStore();
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () =>
        allocateInvoiceNumber(transaction(settings)),
      ),
    );
    expect(new Set(numbers).size).toBe(25);
    expect(numbers.sort()).toEqual(
      Array.from(
        { length: 25 },
        (_, index) => `AF-${String(index + 1).padStart(6, '0')}`,
      ),
    );
  });

  it('skips a historical collision without changing the historical number', async () => {
    const settings = new ConcurrentSettingsStore();
    const historicalInvoice = { invoiceNumber: 'AF-000001' };
    const next = await allocateInvoiceNumber(
      transaction(settings, new Set([historicalInvoice.invoiceNumber])),
    );
    expect(next).toBe('AF-000002');
    expect(historicalInvoice.invoiceNumber).toBe('AF-000001');
  });
});
