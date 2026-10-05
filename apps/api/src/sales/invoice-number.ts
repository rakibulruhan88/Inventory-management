type InvoiceNumberTransaction = {
  storeSettings: {
    update(args: {
      where: { id: string };
      data: { invoiceSequence: { increment: number } };
      select: { invoicePrefix: true; invoiceSequence: true };
    }): Promise<{ invoicePrefix: string; invoiceSequence: number }>;
  };
  sale: {
    findUnique(args: {
      where: { invoiceNumber: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * Allocates a visible invoice number using a database atomic increment. The
 * settings row is locked by PostgreSQL for the update, so concurrent callers
 * cannot observe or receive the same sequence value.
 */
export async function allocateInvoiceNumber(tx: InvoiceNumberTransaction) {
  for (;;) {
    const settings = await tx.storeSettings.update({
      where: { id: 'default' },
      data: { invoiceSequence: { increment: 1 } },
      select: { invoicePrefix: true, invoiceSequence: true },
    });
    const invoiceNumber = `${settings.invoicePrefix}${String(settings.invoiceSequence).padStart(6, '0')}`;
    const collision = await tx.sale.findUnique({
      where: { invoiceNumber },
      select: { id: true },
    });
    if (!collision) return invoiceNumber;
  }
}
