import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface StorageObjectInfo {
  bucket: string;
  key: string;
  sizeBytes: number;
  sha256Hash: string;
  lastModified: Date;
}

/**
 * Enterprise Object Storage Adapter (MinIO / S3 compatible).
 * Uses isolated logical namespaces: quarantine/ and final/.
 */
export class ObjectStorageClient {
  private baseStorageDir: string;
  private bucket: string;

  constructor(baseStorageDir: string = './.server_object_storage', bucket: string = 'nkb-documents') {
    this.baseStorageDir = baseStorageDir;
    this.bucket = bucket;

    if (!fs.existsSync(this.baseStorageDir)) {
      fs.mkdirSync(this.baseStorageDir, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    const safeKey = key.replace(/^\/+/, '');
    const fullPath = path.join(this.baseStorageDir, this.bucket, safeKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return fullPath;
  }

  /**
   * Appends or writes a chunk into quarantine storage.
   */
  async writeQuarantineChunk(
    quarantineKey: string,
    chunkNumber: number,
    chunkBuffer: Buffer
  ): Promise<void> {
    const chunkKey = `${quarantineKey}.chunk_${chunkNumber}`;
    const filePath = this.resolvePath(chunkKey);
    fs.writeFileSync(filePath, chunkBuffer);
  }

  /**
   * Assembles all chunks in deterministic order into the complete quarantine object.
   */
  async assembleQuarantineObject(
    quarantineKey: string,
    totalChunks: number
  ): Promise<StorageObjectInfo> {
    const finalQuarantinePath = this.resolvePath(quarantineKey);
    const writeStream = fs.createWriteStream(finalQuarantinePath);
    const hashStream = crypto.createHash('sha256');

    let totalBytes = 0;

    for (let i = 1; i <= totalChunks; i++) {
      const chunkKey = `${quarantineKey}.chunk_${i}`;
      const chunkPath = this.resolvePath(chunkKey);

      if (!fs.existsSync(chunkPath)) {
        writeStream.destroy();
        throw new Error(`Missing chunk ${i} of ${totalChunks} during assembly of ${quarantineKey}`);
      }

      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
      hashStream.update(chunkData);
      totalBytes += chunkData.length;

      // Clean up chunk file
      fs.unlinkSync(chunkPath);
    }

    await new Promise((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.on('error', reject);
    });

    const sha256Hash = hashStream.digest('hex');

    return {
      bucket: this.bucket,
      key: quarantineKey,
      sizeBytes: totalBytes,
      sha256Hash,
      lastModified: new Date(),
    };
  }

  /**
   * Verifies SHA-256 integrity of an assembled quarantine object.
   */
  async verifyObjectIntegrity(key: string, expectedSha256: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const data = fs.readFileSync(filePath);
    const actualHash = crypto.createHash('sha256').update(data).digest('hex');
    return actualHash.toLowerCase() === expectedSha256.toLowerCase();
  }

  /**
   * Moves object from quarantine to final storage.
   */
  async moveToFinalStorage(quarantineKey: string, finalKey: string): Promise<boolean> {
    const srcPath = this.resolvePath(quarantineKey);
    const destPath = this.resolvePath(finalKey);

    if (!fs.existsSync(srcPath)) {
      logger.error(`[Storage] Quarantine object not found at ${srcPath}`);
      return false;
    }

    // Atomic copy / move
    fs.copyFileSync(srcPath, destPath);

    if (fs.existsSync(destPath)) {
      fs.unlinkSync(srcPath); // Clean up quarantine copy
      logger.info(`[Storage] Object moved successfully: ${quarantineKey} -> ${finalKey}`);
      return true;
    }

    return false;
  }

  /**
   * Checks if the final object exists in storage.
   */
  async finalObjectExists(finalKey: string): Promise<boolean> {
    const destPath = this.resolvePath(finalKey);
    return fs.existsSync(destPath);
  }

  /**
   * Reads an object from storage as a Buffer.
   */
  async readObjectBuffer(key: string): Promise<Buffer | null> {
    const filePath = this.resolvePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath);
  }

  /**
   * Returns a readable stream for streaming downloads and previews.
   */
  getObjectStream(key: string): fs.ReadStream | null {
    const filePath = this.resolvePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.createReadStream(filePath);
  }

  /**
   * Deletes a quarantine object.
   */
  async deleteQuarantineObject(quarantineKey: string): Promise<void> {
    const srcPath = this.resolvePath(quarantineKey);
    if (fs.existsSync(srcPath)) {
      fs.unlinkSync(srcPath);
    }
  }

  /**
   * Idempotently deletes an object from storage.
   * Returns true if file was deleted or was already absent.
   */
  async deleteObject(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    if (!fs.existsSync(filePath)) {
      return true; // Already deleted / absent
    }
    try {
      fs.unlinkSync(filePath);
      logger.info(`[Storage] Permanently deleted object at key: ${key}`);
      return true;
    } catch (err: any) {
      logger.error(`[Storage] Failed to delete object at key: ${key} - ${err.message}`);
      return false;
    }
  }

  /**
   * Permanently purges all storage files associated with a document (source, PDF, thumbnails).
   */
  async purgeDocumentStorage(keys: string[]): Promise<{ deleted: string[]; notFound: string[]; failed: string[] }> {
    const result = {
      deleted: [] as string[],
      notFound: [] as string[],
      failed: [] as string[],
    };

    for (const key of keys) {
      if (!key) continue;
      const filePath = this.resolvePath(key);
      if (!fs.existsSync(filePath)) {
        result.notFound.push(key);
        continue;
      }

      try {
        fs.unlinkSync(filePath);
        result.deleted.push(key);
      } catch (err: any) {
        logger.error(`[Storage] Purge error on key ${key}: ${err.message}`);
        result.failed.push(key);
      }
    }

    logger.info(`[Storage] Purged ${result.deleted.length} object(s), ${result.notFound.length} already absent, ${result.failed.length} failed`);
    return result;
  }
}

export const objectStorage = new ObjectStorageClient();
