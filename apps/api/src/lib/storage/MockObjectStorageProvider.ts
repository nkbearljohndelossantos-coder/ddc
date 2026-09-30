import crypto from 'crypto';
import { Readable } from 'stream';
import { IObjectStorageProvider, StorageObjectMetadata } from './IObjectStorageProvider.js';

export class MockObjectStorageProvider implements IObjectStorageProvider {
  public storage = new Map<string, { buffer: Buffer; contentType: string; lastModified: Date }>();
  public multipartSessions = new Map<string, { key: string; contentType: string; parts: Map<number, Buffer> }>();

  async putObject(key: string, data: Buffer | Uint8Array, contentType = 'application/octet-stream'): Promise<StorageObjectMetadata> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const now = new Date();

    this.storage.set(key, { buffer, contentType, lastModified: now });

    return {
      key,
      sizeBytes: buffer.length,
      sha256Hash: hash,
      contentType,
      lastModified: now,
    };
  }

  async getObject(key: string): Promise<Buffer> {
    const entry = this.storage.get(key);
    if (!entry) throw new Error(`Object '${key}' not found`);
    return entry.buffer;
  }

  async getObjectStream(key: string): Promise<Readable> {
    const buffer = await this.getObject(key);
    return Readable.from(buffer);
  }

  async objectExists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  async deleteObject(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<StorageObjectMetadata> {
    const source = this.storage.get(sourceKey);
    if (!source) throw new Error(`Source object '${sourceKey}' not found`);
    return this.putObject(destinationKey, source.buffer, source.contentType);
  }

  async createMultipartUpload(key: string, contentType = 'application/octet-stream'): Promise<string> {
    const uploadId = `mp_${crypto.randomUUID()}`;
    this.multipartSessions.set(uploadId, { key, contentType, parts: new Map() });
    return uploadId;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ): Promise<{ partNumber: number; etag: string; sizeBytes: number }> {
    const session = this.multipartSessions.get(uploadId);
    if (!session || session.key !== key) throw new Error(`Invalid multipart upload session '${uploadId}'`);

    session.parts.set(partNumber, data);
    const etag = crypto.createHash('md5').update(data).digest('hex');

    return { partNumber, etag, sizeBytes: data.length };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[]
  ): Promise<StorageObjectMetadata> {
    const session = this.multipartSessions.get(uploadId);
    if (!session || session.key !== key) throw new Error(`Invalid multipart upload session '${uploadId}'`);

    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const buffers = sortedParts.map((p) => {
      const partBuffer = session.parts.get(p.partNumber);
      if (!partBuffer) throw new Error(`Missing part ${p.partNumber} for session '${uploadId}'`);
      return partBuffer;
    });

    const combined = Buffer.concat(buffers);
    const meta = await this.putObject(key, combined, session.contentType);
    this.multipartSessions.delete(uploadId);

    return meta;
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<boolean> {
    return this.multipartSessions.delete(uploadId);
  }
}
