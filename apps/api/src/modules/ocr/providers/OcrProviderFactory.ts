import { IOcrProvider } from '../ocr.types.js';
import { TesseractOcrProvider } from './TesseractOcrProvider.js';
import { MockOcrProvider } from './MockOcrProvider.js';
import { env } from '../../../config/env.js';

export class OcrProviderFactory {
  private static instance?: IOcrProvider;

  static getProvider(): IOcrProvider {
    if (this.instance) {
      return this.instance;
    }

    const providerType = env.OCR_PROVIDER;

    switch (providerType) {
      case 'TESSERACT':
        this.instance = new TesseractOcrProvider(env.TESSERACT_PATH, env.OCR_LANGUAGES);
        break;
      case 'MOCK':
        this.instance = new MockOcrProvider();
        break;
      default:
        this.instance = new TesseractOcrProvider(env.TESSERACT_PATH, env.OCR_LANGUAGES);
        break;
    }

    return this.instance;
  }

  static setProvider(customProvider: IOcrProvider) {
    this.instance = customProvider;
  }

  static reset() {
    this.instance = undefined;
  }
}
