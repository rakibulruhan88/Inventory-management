import { readDocument } from './document-reader.js';
import { DocumentReadError, type ReaderOptions } from './document-types.js';
// Private IPC only. Uploaded documents are never sent to a remote service.
process.once(
  'message',
  async (job: { bytes: Buffer; mime: string; options: ReaderOptions }) => {
    try {
      const document = await readDocument(job.bytes, job.mime, job.options);
      process.send?.({ ok: true, document }, () => process.exit(0));
    } catch (error) {
      const known = error instanceof DocumentReadError;
      process.send?.(
        {
          ok: false,
          code: known ? error.code : 'DOCUMENT_READ_FAILED',
          message: known
            ? error.message
            : 'Could not read this document. It may be damaged, password-protected, or unreadable. Try a clearer PDF, JPG, or PNG.',
        },
        () => process.exit(0),
      );
    }
  },
);
