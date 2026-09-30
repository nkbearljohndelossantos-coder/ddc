export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox?: OcrBoundingBox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
  bbox?: OcrBoundingBox;
}

export interface OcrBlock {
  blockType: 'TEXT' | 'TABLE' | 'BARCODE' | 'SEPARATOR';
  text: string;
  confidence: number;
  lines: OcrLine[];
  bbox?: OcrBoundingBox;
}

export interface OcrPageResult {
  pageNumber: number;
  extractedText: string;
  confidence: number;
  isLowConfidence: boolean;
  language: string;
  blocks: OcrBlock[];
  processingDurationMs: number;
  diagnostics?: Record<string, any>;
}

export interface OcrDocumentResult {
  documentId: string;
  pages: OcrPageResult[];
  fullText: string;
  avgConfidence: number;
  minConfidence: number;
  lowConfidencePageCount: number;
  language: string;
  totalDurationMs: number;
  isQcRequired: boolean;
}

export interface OcrCapabilities {
  supportsHocr: boolean;
  supportsBoundingBoxes: boolean;
  supportsMultiLanguage: boolean;
  supportedLanguages: string[];
}

export interface IOcrProvider {
  readonly providerName: string;
  processPage(
    pageBuffer: Buffer,
    pageNumber: number,
    options?: { language?: string; threshold?: number }
  ): Promise<OcrPageResult>;
  processDocument(
    documentBuffer: Buffer,
    options?: { language?: string; threshold?: number; maxConcurrency?: number }
  ): Promise<OcrDocumentResult>;
  getCapabilities(): OcrCapabilities;
  healthCheck(): Promise<boolean>;
}
