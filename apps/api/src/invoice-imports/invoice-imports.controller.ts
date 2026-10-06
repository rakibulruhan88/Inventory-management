import {
  Body,
  Put,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthUser } from '@afia/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { InvoiceConfirmationService } from './invoice-confirmation.service.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import { ImportAccessGuard } from './import-access.guard.js';
import { InvoiceUploadInterceptor } from './invoice-upload.interceptor.js';

@Controller('invoice-imports')
@UseGuards(ImportAccessGuard)
export class InvoiceImportsController {
  constructor(
    @Inject(InvoiceImportsService)
    private readonly imports: InvoiceImportsService,
    @Inject(InvoiceConfirmationService)
    private readonly confirmation: InvoiceConfirmationService,
  ) {}
  @Get('limits') limits() {
    return this.imports.limits();
  }
  @Post()
  @UseInterceptors(InvoiceUploadInterceptor)
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.upload(file, user.id);
  }
  @Post(':id/parse') parse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.parse(id, user.id);
  }
  @Put(':id/review') updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.imports.updateReview(id, user.id, body);
  }
  @Post(':id/review/reset') resetReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.imports.updateReview(id, user.id, body, true);
  }
  @Post(':id/confirm') confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.confirmation.confirm(id, user.id, body);
  }
  @Get(':id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.get(id, user.id);
  }
}
