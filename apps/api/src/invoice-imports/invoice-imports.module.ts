import { PurchasesModule } from '../purchases/purchases.module.js';
import { InvoiceConfirmationService } from './invoice-confirmation.service.js';
import { PurchaseDocumentsController } from './purchase-documents.controller.js';
import { PurchaseDocumentsService } from './purchase-documents.service.js';
import { Module } from '@nestjs/common';
import { InvoiceImportsController } from './invoice-imports.controller.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import { DocumentExtractor } from './document-extractor.js';
import { INVOICE_STORAGE, LocalInvoiceStorage } from './invoice-storage.js';
import { ImportAccessGuard } from './import-access.guard.js';
import { InvoiceUploadInterceptor } from './invoice-upload.interceptor.js';

@Module({
  imports: [PurchasesModule],
  controllers: [InvoiceImportsController, PurchaseDocumentsController],
  providers: [
    InvoiceImportsService,
    InvoiceConfirmationService,
    PurchaseDocumentsService,
    DocumentExtractor,
    ImportAccessGuard,
    InvoiceUploadInterceptor,
    { provide: INVOICE_STORAGE, useClass: LocalInvoiceStorage },
  ],
  exports: [InvoiceImportsService],
})
export class InvoiceImportsModule {}
