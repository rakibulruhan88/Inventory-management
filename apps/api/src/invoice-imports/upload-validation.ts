import type {} from 'multer';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';

export type InvoiceUpload = Pick<
  Express.Multer.File,
  'buffer' | 'originalname' | 'mimetype' | 'size'
>;
export function validateUpload(
  file: InvoiceUpload | undefined,
  maxBytes: number,
) {
  if (!file?.buffer?.length)
    throw new BadRequestException('Choose a PDF, JPG, or PNG file.');
  if (file.buffer.length > maxBytes)
    throw new PayloadTooLargeException(
      'The file exceeds the invoice upload size limit.',
    );
  const bytes = file.buffer;
  const extension = extname(file.originalname).toLowerCase();
  const pdf =
    bytes.subarray(0, 5).toString() === '%PDF-' &&
    /%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'));
  const png =
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString() === 'IHDR';
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const type = file.mimetype;
  if (!(
    (type === 'application/pdf' && extension === '.pdf' && pdf) ||
    (type === 'image/png' && extension === '.png' && png) ||
    (type === 'image/jpeg' && ['.jpg', '.jpeg'].includes(extension) && jpg)
  ))
    throw new BadRequestException(
      'Unsupported or damaged file. Choose a valid PDF, JPG, or PNG.',
    );
  return {
    extension:
      type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg',
    sha256Hash: createHash('sha256').update(bytes).digest('hex'),
    // Filename is display-only. It never participates in a storage path.
    originalFileName:
      file.originalname
        .split(/[\\/]/)
        .pop()!
        .replace(/[\x00-\x1f\x7f]/g, '')
        .slice(0, 200) || 'invoice',
  };
}
