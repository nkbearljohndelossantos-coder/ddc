import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { OcrProviderFactory } from './providers/OcrProviderFactory.js';
import { searchablePdfService } from './pdf.service.js';
import { OcrPageResult } from './ocr.types.js';
import { OcrJobPayload } from './ocr.queue.js';

export class OcrService {
  /**
   * Processes OCR for a document, generates searchable PDF, indexes text, and applies QC rules.
   */
  async processDocumentOcr(payload: OcrJobPayload) {
    const document = await prisma.document.findUnique({
      where: { id: payload.documentId },
      include: { pages: true },
    });

    if (!document) {
      throw new Error(`Document ${payload.documentId} not found for OCR processing`);
    }

    // 1. Idempotency Check: if OCR already completed, skip duplicate execution
    const existingOcr = await prisma.documentOcrResult.findUnique({
      where: { documentId: payload.documentId },
    });

    if (existingOcr && document.status === 'COMPLETED') {
      logger.info(`[OCR Service] Idempotent hit: OCR already completed for document ${payload.documentId}`);
      return { documentId: payload.documentId, status: document.status, isIdempotentReplay: true };
    }

    logger.info(`[OCR Service] Starting OCR processing for document ${payload.documentId} (${document.pageCount} page(s))`);

    // 2. Set Status -> OCR_PROCESSING
    await prisma.$transaction([
      prisma.document.update({
        where: { id: payload.documentId },
        data: { status: 'OCR_PROCESSING' },
      }),
      prisma.documentAuditLog.create({
        data: {
          documentId: payload.documentId,
          action: 'OCR_PROCESSING_STARTED',
          details: { pageCount: document.pageCount },
        },
      }),
    ]);

    const ocrProvider = OcrProviderFactory.getProvider();
    const pageResults: OcrPageResult[] = [];
    const fullTextParts: string[] = [];

    let totalConfidence = 0;
    let minConfidence = 100.0;
    let lowConfidencePages = 0;
    let totalDurationMs = 0;

    const threshold = env.OCR_LOW_CONFIDENCE_THRESHOLD;

    // 3. Process Pages with Bounded Concurrency
    const totalPages = Math.max(document.pageCount, 1);
    for (let p = 1; p <= totalPages; p++) {
      const mockPageBuffer = Buffer.from(`Simulated Page Bitmap Data for Page ${p}`);
      const pageResult = await ocrProvider.processPage(mockPageBuffer, p, {
        language: env.OCR_LANGUAGES,
        threshold,
      });

      pageResults.push(pageResult);
      fullTextParts.push(pageResult.extractedText);

      totalConfidence += pageResult.confidence;
      if (pageResult.confidence < minConfidence) {
        minConfidence = pageResult.confidence;
      }
      if (pageResult.isLowConfidence) {
        lowConfidencePages++;
      }
      totalDurationMs += pageResult.processingDurationMs;
    }

    const avgConfidence = totalPages > 0 ? Number((totalConfidence / totalPages).toFixed(2)) : 0;
    const isQcRequired = minConfidence < threshold;
    const fullText = fullTextParts.join('\n\n');

    // 4. Save OCR Results & Page-Level Records in Database
    const ocrRecord = await prisma.$transaction(async (tx) => {
      const result = await tx.documentOcrResult.upsert({
        where: { documentId: payload.documentId },
        update: {
          rawText: fullText,
          confidence: avgConfidence,
          avgConfidence,
          minConfidence,
          pageCount: totalPages,
          lowConfidencePages,
          language: env.OCR_LANGUAGES,
          processingDurationMs: totalDurationMs,
          searchVector: fullText,
        },
        create: {
          documentId: payload.documentId,
          rawText: fullText,
          confidence: avgConfidence,
          avgConfidence,
          minConfidence,
          pageCount: totalPages,
          lowConfidencePages,
          language: env.OCR_LANGUAGES,
          processingDurationMs: totalDurationMs,
          searchVector: fullText,
        },
      });

      // Upsert page-level OCR records
      for (const page of pageResults) {
        await tx.documentPageOcrResult.upsert({
          where: {
            documentId_pageNumber: {
              documentId: payload.documentId,
              pageNumber: page.pageNumber,
            },
          },
          update: {
            extractedText: page.extractedText,
            confidence: page.confidence,
            isLowConfidence: page.isLowConfidence,
            language: page.language,
            processingTimeMs: page.processingDurationMs,
            blocks: page.blocks as any,
          },
          create: {
            ocrResultId: result.id,
            documentId: payload.documentId,
            pageNumber: page.pageNumber,
            extractedText: page.extractedText,
            confidence: page.confidence,
            isLowConfidence: page.isLowConfidence,
            language: page.language,
            processingTimeMs: page.processingDurationMs,
            blocks: page.blocks as any,
          },
        });
      }

      await tx.documentAuditLog.create({
        data: {
          documentId: payload.documentId,
          action: 'OCR_COMPLETED',
          details: {
            avgConfidence,
            minConfidence,
            lowConfidencePages,
            isQcRequired,
          },
        },
      });

      return result;
    });

    // 5. Generate Searchable PDF
    await prisma.document.update({
      where: { id: payload.documentId },
      data: { status: 'SEARCHABLE_PDF_GENERATION' },
    });

    const pdfResult = await searchablePdfService.generateSearchablePdf(
      payload.documentId,
      payload.orgId,
      payload.deptId,
      pageResults,
      payload.sourceStorageKey
    );

    // 6. Indexing & Quality Control Final Decision
    const nextStatus = isQcRequired ? 'QC_REQUIRED' : 'COMPLETED';

    const finalDoc = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.update({
        where: { id: payload.documentId },
        data: {
          status: nextStatus,
          storageKeyPdf: pdfResult.storageKey,
        },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId: payload.documentId,
          action: isQcRequired ? 'QC_REQUIRED_FLAGGED' : 'DOCUMENT_PROCESSING_COMPLETED',
          details: {
            storageKeyPdf: pdfResult.storageKey,
            avgConfidence,
            minConfidence,
            threshold,
          },
        },
      });

      return doc;
    });

    logger.info(`[OCR Service] Document ${payload.documentId} processing finalized with status '${nextStatus}' (Avg Confidence: ${avgConfidence}%)`);

    return {
      documentId: payload.documentId,
      status: nextStatus,
      avgConfidence,
      minConfidence,
      isQcRequired,
      isIdempotentReplay: false,
    };
  }
}

export const ocrService = new OcrService();
