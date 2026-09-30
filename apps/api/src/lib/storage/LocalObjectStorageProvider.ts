import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { IObjectStorageProvider, StorageObjectMetadata } from './IObjectStorageProvider.js';

export class LocalObjectStorageProvider implements IObjectStorageProvider {
  private baseDir: string;

  constructor(baseDir = './storage') {
    this.baseDir = path.resolve(baseDir);
  }

  private resolveSafePath(key: string): string {
    // Prevent path traversal attacks
    if (key.includes('..') || path.isAbsolute(key)) {
      throw new Error(`Path traversal violation: key '${key}' escapes storage root`);
    }
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error(`Path traversal violation: key '${key}' escapes storage root`);
    }
    return resolved;
  }

  async putObject(key: string, data: Buffer | Uint8Array, contentType = 'application/octet-stream'): Promise<StorageObjectMetadata> {
    const filePath = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.writeFile(filePath, buffer);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const stats = await fs.stat(filePath);

    return {
      key,
      sizeBytes: stats.size,
      sha256Hash: hash,
      contentType,
      lastModified: stats.mtime,
    };
  }

  async getObject(key: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(key);
    return fs.readFile(filePath);
  }

  async getObjectStream(key: string): Promise<Readable> {
    const filePath = this.resolveSafePath(key);
    return createReadStream(filePath);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(key);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<StorageObjectMetadata> {
    const data = await this.getObject(sourceKey);
    return this.putObject(destinationKey, data);
  }

  async createMultipartUpload(key: string): Promise<string> {
    return `local_mp_${crypto.randomUUID()}`;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ): Promise<{ partNumber: number; etag: string; sizeBytes: number }> {
    const partKey = `.tmp_mp_${uploadId}_part_${partNumber}`;
    await this.putObject(partKey, data);
    const etag = crypto.createHash('md5').update(data).digest('hex');
    return { partNumber, etag, sizeBytes: data.length };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[]
  ): Promise<StorageObjectMetadata> {
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const partBuffers: Buffer[] = [];

    for (const part of sortedParts) {
      const partKey = `.tmp_mp_${uploadId}_part_${part.partNumber}`;
      const buf = await this.getObject(partKey);
      partBuffers.push(buf);
      await this.deleteObject(partKey);
    }

    const combined = Buffer.concat(partBuffers);
    return this.putObject(key, combined);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<boolean> {
    return true;
  }
}
