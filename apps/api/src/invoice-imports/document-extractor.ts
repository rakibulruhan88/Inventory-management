import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importConfig } from './import-config.js';
import { DocumentReadError, type ExtractedDocument } from './document-types.js';

@Injectable()
export class DocumentExtractor {
  private busy = false;
  private child?: ChildProcess;
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  async extract(bytes: Buffer, mime: string): Promise<ExtractedDocument> {
    if (this.busy)
      throw new ServiceUnavailableException(
        'Another document is being read. Please retry shortly.',
      );
    this.busy = true;
    try {
      const options = importConfig(this.config);
      const compiled = fileURLToPath(
        new URL('./document-worker.js', import.meta.url),
      );
      const entry = existsSync(compiled)
        ? compiled
        : fileURLToPath(new URL('./document-worker.ts', import.meta.url));
      return await new Promise<ExtractedDocument>((resolve, reject) => {
        const child = fork(entry, [], {
          serialization: 'advanced',
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          execArgv: [
            '--max-old-space-size=384',
            ...(entry.endsWith('.ts') ? ['--import', 'tsx'] : []),
          ],
        });
        this.child = child;
        let settled = false;
        const finish = (error?: Error, document?: ExtractedDocument) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill('SIGKILL');
          if (error) reject(error);
          else resolve(document!);
        };
        const timer = setTimeout(
          () =>
            finish(
              new DocumentReadError(
                'DOCUMENT_TIMEOUT',
                'Reading this document timed out. Try a smaller or clearer document.',
              ),
            ),
          options.timeoutMs,
        );
        child.once('error', () =>
          finish(
            new DocumentReadError(
              'DOCUMENT_READ_FAILED',
              'The document reader could not start. Please retry.',
            ),
          ),
        );
        child.once('exit', () =>
          finish(
            new DocumentReadError(
              'DOCUMENT_READ_FAILED',
              'The document reader stopped unexpectedly. Try a smaller document.',
            ),
          ),
        );
        child.once(
          'message',
          (message: {
            ok: boolean;
            document?: ExtractedDocument;
            code?: string;
            message?: string;
          }) => {
            if (message.ok && message.document)
              finish(undefined, message.document);
            else
              finish(
                new DocumentReadError(
                  message.code ?? 'DOCUMENT_READ_FAILED',
                  message.message ?? 'Could not read the document.',
                ),
              );
          },
        );
        child.send({ bytes, mime, options });
      });
    } finally {
      this.busy = false;
      this.child = undefined;
    }
  }
  onModuleDestroy() {
    this.child?.kill('SIGKILL');
  }
}
