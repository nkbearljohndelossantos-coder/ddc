import { Readable } from 'stream';

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  sha256Hash: string;
  contentType: string;
  lastModified: Date;
}

export interface MultipartUploadSession {
  uploadId: string;
  key: string;
  parts: { partNumber: number; etag: string; sizeBytes: number }[];
}

export interface IObjectStorageProvider {
  putObject(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<StorageObjectMetadata>;
  getObject(key: string): Promise<Buffer>;
  getObjectStream(key: string): Promise<Readable>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<boolean>;
  copyObject(sourceKey: string, destinationKey: string): Promise<StorageObjectMetadata>;
  
  // Multipart / Large File Upload
  createMultipartUpload(key: string, contentType?: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, data: Buffer): Promise<{ partNumber: number; etag: string; sizeBytes: number }>;
  completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<StorageObjectMetadata>;
  abortMultipartUpload(key: string, uploadId: string): Promise<boolean>;
}
