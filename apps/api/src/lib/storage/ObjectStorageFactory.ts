import { IObjectStorageProvider } from './IObjectStorageProvider.js';
import { LocalObjectStorageProvider } from './LocalObjectStorageProvider.js';
import { MockObjectStorageProvider } from './MockObjectStorageProvider.js';

export class ObjectStorageFactory {
  private static mockInstance = new MockObjectStorageProvider();
  private static localInstance = new LocalObjectStorageProvider();

  public static getProvider(type: 'LOCAL' | 'S3' | 'MOCK' = 'MOCK'): IObjectStorageProvider {
    switch (type) {
      case 'LOCAL':
        return this.localInstance;
      case 'S3':
      case 'MOCK':
      default:
        return this.mockInstance;
    }
  }

  public static getMockProvider(): MockObjectStorageProvider {
    return this.mockInstance;
  }
}
