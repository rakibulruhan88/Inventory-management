import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { importConfig } from './import-config.js';

export const INVOICE_STORAGE = Symbol('INVOICE_STORAGE');
export interface InvoiceStorage {
  createKey(draftId: string, extension: string): string;
  createPermanentKey(
    year: number,
    containerNumber: string,
    extension: string,
  ): string;
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const temporaryKey = new RegExp(
  `^tmp/invoice-imports/${uuid}/${uuid}\\.(pdf|jpg|png)$`,
);

const permanentKey = new RegExp(
  `^invoices/[0-9]{4}/[A-Z0-9_-]{1,100}/${uuid}\\.(pdf|jpg|png)$`,
);
export const isTemporaryInvoiceKey = (key: string) => temporaryKey.test(key);
export const isPermanentInvoiceKey = (key: string) => permanentKey.test(key);

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
  createPermanentKey(year: number, containerNumber: string, extension: string) {
    const slug = containerNumber
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .slice(0, 100);
    const key = `invoices/${year}/${slug}/${randomUUID()}.${extension}`;
    if (!isPermanentInvoiceKey(key))
      throw new Error('Invalid permanent invoice key.');
    return key;
  }
  private path(key: string) {
    if (!temporaryKey.test(key) && !permanentKey.test(key))
      throw new Error('Invalid invoice storage key.');
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
    if (
      !parent.startsWith(root + sep) ||
      parent !== resolve(root, dirname(key))
    )
      throw new Error('Invalid invoice storage directory.');
    return path;
  }
  async put(key: string, bytes: Buffer) {
    const path = await this.checkedPath(key, true);
    try {
      if (permanentKey.test(key)) {
        const handle = await open(
          path,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        // Flush the file entry and all newly created archive directory entries
        // before the database may commit a reference to this source.
        const realRoot = await realpath(this.root);
        let directory = await realpath(dirname(path));
        while (directory === realRoot || directory.startsWith(realRoot + sep)) {
          const folder = await open(directory, constants.O_RDONLY);
          try {
            await folder.sync();
          } finally {
            await folder.close();
          }
          if (directory === realRoot) break;
          directory = dirname(directory);
        }
      } else await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
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
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024)
        throw new Error('Invalid invoice storage file.');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
  async remove(key: string) {
    try {
      const path = await this.checkedPath(key);
      await rm(path, { force: true });
      // Each random draft directory contains exactly one generated upload.
      if (temporaryKey.test(key))
        await rm(dirname(path), { recursive: true, force: true });
      else {
        try {
          await rmdir(dirname(path));
        } catch (error) {
          if (
            !['ENOTEMPTY', 'ENOENT'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            )
          )
            throw error;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
