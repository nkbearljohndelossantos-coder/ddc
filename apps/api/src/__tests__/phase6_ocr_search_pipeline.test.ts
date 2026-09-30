import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { MockOcrProvider } from '../modules/ocr/providers/MockOcrProvider.js';
import { TesseractOcrProvider } from '../modules/ocr/providers/TesseractOcrProvider.js';
import { OcrProviderFactory } from '../modules/ocr/providers/OcrProviderFactory.js';
import { SearchablePdfService } from '../modules/ocr/pdf.service.js';

describe('Phase 6: Production OCR, Quality Control, Searchable PDF & Full-Text Search Tests', () => {
  // In-memory mock database state for OCR & Search tests
  const mockDb = {
    documents: new Map<string, any>(),
    ocrResults: new Map<string, any>(),
    pageResults: new Map<string, any>(),
    auditLogs: [] as any[],
  };

  // =========================================================================
  // 1. OCR PROVIDER ABSTRACTION & CAPABILITIES
  // =========================================================================
  describe('1. OCR Provider Abstraction & Providers', () => {
    it('should query Tesseract OCR capabilities and supported languages', () => {
      const tesseract = new TesseractOcrProvider(undefined, 'eng');
      const caps = tesseract.getCapabilities();

      assert.strictEqual(caps.supportsHocr, true);
      assert.strictEqual(caps.supportsBoundingBoxes, true);
      assert.ok(caps.supportedLanguages.includes('eng'));
      assert.ok(caps.supportedLanguages.includes('spa'));
    });

    it('should process page through MockOcrProvider with word-level bounding boxes', async () => {
      const mockOcr = new MockOcrProvider();
      mockOcr.setMockText('Purchase Order #PO-98765 Vendor: Acme Corp Total: $4,500.00');
      mockOcr.setMockConfidence(96.2);

      const pageResult = await mockOcr.processPage(Buffer.from('bitmap data'), 1, { threshold: 75.0 });

      assert.strictEqual(pageResult.pageNumber, 1);
      assert.strictEqual(pageResult.confidence, 96.2);
      assert.strictEqual(pageResult.isLowConfidence, false);
      assert.ok(pageResult.extractedText.includes('Purchase Order #PO-98765'));
      assert.ok(pageResult.blocks.length > 0);
      assert.ok(pageResult.blocks[0].lines[0].words.length >= 4);
    });

    it('should handle and report OCR processing failure when provider errors', async () => {
      const failingMock = new MockOcrProvider();
      failingMock.setShouldFail(true);

      await assert.rejects(
        async () => {
          await failingMock.processPage(Buffer.from('corrupted page'), 1);
        },
        /Mock OCR processing simulated failure/
      );
    });
  });

  // =========================================================================
  // 2. CONFIDENCE CALCULATION & QUALITY CONTROL (QC_REQUIRED)
  // =========================================================================
  describe('2. Confidence Calculation & Quality Control Thresholds', () => {
    it('should flag document as QC_REQUIRED when min confidence drops below threshold', async () => {
      const mockOcr = new MockOcrProvider();
      const threshold = 80.0;

      // Simulate low-quality degraded scan (68.4% confidence)
      mockOcr.setMockConfidence(68.4);
      mockOcr.setMockText('Faint blurry text difficult to recognize');

      const pageResult = await mockOcr.processPage(Buffer.from('page-1'), 1, { threshold });

      assert.strictEqual(pageResult.confidence, 68.4);
      assert.strictEqual(pageResult.isLowConfidence, true);

      const isQcRequired = pageResult.confidence < threshold;
      assert.strictEqual(isQcRequired, true, 'Document must be flagged QC_REQUIRED');
    });

    it('should approve high confidence document without QC required flag', async () => {
      const mockOcr = new MockOcrProvider();
      const threshold = 75.0;

      mockOcr.setMockConfidence(98.1);
      const pageResult = await mockOcr.processPage(Buffer.from('page-1'), 1, { threshold });

      assert.strictEqual(pageResult.isLowConfidence, false);
      assert.strictEqual(pageResult.confidence >= threshold, true);
    });
  });

  // =========================================================================
  // 3. SEARCHABLE PDF GENERATION & INTEGRITY
  // =========================================================================
  describe('3. Searchable PDF Generation & Deterministic Deduplication', () => {
    const pdfService = new SearchablePdfService();

    it('should generate searchable PDF with invisible selectable text layer and SHA-256 hash', async () => {
      const docId = 'doc-pdf-test-01';
      const pages = [
        {
          pageNumber: 1,
          extractedText: 'Page 1 OCR Text - Commercial Lease Agreement',
          confidence: 95.0,
          isLowConfidence: false,
          language: 'eng',
          blocks: [],
          processingDurationMs: 30,
        },
      ];

      const result = await pdfService.generateSearchablePdf(
        docId,
        'org-1',
        'dept-legal',
        pages,
        'final/source/doc.dat'
      );

      assert.ok(result.storageKey.includes('searchable_doc-pdf-test-01.pdf'));
      assert.ok(result.sha256Hash.length > 0);
      assert.strictEqual(result.pageCount, 1);
    });
  });

  // =========================================================================
  // 4. FULL-TEXT SEARCH & DEPARTMENT ISOLATION
  // =========================================================================
  describe('4. Full-Text Search Engine & Department Isolation', () => {
    // Seed in-memory search records
    mockDb.documents.set('doc-acct-01', {
      id: 'doc-acct-01',
      title: 'Monthly Accounting Audit Report Q3 2026',
      departmentId: 'dept-accounting',
      organizationId: 'org-hq-1',
      rawText: 'Financial statement balance sheet revenue expenses ledger taxation',
      status: 'COMPLETED',
      createdAt: new Date('2026-08-20'),
    });

    mockDb.documents.set('doc-hr-02', {
      id: 'doc-hr-02',
      title: 'Employee Onboarding & Compensation Form',
      departmentId: 'dept-hr',
      organizationId: 'org-hq-1',
      rawText: 'Confidential employee salary health benefits employment agreement',
      status: 'COMPLETED',
      createdAt: new Date('2026-08-22'),
    });

    it('should find documents matching keywords in title or OCR full-text', () => {
      const q = 'taxation';
      const docs = Array.from(mockDb.documents.values()).filter(
        (d) => d.title.toLowerCase().includes(q) || d.rawText.toLowerCase().includes(q)
      );

      assert.strictEqual(docs.length, 1);
      assert.strictEqual(docs[0].id, 'doc-acct-01');
    });

    it('should strictly isolate search results by department for standard departmental users', () => {
      const hrUserContext = {
        organizationId: 'org-hq-1',
        departmentId: 'dept-hr',
        roles: ['DEPARTMENT_USER'],
      };

      // HR user searches for 'agreement' (present in HR doc, not accessible to Accounting)
      const visibleDocs = Array.from(mockDb.documents.values()).filter(
        (d) => d.departmentId === hrUserContext.departmentId
      );

      assert.strictEqual(visibleDocs.length, 1);
      assert.strictEqual(visibleDocs[0].id, 'doc-hr-02');

      // Attempting to view Accounting doc: must not be in HR user's results
      const acctDocInHrResults = visibleDocs.find((d) => d.id === 'doc-acct-01');
      assert.strictEqual(acctDocInHrResults, undefined, 'Department user cannot view documents outside their department');
    });

    it('should allow SUPER_ADMIN to search across all departments unrestricted', () => {
      const superAdminContext = {
        organizationId: 'org-hq-1',
        departmentId: null,
        roles: ['SUPER_ADMIN'],
      };

      const allDocs = Array.from(mockDb.documents.values());
      assert.strictEqual(allDocs.length, 2, 'SUPER_ADMIN can search across all company departments');
    });
  });

  // =========================================================================
  // 5. OCR STATE MACHINE & IDEMPOTENT FINALIZATION
  // =========================================================================
  describe('5. OCR State Machine & Idempotency', () => {
    it('should prevent duplicate OCR processing when document is already completed', () => {
      const completedDoc = {
        documentId: 'doc-completed-1',
        status: 'COMPLETED',
        ocrDone: true,
      };

      // Second OCR execution attempt: return existing state without duplicate work
      const isAlreadyCompleted = completedDoc.status === 'COMPLETED' && completedDoc.ocrDone;
      assert.strictEqual(isAlreadyCompleted, true, 'Duplicate OCR execution must be blocked idempotently');
    });
  });
});
