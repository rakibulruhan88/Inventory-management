import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { importConfig } from './import-config.js';

export const INVOICE_STORAGE = Symbol('INVOICE_STORAGE');
export interface InvoiceStorage {
  createKey(draftId: string, extension: string): string;
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const safeKey = new RegExp(
  `^tmp/invoice-imports/${uuid}/${uuid}\\.(pdf|jpg|png)$`,
);

@Injectable()
export class LocalInvoiceStorage implements InvoiceStorage {
  private readonly root: string;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.root = resolve(importConfig(config).storageRoot);
  }
  createKey(draftId: string, extension: string) {
    const key = `tmp/invoice-imports/${draftId}/${randomUUID()}.${extension}`;
    this.path(key);
    return key;
  }
  private path(key: string) {
    if (!safeKey.test(key)) throw new Error('Invalid invoice storage key.');
    return resolve(this.root, key);
  }
  private async checkedPath(key: string, create = false) {
    const path = this.path(key);
    if (create) {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    }
    const [root, parent] = await Promise.all([
      realpath(this.root),
      realpath(dirname(path)),
    ]);
    if (!parent.startsWith(root + sep))
      throw new Error('Invalid invoice storage directory.');
    return path;
  }
  async put(key: string, bytes: Buffer) {
    const path = await this.checkedPath(key, true);
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      // A failed write can leave a partial file. Never remove a pre-existing key.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        await rm(path, { force: true });
      throw error;
    }
  }
  async read(key: string) {
    const path = await this.checkedPath(key);
    // Reject a symlink file even if its parent is safe.
    const actual = await realpath(path);
    if (actual !== path && actual !== resolve(await realpath(this.root), key))
      throw new Error('Invalid invoice storage file.');
    return readFile(path);
  }
  async remove(key: string) {
    try {
      const path = await this.checkedPath(key);
      await rm(path, { force: true });
      // Each random draft directory contains exactly one generated upload.
      await rm(dirname(path), { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
