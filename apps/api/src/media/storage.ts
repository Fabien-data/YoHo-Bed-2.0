import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Where photo bytes live (Compartment H). The interface is the seam — swap LocalDiskStorage
 * for an S3-compatible adapter at deploy time without touching the media feature.
 */
export interface StorageAdapter {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalDiskStorage implements StorageAdapter {
  private readonly base: string;
  constructor(baseDir: string) {
    this.base = resolve(baseDir);
  }
  /** Keys are server-generated hex + extension — never user input — so no traversal surface. */
  private path(key: string): string {
    if (!/^[a-z0-9]+\.[a-z0-9]+$/i.test(key)) throw new Error(`invalid storage key: ${key}`);
    return join(this.base, key);
  }
  async save(key: string, data: Buffer): Promise<void> {
    await mkdir(this.base, { recursive: true });
    await writeFile(this.path(key), data);
  }
  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => undefined); // already gone = fine
  }
}
