import { IOcrProvider, OcrPageResult, OcrDocumentResult, OcrCapabilities, OcrBlock } from '../ocr.types.js';

export class MockOcrProvider implements IOcrProvider {
  readonly providerName: string = 'MOCK_OCR';
  private mockText: string = 'NKB Enterprise Document Management - Scanned Invoice #INV-2026-0801';
  private mockConfidence: number = 95.5;
  private shouldFail: boolean = false;

  setMockText(text: string) {
    this.mockText = text;
  }

  setMockConfidence(confidence: number) {
    this.mockConfidence = confidence;
  }

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  async processPage(
    pageBuffer: Buffer,
    pageNumber: number,
    options?: { language?: string; threshold?: number }
  ): Promise<OcrPageResult> {
    if (this.shouldFail) {
      throw new Error('Mock OCR processing simulated failure');
    }

    const threshold = options?.threshold || 75.0;
    const confidence = this.mockConfidence;
    const isLowConfidence = confidence < threshold;

    const block: OcrBlock = {
      blockType: 'TEXT',
      text: `${this.mockText} (Page ${pageNumber})`,
      confidence,
      lines: [
        {
          text: `${this.mockText} (Page ${pageNumber})`,
          confidence,
          words: this.mockText.split(' ').map((w) => ({
            text: w,
            confidence,
            bbox: { x0: 10, y0: 10, x1: 50, y1: 20 },
          })),
        },
      ],
    };

    return {
      pageNumber,
      extractedText: block.text,
      confidence,
      isLowConfidence,
      language: options?.language || 'eng',
      blocks: [block],
      processingDurationMs: 45,
      diagnostics: { engine: 'MockOcrProvider' },
    };
  }

  async processDocument(
    documentBuffer: Buffer,
    options?: { language?: string; threshold?: number; maxConcurrency?: number }
  ): Promise<OcrDocumentResult> {
    const page1 = await this.processPage(documentBuffer, 1, options);
    const threshold = options?.threshold || 75.0;

    return {
      documentId: 'doc-mock-1',
      pages: [page1],
      fullText: page1.extractedText,
      avgConfidence: page1.confidence,
      minConfidence: page1.confidence,
      lowConfidencePageCount: page1.isLowConfidence ? 1 : 0,
      language: page1.language,
      totalDurationMs: 45,
      isQcRequired: page1.confidence < threshold,
    };
  }

  getCapabilities(): OcrCapabilities {
    return {
      supportsHocr: true,
      supportsBoundingBoxes: true,
      supportsMultiLanguage: true,
      supportedLanguages: ['eng', 'spa', 'fra', 'deu', 'jpn'],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
