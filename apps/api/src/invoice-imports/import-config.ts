import { ConfigService } from '@nestjs/config';

const integerSetting = (
  config: ConfigService,
  name: string,
  fallback: number,
  max: number,
) => {
  const value = Number(config.get(name, fallback));
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer between 1 and ${max}.`);
  return value;
};
export function importConfig(config: ConfigService) {
  return {
    storageRoot: config.get<string>(
      'INVOICE_IMPORT_STORAGE_ROOT',
      '.invoice-import-storage',
    ),
    maxFileBytes:
      integerSetting(config, 'INVOICE_IMPORT_MAX_FILE_MB', 15, 50) *
      1024 *
      1024,
    maxPages: integerSetting(config, 'INVOICE_IMPORT_MAX_PDF_PAGES', 20, 50),
    timeoutMs: integerSetting(
      config,
      'INVOICE_IMPORT_TIMEOUT_MS',
      120_000,
      300_000,
    ),
    ttlMs:
      integerSetting(config, 'INVOICE_IMPORT_TTL_HOURS', 24, 168) * 3_600_000,
    maxPixels: 16_000_000,
    maxTextLength: 2_000_000,
  };
}
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];
