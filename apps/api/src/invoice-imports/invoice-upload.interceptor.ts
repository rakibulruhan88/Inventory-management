import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import multer from 'invoice-multipart';
import type { Request, Response } from 'express';
import { importConfig, SUPPORTED_MIME_TYPES } from './import-config.js';

@Injectable()
export class InvoiceUploadInterceptor implements NestInterceptor {
  private active = 0;
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    if (this.active >= 2)
      throw new ServiceUnavailableException(
        'Uploads are busy. Please retry shortly.',
      );
    this.active++;
    let released = false;
    const release = () => {
      if (!released) {
        this.active--;
        released = true;
      }
    };
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.once('finish', release);
    response.once('close', release);
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: importConfig(this.config).maxFileBytes,
        files: 1,
        fields: 0,
        parts: 2,
        fieldNameSize: 100,
        fieldSize: 0,
        headerPairs: 30,
      },
      fileFilter: (_request, file, done) => {
        if (!SUPPORTED_MIME_TYPES.includes(file.mimetype))
          done(new BadRequestException('Choose a PDF, JPG, or PNG file.'));
        else done(null, true);
      },
    }).single('file');
    try {
      await new Promise<void>((resolve, reject) =>
        upload(request, response, (error) => {
          if (!error) resolve();
          else if (error instanceof multer.MulterError)
            reject(
              error.code === 'LIMIT_FILE_SIZE'
                ? new PayloadTooLargeException(
                    'The file exceeds the invoice upload size limit.',
                  )
                : new BadRequestException(
                    'Upload exactly one file named file, with no additional fields.',
                  ),
            );
          else
            reject(
              error instanceof BadRequestException
                ? error
                : new BadRequestException(
                    'Could not upload the document. Please retry.',
                  ),
            );
        }),
      );
      return next.handle();
    } catch (error) {
      release();
      throw error;
    }
  }
}
