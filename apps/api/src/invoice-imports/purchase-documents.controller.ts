import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ImportAccessGuard } from './import-access.guard.js';
import { PurchaseDocumentsService } from './purchase-documents.service.js';
import { disposition } from './purchase-documents.js';

// Documents follow the existing shared business-record access: all active staff/owners.
// Private unconfirmed drafts remain owner-only, and no storage keys enter responses.
@Controller('documents')
@UseGuards(ImportAccessGuard)
export class PurchaseDocumentsController {
  constructor(
    @Inject(PurchaseDocumentsService)
    private readonly documents: PurchaseDocumentsService,
  ) {}
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(id);
  }
  @Get(':id/content') async content(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Res() response: Response,
  ) {
    if (download !== undefined && !['true', 'false'].includes(download))
      throw new BadRequestException('Invalid download option.');
    const source = await this.documents.content(id);
    response.set({
      'Content-Type': source.mimeType,
      'Content-Length': String(source.bytes.length),
      'Content-Disposition': disposition(
        source.originalFileName,
        download === 'true',
      ),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    response.send(source.bytes);
  }
}
