import { Module } from '@nestjs/common';
import { InvoiceImportsController } from './invoice-imports.controller.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import { DocumentExtractor } from './document-extractor.js';
import { INVOICE_STORAGE, LocalInvoiceStorage } from './invoice-storage.js';
import { ImportAccessGuard } from './import-access.guard.js';
import { InvoiceUploadInterceptor } from './invoice-upload.interceptor.js';

@Module({
  controllers: [InvoiceImportsController],
  providers: [
    InvoiceImportsService,
    DocumentExtractor,
    ImportAccessGuard,
    InvoiceUploadInterceptor,
    { provide: INVOICE_STORAGE, useClass: LocalInvoiceStorage },
  ],
  exports: [InvoiceImportsService],
})
export class InvoiceImportsModule {}
