import type { PurchaseDocumentSummary } from '@afia/contracts';
import type { PurchaseDocument } from '../generated/prisma/client.js';

export function documentSummary(
  document: PurchaseDocument,
  containerId: string,
): PurchaseDocumentSummary {
  return {
    id: document.id,
    purchaseId: document.purchaseId,
    containerId,
    documentType: document.documentType,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    sha256Hash: document.sha256Hash,
    createdAt: document.createdAt.toISOString(),
  };
}
export function disposition(fileName: string, download: boolean) {
  const name =
    Buffer.from(fileName, 'utf8')
      .toString('utf8')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .split(/[\\/]/)
      .pop()
      ?.slice(0, 200) || 'invoice';
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
