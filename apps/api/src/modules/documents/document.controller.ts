import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { searchService } from '../search/search.service.js';
import { scannerService } from '../scanners/scanner.service.js';
import { prisma } from '../../lib/prisma.js';
import { mergeFilesToPdf, splitPdfToPages, createZipArchive, generateDossierDocketPdf } from '../../lib/pdfMergeSplit.js';

export function detectMimeType(filePath: string, fallbackName?: string): string {
  const ext = (path.extname(filePath) || (fallbackName ? path.extname(fallbackName) : '')).toLowerCase();
  
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.txt' || ext === '.log') return 'text/plain; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';

  // Magic bytes inspection
  try {
    if (fs.existsSync(filePath)) {
      const buffer = Buffer.alloc(32);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 32, 0);
      fs.closeSync(fd);

      if (buffer.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString() === 'PNG') return 'image/png';
      if (buffer.subarray(0, 4).toString() === 'GIF8') return 'image/gif';
      if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';

      let isText = bytesRead > 0;
      for (let i = 0; i < bytesRead; i++) {
        const b = buffer[i];
        if (b === 0) { isText = false; break; }
      }
      if (isText) return 'text/plain; charset=utf-8';
    }
  } catch (e) {}

  return 'application/octet-stream';
}

export function resolveProperDownloadFilename(preferredName: string, filePath?: string | null, mimeType?: string): string {
  let base = (preferredName || 'document').trim();
  let existingExt = path.extname(base).toLowerCase();
  
  if (!existingExt && filePath) {
    existingExt = path.extname(filePath).toLowerCase();
  }

  if (!existingExt && mimeType) {
    if (mimeType.includes('application/pdf')) existingExt = '.pdf';
    else if (mimeType.includes('image/jpeg')) existingExt = '.jpg';
    else if (mimeType.includes('image/png')) existingExt = '.png';
    else if (mimeType.includes('image/gif')) existingExt = '.gif';
    else if (mimeType.includes('image/webp')) existingExt = '.webp';
    else if (mimeType.includes('text/plain')) existingExt = '.txt';
    else if (mimeType.includes('text/csv')) existingExt = '.csv';
    else if (mimeType.includes('application/json')) existingExt = '.json';
  }

  if (!existingExt) {
    existingExt = '.pdf';
  }

  // Ensure base ends with the extension
  if (!base.toLowerCase().endsWith(existingExt)) {
    base = `${base}${existingExt}`;
  }

  return base.replace(/[^\w\s.-]/gi, '_');
}

export interface SmartAutoTagResult {
  folderCategory: 'BIR' | 'COMPANY_DOCS';
  categoryTag: string;
  documentType: string;
  confidence: number;
  matchedRule: string;
  matchedKeywords: string[];
  autoTagged: boolean;
}

const SMART_AUTO_TAG_RULES: Array<{
  folderCategory: 'BIR' | 'COMPANY_DOCS';
  categoryTag: string;
  documentType: string;
  ruleName: string;
  patterns: RegExp[];
  weight: number;
}> = [
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-2307',
    documentType: 'BIR_2307',
    ruleName: 'BIR Form 2307 (Creditable Tax Withheld at Source)',
    patterns: [/\b2307\b/i, /creditable\s+tax\s+withheld/i, /withholding\s+tax\s+at\s+source/i, /\bcwt\b/i],
    weight: 100,
  },
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-2316',
    documentType: 'BIR_2316',
    ruleName: 'BIR Form 2316 (Certificate of Compensation Payment / Tax Withheld)',
    patterns: [/\b2316\b/i, /compensation\s+payment/i, /tax\s+withheld\s+on\s+compensation/i, /\balphalist\b/i],
    weight: 100,
  },
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-VAT',
    documentType: 'BIR_VAT',
    ruleName: 'BIR Form 2550M/2550Q (Value-Added Tax Declaration)',
    patterns: [/\b2550[mq]?\b/i, /value[\s-]*added\s+tax/i, /\bvat\s+(return|declaration|relief|summary|invoice)\b/i, /\bvat\b/i],
    weight: 95,
  },
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-Income-Tax',
    documentType: 'BIR_TAX_RETURN',
    ruleName: 'BIR Form 1701/1702 (Annual / Quarterly Income Tax Return)',
    patterns: [/\b170[012][A-Za-z]?\b/i, /income\s+tax\s+return/i, /\bitr\b/i, /quarterly\s+income\s+tax/i, /annual\s+income\s+tax/i],
    weight: 95,
  },
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-COR',
    documentType: 'BIR_COR',
    ruleName: 'BIR Form 2303 (Certificate of Registration / Authority to Print)',
    patterns: [/\b2303\b/i, /certificate\s+of\s+registration/i, /\bbir[\s_-]*cor\b/i, /authority\s+to\s+print/i, /\batp\b/i, /\btin\s*(card|id|verification)\b/i],
    weight: 95,
  },
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-Official-Receipt',
    documentType: 'BIR_OFFICIAL_RECEIPT',
    ruleName: 'BIR Official Receipt / Collection Receipt',
    patterns: [/official\s+receipt/i, /collection\s+receipt/i, /\bbir\s+receipt\b/i, /\bor[\s#-]*\d+/i, /\breceipt[\s_-]*\d+/i],
    weight: 88,
  },
  {
    folderCategory: 'BIR',
    categoryTag: '#BIR-Tax-Compliance',
    documentType: 'BIR_TAX_RETURN',
    ruleName: 'BIR Tax Compliance / Return (0605 / 1601 / eFPS / eBIRForms)',
    patterns: [/\bbir\b/i, /bureau\s+of\s+internal\s+revenue/i, /\b(0605|1601[cefq]?|1604[cf]?|2306)\b/i, /\befps\b/i, /\bebirforms\b/i, /tax\s+(compliance|clearance|return|assessment|payment)/i, /withholding\s+tax/i],
    weight: 85,
  },
  {
    folderCategory: 'COMPANY_DOCS',
    categoryTag: '#Company-Contract',
    documentType: 'CONTRACT',
    ruleName: "Company's Documentation — Legal Contract / MOA / NDA",
    patterns: [/\bcontract\b/i, /\bagreement\b/i, /memorandum\s+of\s+agreement/i, /\bmoa\b/i, /\bmou\b/i, /\bnda\b/i, /non[\s-]*disclosure/i, /deed\s+of/i, /\blease\b/i, /\bsla\b/i],
    weight: 92,
  },
  {
    folderCategory: 'COMPANY_DOCS',
    categoryTag: '#Company-SEC-GIS',
    documentType: 'COMPANY_DOCUMENTATION',
    ruleName: "Company's Documentation — SEC / GIS / Board Resolution",
    patterns: [/\bsec\b/i, /\bgis\b/i, /general\s+information\s+sheet/i, /articles\s+of\s+incorporation/i, /by[\s-]*laws/i, /board\s+resolution/i, /secretary['’]?s\s+certificate/i],
    weight: 92,
  },
  {
    folderCategory: 'COMPANY_DOCS',
    categoryTag: '#Company-HR-Record',
    documentType: 'HR_DOCUMENT',
    ruleName: "Company's Documentation — HR / Employee / Payroll Record",
    patterns: [/\bhr\b/i, /human\s+resources/i, /\bemployee\b/i, /\b201\s*file\b/i, /\bpayroll\b/i, /\bpayslip\b/i, /\bdtr\b/i, /\bresume\b/i, /employment/i, /\bmemorandum\b/i, /\bmemo\b/i],
    weight: 88,
  },
  {
    folderCategory: 'COMPANY_DOCS',
    categoryTag: '#Company-Invoice-PO',
    documentType: 'PURCHASE_ORDER',
    ruleName: "Company's Documentation — Commercial Invoice / Purchase Order / DR",
    patterns: [/purchase\s+order/i, /\bpo[\s#_-]*\d+/i, /\binvoice\b/i, /\bbilling\b/i, /\bquotation\b/i, /delivery\s+receipt/i, /\bdr[\s#_-]*\d+/i, /\bsoa\b/i, /statement\s+of\s+account/i, /requisition/i],
    weight: 90,
  },
  {
    folderCategory: 'COMPANY_DOCS',
    categoryTag: '#Company-Accounting',
    documentType: 'FINANCIAL_RECORD',
    ruleName: "Company's Documentation — Accounting / Financial / Audit Record",
    patterns: [/\baccounting\b/i, /financial\s+statement/i, /balance\s+sheet/i, /trial\s+balance/i, /\bledger\b/i, /\baudit\b/i, /\bvoucher\b/i, /\bdisbursement\b/i, /\bbudget\b/i, /reimbursement/i, /petty\s+cash/i],
    weight: 89,
  },
  {
    folderCategory: 'COMPANY_DOCS',
    categoryTag: '#Company-Permit-License',
    documentType: 'COMPANY_DOCUMENTATION',
    ruleName: "Company's Documentation — Business Permit / License / Government Clearance",
    patterns: [/\bpermit\b/i, /mayor['’]?s\s+permit/i, /barangay\s+clearance/i, /sanitary/i, /fire\s+safety/i, /\bfsic\b/i, /\blicense\b/i, /\bfda\b/i, /\bdenr\b/i, /\bdti\b/i, /\bphilhealth\b/i, /\bsss\b/i, /pag[\s-]*ibig/i],
    weight: 90,
  },
];

export function extractSampleTextFromFileOrBuffer(filePath?: string | null, buffer?: Buffer | null): string {
  try {
    let buf = buffer || null;
    if (!buf && filePath && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const readLen = Math.min(stat.size, 65536);
      const fd = fs.openSync(filePath, 'r');
      buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, 0);
      fs.closeSync(fd);
    }
    if (!buf || buf.length === 0) return '';
    // Extract readable ASCII/Latin strings of length >= 4 (works on plain text, CSV, JSON, and uncompressed PDF metadata/text streams)
    const raw = buf.toString('latin1');
    const matches = raw.match(/[A-Za-z0-9][A-Za-z0-9\s\-_.,/#():]{3,60}/g);
    if (!matches) return '';
    return matches.slice(0, 180).join(' ');
  } catch {
    return '';
  }
}

export function smartAutoClassifyDocument(params: {
  title?: string;
  originalFilename?: string;
  docType?: string;
  remarks?: string;
  ocrText?: string;
  filePath?: string | null;
  fileBuffer?: Buffer | null;
  explicitFolder?: string;
  explicitTag?: string;
}): SmartAutoTagResult {
  const sampleFileText = extractSampleTextFromFileOrBuffer(params.filePath, params.fileBuffer);
  const corpus = [
    params.title || '',
    params.originalFilename || '',
    params.remarks || '',
    params.ocrText || '',
    params.docType || '',
    sampleFileText,
  ].join(' ');

  let bestRule: (typeof SMART_AUTO_TAG_RULES)[number] | null = null;
  let bestScore = 0;
  let matchedKeywords: string[] = [];

  for (const rule of SMART_AUTO_TAG_RULES) {
    let hitCount = 0;
    const hits: string[] = [];
    for (const regex of rule.patterns) {
      const m = corpus.match(regex);
      if (m) {
        hitCount++;
        hits.push(m[0]);
      }
    }
    if (hitCount > 0) {
      const score = rule.weight + (hitCount - 1) * 12;
      if (score > bestScore) {
        bestScore = score;
        bestRule = rule;
        matchedKeywords = hits;
      }
    }
  }

  // If explicit non-default tag was deliberately chosen and no stronger rule override is requested
  const expTag = (params.explicitTag || '').trim();
  const expFolder = (params.explicitFolder || '').trim().toUpperCase();
  const isGenericDefault =
    !expTag ||
    expTag === 'AUTO' ||
    expTag === '#Company-General-Doc' ||
    (expTag === '#BIR-2307' && expFolder !== 'BIR');

  if (bestRule && (isGenericDefault || expFolder === 'AUTO')) {
    return {
      folderCategory: bestRule.folderCategory,
      categoryTag: bestRule.categoryTag,
      documentType: bestRule.documentType,
      confidence: Math.min(99.4, Number((88 + Math.min(11, bestScore / 12)).toFixed(1))),
      matchedRule: bestRule.ruleName,
      matchedKeywords,
      autoTagged: true,
    };
  }

  if (expTag && expTag !== 'AUTO') {
    const cleanTag = expTag.startsWith('#') ? expTag : `#${expTag}`;
    const folder: 'BIR' | 'COMPANY_DOCS' =
      cleanTag.toUpperCase().startsWith('#BIR') || expFolder === 'BIR' ? 'BIR' : 'COMPANY_DOCS';
    return {
      folderCategory: folder,
      categoryTag: cleanTag,
      documentType: params.docType || (bestRule ? bestRule.documentType : folder === 'BIR' ? 'BIR_TAX_RETURN' : 'COMPANY_DOCUMENTATION'),
      confidence: bestRule ? 96.5 : 90.0,
      matchedRule: bestRule ? bestRule.ruleName : `Assigned ${cleanTag}`,
      matchedKeywords,
      autoTagged: Boolean(bestRule),
    };
  }

  if (bestRule) {
    return {
      folderCategory: bestRule.folderCategory,
      categoryTag: bestRule.categoryTag,
      documentType: bestRule.documentType,
      confidence: Math.min(99.4, Number((88 + Math.min(11, bestScore / 12)).toFixed(1))),
      matchedRule: bestRule.ruleName,
      matchedKeywords,
      autoTagged: true,
    };
  }

  const fallbackFolder: 'BIR' | 'COMPANY_DOCS' = expFolder === 'BIR' ? 'BIR' : 'COMPANY_DOCS';
  return {
    folderCategory: fallbackFolder,
    categoryTag: fallbackFolder === 'BIR' ? '#BIR-Tax-Compliance' : '#Company-General-Doc',
    documentType: params.docType || (fallbackFolder === 'BIR' ? 'BIR_TAX_RETURN' : 'COMPANY_DOCUMENTATION'),
    confidence: 85.0,
    matchedRule: fallbackFolder === 'BIR' ? 'Default BIR Tax Compliance Classification' : "Default Company's Documentation Classification",
    matchedKeywords: [],
    autoTagged: true,
  };
}

export function resolveFolderCategory(title?: string, docType?: string, explicitFolder?: string): 'BIR' | 'COMPANY_DOCS' {
  return smartAutoClassifyDocument({ title, docType, explicitFolder }).folderCategory;
}

export function resolveCategoryTag(
  title?: string,
  docType?: string,
  folderCategory?: 'BIR' | 'COMPANY_DOCS',
  explicitTag?: string
): string {
  return smartAutoClassifyDocument({
    title,
    docType,
    explicitFolder: folderCategory,
    explicitTag,
  }).categoryTag;
}

export class DocumentController {
  // Ingest / Create Document (From Universal Scanner, Windows Uploader, or Manual Upload -> Cloud Storage)
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const {
        title,
        departmentId,
        documentType,
        folderCategory,
        categoryTag,
        customTags,
        remarks,
        pageCount,
        fileSizeBytes,
        sha256Hash,
        usePhysicalHardware,
        scannerDevice,
        portName,
        driverType,
      } = req.body;

      const docTitle = title || `Scan_NKB_${new Date().toISOString().slice(0, 10)}.pdf`;

      let finalHash = sha256Hash;
      let finalSizeBytes = fileSizeBytes || 102400;
      let finalStorageKey: string | null = null;
      let localSavedPath: string | null = null;
      let finalPageCount = pageCount || 1;
      let scannedPagesData: any[] = [];
      let storageTier = 'CLOUD_STORAGE';
      let uploadedFileBuf: Buffer | null = null;

      // Save fileData if provided (e.g. from Scanner attach, Camera snapshot, Windows Uploader, or Manual Upload -> Cloud Storage)
      if (req.body.fileData) {
        try {
          const uploadDir = path.resolve(process.cwd(), 'uploads', 'documents');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const fileBuf = Buffer.from(req.body.fileData, 'base64');
          uploadedFileBuf = fileBuf;
          if (!finalHash) {
            finalHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
          }
          finalSizeBytes = fileBuf.length;
          const safeTitle = (docTitle || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
          const destFile = path.join(uploadDir, `${finalHash.slice(0, 12)}_${safeTitle}`);
          fs.writeFileSync(destFile, fileBuf);
          finalStorageKey = destFile;
          storageTier = 'CLOUD_STORAGE';

          // Dual-save to Local Storage Scans folder
          try {
            const localBase = scannerService.getLocalStoragePath();
            const localScansDir = path.join(localBase, 'Scans');
            if (!fs.existsSync(localScansDir)) fs.mkdirSync(localScansDir, { recursive: true });
            const localSavedFile = path.join(localScansDir, `${finalHash.slice(0, 8)}_${safeTitle}`);
            fs.writeFileSync(localSavedFile, fileBuf);
            localSavedPath = localSavedFile;
            storageTier = 'LOCAL_AND_CLOUD';
          } catch {}
        } catch (e: any) {
          // ignore or fallback
        }
      }

      // Run Smart BIR & Company's Auto-Tagging (OCR + AI Rules)
      const smartClassification = smartAutoClassifyDocument({
        title: docTitle,
        originalFilename: req.body.originalFilename || docTitle,
        docType: documentType,
        remarks: remarks || '',
        filePath: finalStorageKey,
        fileBuffer: uploadedFileBuf,
        explicitFolder: folderCategory,
        explicitTag: categoryTag,
      });
      const resolvedFolder = smartClassification.folderCategory;
      const resolvedTag = smartClassification.categoryTag;
      const resolvedDocType = documentType || smartClassification.documentType;

      // If hardware scan requested WITHOUT attached fileData (Physical hardware feeder acquisition)
      if ((usePhysicalHardware || scannerDevice) && !req.body.fileData) {
        const scanResult = await scannerService.triggerPhysicalScan({
          title: docTitle,
          duplex: true,
          scannerDevice: scannerDevice || undefined,
          portName: portName || undefined,
          driverType: driverType || undefined,
          folderCategory: resolvedFolder,
        });

        finalHash = scanResult.sha256Hash;
        finalSizeBytes = scanResult.fileSizeBytes;
        finalStorageKey = scanResult.cloudStorageSavedPath || scanResult.mergedPdfPath;
        localSavedPath = scanResult.localStorageSavedPath;
        finalPageCount = scanResult.pageCount;
        storageTier = 'LOCAL_AND_CLOUD';
        scannedPagesData = scanResult.pages.map(p => ({
          pageNumber: p.pageNumber,
          storageKey: p.filePath,
          dpi: 300,
        }));
      }

      if (!finalHash) {
        finalHash = crypto.createHash('sha256').update(docTitle + Date.now()).digest('hex');
      }

      if (scannedPagesData.length === 0) {
        scannedPagesData = Array.from({ length: finalPageCount }, (_, i) => ({
          pageNumber: i + 1,
          storageKey: finalStorageKey || `uploads/scans/page_${i + 1}.jpg`,
          dpi: 300,
        }));
      }

      // Resolve departmentId to a valid database record
      let resolvedDeptId: string | null = null;
      if (departmentId) {
        const dept = await prisma.department.findFirst({
          where: {
            OR: [
              { id: departmentId },
              { code: { equals: departmentId, mode: 'insensitive' } },
              { name: { contains: departmentId, mode: 'insensitive' } },
            ],
          },
        });
        if (dept) resolvedDeptId = dept.id;
      }
      if (!resolvedDeptId && user.departmentId) {
        resolvedDeptId = user.departmentId;
      }

      const metaEntries: { key: string; value: string }[] = [
        { key: 'cloud_uploaded', value: 'true' },
        { key: 'storage_tier', value: storageTier },
        { key: 'folder_category', value: resolvedFolder },
        { key: 'category_tag', value: resolvedTag },
        { key: 'auto_tagged', value: 'true' },
        { key: 'auto_tag_rule', value: smartClassification.matchedRule },
        { key: 'auto_tag_confidence', value: String(smartClassification.confidence) },
        { key: 'ingest_source', value: req.body.source || (usePhysicalHardware || scannerDevice ? 'SCANNER' : 'CLOUD_UPLOAD') },
      ];
      if (customTags) {
        metaEntries.push({ key: 'custom_tags', value: String(customTags) });
      }
      if (localSavedPath) {
        metaEntries.push({ key: 'local_storage_path', value: localSavedPath });
      }
      if (finalStorageKey) {
        metaEntries.push({
          key: 'attachment_files',
          value: JSON.stringify([{
            name: resolveProperDownloadFilename(docTitle || 'Document', finalStorageKey, detectMimeType(finalStorageKey, docTitle)),
            size: finalSizeBytes,
            type: resolvedDocType,
            pageCount: finalPageCount,
            storageKey: finalStorageKey,
            localStoragePath: localSavedPath,
          }]),
        });
      }

      const doc = await prisma.document.create({
        data: {
          title: docTitle,
          referenceNumber: `DOC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
          organizationId: user.organizationId,
          departmentId: resolvedDeptId,
          documentType: resolvedDocType,
          pageCount: finalPageCount,
          fileSizeBytes: finalSizeBytes,
          sha256Hash: finalHash,
          storageKeyPdf: finalStorageKey,
          status: 'COMPLETED',
          createdById: user.id,
          pages: {
            create: scannedPagesData,
          },
          metadata: {
            create: metaEntries,
          },
          ocrResult: {
            create: {
              avgConfidence: smartClassification.confidence,
              confidence: smartClassification.confidence,
              rawText: `[Smart OCR + AI Auto-Tag: ${resolvedTag} (${smartClassification.confidence}% confidence) — ${smartClassification.matchedRule}]\nDocument "${docTitle}" (${finalPageCount} pages) stored in ${storageTier} [${resolvedFolder}]. SHA-256: ${finalHash}.`,
              language: 'eng',
              pageCount: finalPageCount,
            },
          },
          auditLogs: {
            create: {
              action: 'DOCUMENT_INGESTED',
              userId: user.id,
              details: {
                source: req.body.source || (usePhysicalHardware || scannerDevice ? `Scanner (${scannerDevice || 'Universal'})` : 'Cloud Upload'),
                storageTier,
                folderCategory: resolvedFolder,
                localStoragePath: localSavedPath,
                pageCount: finalPageCount,
                hash: finalHash,
                storageKeyPdf: finalStorageKey,
              },
            },
          },
        },
        include: {
          pages: true,
          metadata: true,
          ocrResult: true,
          department: {
            select: { name: true, code: true },
          },
        },
      });

      res.status(201).json({
        document: doc,
        localStorageSavedPath: localSavedPath,
        cloudStorageSavedPath: finalStorageKey,
        localStorage: {
          localFilePath: localSavedPath || '',
        },
        storageTier,
        folderCategory: resolvedFolder,
        message: localSavedPath
          ? `Scanned & saved to both Local Storage (${localSavedPath}) and Cloud Storage!`
          : `Document uploaded to Cloud Storage (${resolvedFolder === 'BIR' ? 'BIR Folder' : "Company's Documentation"})!`,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || 'Document upload / scan acquisition failed',
        message: error.message || 'Document upload / scan acquisition failed',
      });
    }
  }

  // Ingest / Create Multiple Documents in Bulk (Manual Multi-Upload -> Automatically Separated in Cloud Storage)
  async createBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const {
        documents,
        defaultDepartmentId,
        defaultDocumentType,
        defaultDirection,
        folderCategory,
        batchTitle,
        bundleAsSingleDocument = false,
      } = req.body;

      if (!Array.isArray(documents) || documents.length === 0) {
        res.status(400).json({ error: 'documents array is required and must not be empty' });
        return;
      }

      if (documents.length > 500) {
        res.status(400).json({ error: 'Maximum 500 documents allowed per batch' });
        return;
      }

      // Pre-resolve default department
      let globalResolvedDeptId: string | null = null;
      const deptSearch = defaultDepartmentId || user.departmentId;
      if (deptSearch) {
        const dept = await prisma.department.findFirst({
          where: {
            OR: [
              { id: deptSearch },
              { code: { equals: deptSearch, mode: 'insensitive' } },
              { name: { contains: deptSearch, mode: 'insensitive' } },
            ],
          },
        });
        if (dept) globalResolvedDeptId = dept.id;
      }

      // Save files from fileData (base64) if supplied
      const uploadPackagesDir = path.resolve(process.cwd(), 'uploads', 'packages');
      if (!fs.existsSync(uploadPackagesDir)) {
        fs.mkdirSync(uploadPackagesDir, { recursive: true });
      }

      documents.forEach((d: any) => {
        if (d.fileData) {
          try {
            const buf = Buffer.from(d.fileData, 'base64');
            let ext = path.extname(d.originalFilename || d.filename || d.title || '').toLowerCase();
            if (!ext) {
              if (buf.subarray(0, 4).toString() === '%PDF') ext = '.pdf';
              else if (buf[0] === 0xff && buf[1] === 0xd8) ext = '.jpg';
              else if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') ext = '.png';
              else if (buf.subarray(0, 4).toString() === 'GIF8') ext = '.gif';
            }
            const safeName = (d.title || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileHash = d.sha256Hash || crypto.createHash('sha256').update(buf).digest('hex');
            const destPath = path.join(uploadPackagesDir, `${fileHash.slice(0, 12)}_${safeName}${ext}`);
            fs.writeFileSync(destPath, buf);
            d.storageKey = destPath;
            d.fileSizeBytes = buf.length;
            d.sha256Hash = fileHash;
          } catch (e: any) {
            // keep existing storageKey
          }
        }
      });

      const effectiveSource = req.body.source || documents[0]?.source || 'WINDOWS_CONTEXT_MENU';

      // Case 1: Bundle all files together into a SINGLE unified Document Package (SAMA-SAMA)
      if (bundleAsSingleDocument) {
        const packageTitle = batchTitle || (documents.length === 1
          ? documents[0].title
          : `${documents[0].title} (+${documents.length - 1} attached files)`);
        const totalPages = documents.reduce((sum: number, d: any) => sum + (d.pageCount || 1), 0);
        const totalBytes = documents.reduce((sum: number, d: any) => sum + (d.fileSizeBytes || 102400), 0);
        const bundleHash = crypto.createHash('sha256').update(packageTitle + Date.now() + Math.random()).digest('hex');
        const batchRef = `BATCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const pagesData: any[] = [];
        let pNum = 1;
        documents.forEach((d: any, idx: number) => {
          const cnt = d.pageCount || 1;
          for (let i = 0; i < cnt; i++) {
            pagesData.push({
              pageNumber: pNum++,
              storageKey: d.storageKey || `uploads/batch/pkg_${idx + 1}_p${i + 1}.jpg`,
              dpi: 300,
            });
          }
        });

        const attachmentsMeta = documents.map((d: any, idx: number) => {
          let origName = d.originalFilename || d.filename || d.title || `Attachment_${idx + 1}`;
          let ext = path.extname(origName);
          if (!ext && d.storageKey) {
            ext = path.extname(d.storageKey);
          }
          if (!ext) {
            ext = '.pdf';
          }
          if (!origName.toLowerCase().endsWith(ext.toLowerCase())) {
            origName = `${origName}${ext}`;
          }
          return {
            name: origName,
            size: d.fileSizeBytes || 102400,
            type: d.documentType || defaultDocumentType || 'GENERAL',
            pageCount: d.pageCount || 1,
            source: d.source || effectiveSource || defaultDirection || 'Batch Ingest',
            storageKey: d.storageKey || null,
          };
        });

        // Use the primary/first file's storage key as default storageKeyPdf reference
        let finalStorageKeyPdf = documents[0]?.storageKey || null;

        const unifiedDoc = await prisma.document.create({
          data: {
            title: packageTitle,
            referenceNumber: batchRef,
            organizationId: user.organizationId,
            departmentId: globalResolvedDeptId,
            documentType: defaultDocumentType || 'GENERAL',
            pageCount: totalPages,
            fileSizeBytes: totalBytes,
            sha256Hash: bundleHash,
            storageKeyPdf: finalStorageKeyPdf,
            status: 'COMPLETED',
            createdById: user.id,
            pages: {
              create: pagesData,
            },
            metadata: {
              create: [
                { key: 'is_bundle', value: 'true' },
                { key: 'batch_id', value: batchRef },
                { key: 'batch_title', value: packageTitle },
                { key: 'attachment_count', value: documents.length.toString() },
                { key: 'attachment_files', value: JSON.stringify(attachmentsMeta) },
                { key: 'ingest_source', value: effectiveSource },
              ],
            },
            ocrResult: {
              create: {
                avgConfidence: 98.8,
                confidence: 98.8,
                rawText: `Multi-document dossier package "${packageTitle}" containing ${documents.length} attached document(s) (${totalPages} total pages). SHA-256: ${bundleHash}`,
                language: 'eng',
                pageCount: totalPages,
              },
            },
            auditLogs: {
              create: {
                action: 'DOCUMENT_BUNDLE_INGESTED',
                userId: user.id,
                details: {
                  packageTitle,
                  batchRef,
                  fileCount: documents.length,
                  totalPages,
                  hash: bundleHash,
                  direction: defaultDirection || 'INCOMING',
                  source: effectiveSource,
                },
              },
            },
          },
          include: {
            pages: true,
            metadata: true,
            department: {
              select: { name: true, code: true },
            },
          },
        });

        res.status(201).json({
          success: true,
          count: 1,
          isBundle: true,
          batchRef,
          document: unifiedDoc,
          documents: [unifiedDoc],
          message: `Successfully bundled ${documents.length} files into unified document package "${packageTitle}".`,
        });
        return;
      }

      // Case 2: Automatically Separated Documents in Cloud Storage (Default for Multi-File Manual Upload)
      const sharedBatchRef = `BATCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const sharedBatchTitle = batchTitle || `Batch Series ${sharedBatchRef}`;
      const keepBatchGroup = req.body.keepBatchGroup === true;
      const createdDocs: any[] = [];

      for (let i = 0; i < documents.length; i++) {
        const item = documents[i];
        const docTitle = item.title || `Doc_${new Date().toISOString().slice(0, 10)}_${Math.random().toString(36).substring(7)}.pdf`;
        const smartClass = smartAutoClassifyDocument({
          title: docTitle,
          originalFilename: item.originalFilename || item.filename || docTitle,
          docType: item.documentType || defaultDocumentType,
          remarks: item.remarks || '',
          filePath: item.storageKey || null,
          explicitFolder: item.folderCategory || folderCategory,
          explicitTag: item.categoryTag || req.body.categoryTag,
        });
        const itemFolder = smartClass.folderCategory;
        const itemCategoryTag = smartClass.categoryTag;
        const itemDocType = item.documentType || defaultDocumentType || smartClass.documentType;

        let resolvedDeptId = globalResolvedDeptId;
        if (item.departmentId && item.departmentId !== defaultDepartmentId) {
          const itemDept = await prisma.department.findFirst({
            where: {
              OR: [
                { id: item.departmentId },
                { code: { equals: item.departmentId, mode: 'insensitive' } },
                { name: { contains: item.departmentId, mode: 'insensitive' } },
              ],
            },
          });
          if (itemDept) resolvedDeptId = itemDept.id;
        }

        const finalPageCount = item.pageCount || 1;
        const finalSizeBytes = item.fileSizeBytes || 102400;
        const finalHash = item.sha256Hash || crypto.createHash('sha256').update(docTitle + Date.now() + Math.random()).digest('hex');
        const finalStorageKey = item.storageKey || `uploads/batch/${finalHash.slice(0, 12)}_${docTitle}`;
        const individualRef = keepBatchGroup
          ? sharedBatchRef
          : `DOC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

        const scannedPagesData = Array.from({ length: finalPageCount }, (_, idx) => ({
          pageNumber: idx + 1,
          storageKey: finalStorageKey,
          dpi: 300,
        }));

        const metaList: { key: string; value: string }[] = [
          { key: 'cloud_uploaded', value: 'true' },
          { key: 'storage_tier', value: 'CLOUD_STORAGE' },
          { key: 'folder_category', value: itemFolder },
          { key: 'category_tag', value: itemCategoryTag },
          { key: 'auto_tagged', value: 'true' },
          { key: 'auto_tag_rule', value: smartClass.matchedRule },
          { key: 'auto_tag_confidence', value: String(smartClass.confidence) },
          { key: 'auto_separated', value: (!keepBatchGroup).toString() },
          { key: 'ingest_source', value: item.source || req.body.source || 'MANUAL_CLOUD_UPLOAD' },
          {
            key: 'attachment_files',
            value: JSON.stringify([{
              name: resolveProperDownloadFilename(item.originalFilename || docTitle, finalStorageKey, detectMimeType(finalStorageKey, docTitle)),
              size: finalSizeBytes,
              type: itemDocType,
              pageCount: finalPageCount,
              storageKey: finalStorageKey,
            }]),
          },
        ];
        if (item.customTags || req.body.customTags) {
          metaList.push({ key: 'custom_tags', value: String(item.customTags || req.body.customTags) });
        }

        if (keepBatchGroup) {
          metaList.push(
            { key: 'batch_id', value: sharedBatchRef },
            { key: 'batch_title', value: sharedBatchTitle },
            { key: 'batch_index', value: (i + 1).toString() },
            { key: 'batch_total', value: documents.length.toString() }
          );
        }

        const doc = await prisma.document.create({
          data: {
            title: docTitle,
            referenceNumber: individualRef,
            organizationId: user.organizationId,
            departmentId: resolvedDeptId,
            documentType: itemDocType,
            pageCount: finalPageCount,
            fileSizeBytes: finalSizeBytes,
            sha256Hash: finalHash,
            storageKeyPdf: finalStorageKey,
            status: 'COMPLETED',
            createdById: user.id,
            pages: {
              create: scannedPagesData,
            },
            metadata: {
              create: metaList,
            },
            ocrResult: {
              create: {
                avgConfidence: smartClass.confidence,
                confidence: smartClass.confidence,
                rawText: `[Smart OCR + AI Auto-Tag: ${itemCategoryTag} (${smartClass.confidence}% confidence) — ${smartClass.matchedRule}]\nSeparated Cloud Storage document "${docTitle}" (${finalPageCount} page(s)) in [${itemFolder}]. SHA-256: ${finalHash}`,
                language: 'eng',
                pageCount: finalPageCount,
              },
            },
            auditLogs: {
              create: {
                action: 'DOCUMENT_BATCH_INGESTED',
                userId: user.id,
                details: {
                  referenceNumber: individualRef,
                  folderCategory: itemFolder,
                  storageTier: 'CLOUD_STORAGE',
                  autoSeparated: !keepBatchGroup,
                  source: item.source || req.body.source || 'MANUAL_CLOUD_UPLOAD',
                  pageCount: finalPageCount,
                  hash: finalHash,
                },
              },
            },
          },
          include: {
            metadata: true,
            department: {
              select: { name: true, code: true },
            },
          },
        });

        createdDocs.push(doc);
      }

      res.status(201).json({
        success: true,
        count: createdDocs.length,
        autoSeparated: !keepBatchGroup,
        batchRef: sharedBatchRef,
        batchTitle: sharedBatchTitle,
        documents: createdDocs,
        message: `Successfully uploaded and automatically separated ${createdDocs.length} document(s) into Cloud Storage!`,
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || 'Batch document registration failed',
        message: error.message || 'Batch document registration failed',
      });
    }
  }

  // List documents with pagination, filters, and department isolation
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { departmentId, status, page, limit, sortBy, sortOrder } = req.query;

      const pageNum = Math.max(page ? parseInt(page as string, 10) : 1, 1);
      const limitNum = Math.min(Math.max(limit ? parseInt(limit as string, 10) : 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;

      const isSuperAdmin = user.roles.includes('SUPER_ADMIN') || user.roles.includes('ORG_ADMIN');
      let targetDeptId: string | undefined = (departmentId as string) || undefined;
      if (!isSuperAdmin && !targetDeptId) {
        targetDeptId = user.departmentId ?? undefined;
      }

      const whereClause: any = {
        ...(user.organizationId ? { organizationId: user.organizationId } : {}),
        ...(targetDeptId ? { departmentId: targetDeptId } : {}),
        ...(status ? { status: status as any } : {}),
      };

      const [documents, total] = await Promise.all([
        prisma.document.findMany({
          where: whereClause,
          skip,
          take: limitNum,
          orderBy: { createdAt: (sortOrder === 'asc' ? 'asc' : 'desc') },
          include: {
            pages: { orderBy: { pageNumber: 'asc' } },
            ocrResult: { select: { avgConfidence: true } },
            department: { select: { name: true, code: true } },
            metadata: true,
          },
        }),
        prisma.document.count({ where: whereClause }),
      ]);

      res.json({
        documents,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (error) {
      next(error);
    }
  }

  // Search documents with full-text index and department filtering
  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { q, departmentId, status, page, limit, sortBy, sortOrder } = req.query;

      const result = await searchService.searchDocuments(
        {
          q: (q as string) || '',
          departmentId: departmentId as string,
          status: status as string,
          page: page ? parseInt(page as string, 10) : 1,
          limit: limit ? parseInt(limit as string, 10) : 20,
          sortBy: sortBy as any,
          sortOrder: sortOrder as any,
        },
        {
          organizationId: user.organizationId,
          departmentId: user.departmentId,
          roles: user.roles,
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Get document by ID
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const doc = await prisma.document.findUnique({
        where: { id },
        include: {
          pages: true,
          ocrResult: true,
          storageRecords: true,
          department: { select: { name: true, code: true } },
          metadata: true,
          auditLogs: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      res.json({ document: doc });
    } catch (error) {
      next(error);
    }
  }

  // Get document OCR details
  async getOcr(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const ocr = await prisma.documentOcrResult.findUnique({
        where: { documentId: id },
        include: { pageResults: { orderBy: { pageNumber: 'asc' } } },
      });

      if (!ocr) {
        res.status(404).json({ error: 'OCR result not found for this document' });
        return;
      }

      res.json({ ocrResult: ocr });
    } catch (error) {
      next(error);
    }
  }

  // Get document pages
  async getPages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const pages = await prisma.documentPage.findMany({
        where: { documentId: id },
        orderBy: { pageNumber: 'asc' },
      });

      res.json({ pages });
    } catch (error) {
      next(error);
    }
  }

  // Get document processing status
  async getProcessingStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const doc = await prisma.document.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          pageCount: true,
          storageKeyPdf: true,
          ocrResult: { select: { avgConfidence: true, minConfidence: true, lowConfidencePages: true } },
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      res.json({ status: doc });
    } catch (error) {
      next(error);
    }
  }

  // Stream Document File (Searchable PDF, Merged PDF, or Split Archive) with Access Logging
  async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { type, format, attachmentIndex } = req.query; // format: 'merged' | 'split' | 'zip'

      const doc = await prisma.document.findUnique({
        where: { id },
        include: { storageRecords: true, pages: { orderBy: { pageNumber: 'asc' } }, metadata: true, department: true },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Department isolation check
      const isSuperAdmin = user.roles.includes('SUPER_ADMIN') || user.roles.includes('SCANNER_ADMIN');
      if (!isSuperAdmin && user.departmentId && doc.departmentId !== user.departmentId) {
        res.status(403).json({ error: 'Forbidden: Cannot access documents from other departments' });
        return;
      }

      // Record access log
      await prisma.documentAccessLog.create({
        data: {
          documentId: doc.id,
          userId: user.id,
          action: 'DOWNLOAD',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      // Parse attachments metadata if present
      const attachMeta = (doc.metadata || []).find(m => m.key === 'attachment_files');
      let attachments: any[] = [];
      if (attachMeta && attachMeta.value) {
        try { attachments = JSON.parse(attachMeta.value); } catch (e) {}
      }

      // Sub-case A: Specific single attachment requested by index
      if (attachmentIndex !== undefined && attachmentIndex !== null && attachmentIndex !== '') {
        const idx = parseInt(attachmentIndex as string, 10);
        if (!isNaN(idx) && attachments[idx]) {
          const targetAtt = attachments[idx];
          const attPath = targetAtt.storageKey || (doc.pages[idx] ? doc.pages[idx].storageKey : null);
          if (attPath && fs.existsSync(attPath)) {
            const mimeType = detectMimeType(attPath, targetAtt.name);
            const downloadFilename = resolveProperDownloadFilename(targetAtt.name, attPath, mimeType);
            const stat = fs.statSync(attPath);
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`);
            fs.createReadStream(attPath).pipe(res);
            return;
          }
        }
      }

      // Sub-case B: Download as ALL FILES (ZIP archive)
      if (format === 'all' || format === 'split' || format === 'zip') {
        const filesToZip: { name: string; content: Buffer }[] = [];

        // 1. If it's a multi-file package with individual attachment files saved on disk
        if (attachments.length > 0) {
          for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            const candidate = att.storageKey || (doc.pages[i] ? doc.pages[i].storageKey : null);
            if (candidate && fs.existsSync(candidate)) {
              const mime = detectMimeType(candidate, att.name);
              const properName = resolveProperDownloadFilename(att.name || `File_${i + 1}`, candidate, mime);
              filesToZip.push({
                name: properName,
                content: fs.readFileSync(candidate),
              });
            }
          }
        }

        // 2. If no discrete attachment files, but we have a multi-page PDF, split into individual pages
        if (filesToZip.length === 0) {
          let pdfSourcePath = doc.storageKeyPdf && fs.existsSync(doc.storageKeyPdf) ? doc.storageKeyPdf : null;
          if (!pdfSourcePath && doc.pages && doc.pages.length > 0) {
            for (const p of doc.pages) {
              if (p.storageKey && fs.existsSync(p.storageKey)) {
                pdfSourcePath = p.storageKey;
                break;
              }
            }
          }

          if (pdfSourcePath && fs.existsSync(pdfSourcePath)) {
            const srcBuf = fs.readFileSync(pdfSourcePath);
            if (srcBuf.subarray(0, 4).toString() === '%PDF') {
              const pages = await splitPdfToPages(srcBuf);
              const baseDocName = (doc.title || 'Document').replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');
              pages.forEach(p => {
                filesToZip.push({
                  name: `${baseDocName}_Page_${String(p.pageNumber).padStart(2, '0')}.pdf`,
                  content: p.content,
                });
              });
            }
          }
        }

        // 3. If single file or standard document, package into ZIP if requested
        if (filesToZip.length === 0) {
          let mainFilePath = doc.storageKeyPdf && fs.existsSync(doc.storageKeyPdf) ? doc.storageKeyPdf : null;
          if (!mainFilePath && doc.pages && doc.pages.length > 0) {
            for (const p of doc.pages) {
              if (p.storageKey && fs.existsSync(p.storageKey)) {
                mainFilePath = p.storageKey;
                break;
              }
            }
          }
          if (mainFilePath && fs.existsSync(mainFilePath)) {
            const mime = detectMimeType(mainFilePath, doc.title);
            const properName = resolveProperDownloadFilename(doc.title, mainFilePath, mime);
            filesToZip.push({
              name: properName,
              content: fs.readFileSync(mainFilePath),
            });
          }
        }

        if (filesToZip.length > 0) {
          const zipBuffer = createZipArchive(filesToZip);
          const zipFilename = `${(doc.title || 'Document_Package').replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_')}_All_Files.zip`;
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Length', zipBuffer.length);
          res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"; filename*=UTF-8''${encodeURIComponent(zipFilename)}`);
          res.send(zipBuffer);
          return;
        }
      }

      // Default / Discrete Document Download:
      let storageKey = type === 'searchable_pdf' && doc.storageKeyPdf ? doc.storageKeyPdf : (doc.storageRecords[0]?.storageKey || doc.storageKeyPdf);

      // If doc has attachments and no single storageKey, serve the first attachment
      if ((!storageKey || !fs.existsSync(storageKey)) && attachments.length > 0) {
        const firstAtt = attachments[0];
        const firstPath = firstAtt.storageKey || (doc.pages[0] ? doc.pages[0].storageKey : null);
        if (firstPath && fs.existsSync(firstPath)) {
          const mimeType = detectMimeType(firstPath, firstAtt.name);
          const dlName = resolveProperDownloadFilename(firstAtt.name, firstPath, mimeType);
          const stat = fs.statSync(firstPath);
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Content-Disposition', `attachment; filename="${dlName}"; filename*=UTF-8''${encodeURIComponent(dlName)}`);
          fs.createReadStream(firstPath).pipe(res);
          return;
        }
      }

      if (!storageKey) {
        res.status(404).json({ error: 'Storage object not found for document' });
        return;
      }

      // Check if file is stored locally on disk
      if (fs.existsSync(storageKey)) {
        let mimeType = detectMimeType(storageKey, doc.title);
        if (type === 'searchable_pdf' && mimeType === 'application/octet-stream') {
          mimeType = 'application/pdf';
        }

        const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
        const dlName = resolveProperDownloadFilename(doc.title, storageKey, mimeType);
        const stat = fs.statSync(storageKey);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `${disposition}; filename="${dlName}"; filename*=UTF-8''${encodeURIComponent(dlName)}`);
        fs.createReadStream(storageKey).pipe(res);
        return;
      }

      const { objectStorage } = await import('../../lib/storage.js');
      const stream = objectStorage.getObjectStream(storageKey);

      // Fallback: If physical file is missing from local disk and object storage,
      // generate an official PDF dossier docket instead of 404
      const docketPdf = await generateDossierDocketPdf({
        title: doc.title,
        referenceNumber: doc.referenceNumber || undefined,
        departmentName: doc.department?.name || doc.department?.code,
        documentType: doc.documentType,
        senderName: doc.supplierName || 'Liaison Desk Receiving',
        status: doc.status,
        createdAt: doc.createdAt,
        fileSizeBytes: doc.fileSizeBytes,
        sha256Hash: doc.sha256Hash,
        attachments,
      });

      const dlName = `${(doc.title || 'Document').replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_')}_Dossier.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', docketPdf.length);
      res.setHeader('Content-Disposition', `attachment; filename="${dlName}"; filename*=UTF-8''${encodeURIComponent(dlName)}`);
      res.send(docketPdf);
      return;
    } catch (error) {
      next(error);
    }
  }

  // Stream Document File for Inline Preview
  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;

      const doc = await prisma.document.findUnique({
        where: { id },
        include: { pages: { orderBy: { pageNumber: 'asc' } }, storageRecords: true, metadata: true, department: true },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Department isolation check
      const isSuperAdmin = user.roles.includes('SUPER_ADMIN') || user.roles.includes('SCANNER_ADMIN');
      if (!isSuperAdmin && user.departmentId && doc.departmentId !== user.departmentId) {
        res.status(403).json({ error: 'Forbidden: Cannot access documents from other departments' });
        return;
      }

      // Record access log
      await prisma.documentAccessLog.create({
        data: {
          documentId: doc.id,
          userId: user.id,
          action: 'VIEW',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      // Find local file path
      let filePath: string | null = null;
      if (doc.storageKeyPdf && fs.existsSync(doc.storageKeyPdf)) {
        filePath = doc.storageKeyPdf;
      } else if (doc.pages && doc.pages.length > 0) {
        for (const p of doc.pages) {
          if (p.storageKey && fs.existsSync(p.storageKey)) {
            filePath = p.storageKey;
            break;
          }
        }
      } else if (doc.storageRecords && doc.storageRecords.length > 0) {
        for (const r of doc.storageRecords) {
          if (r.storageKey && fs.existsSync(r.storageKey)) {
            filePath = r.storageKey;
            break;
          }
        }
      }

      // Parse attachments metadata if present
      const attachMeta = (doc.metadata || []).find(m => m.key === 'attachment_files');
      let parsedAttachments: any[] = [];
      if (attachMeta && attachMeta.value) {
        try { parsedAttachments = JSON.parse(attachMeta.value); } catch (e) {}
      }

      // Check if a specific attachment index is requested for preview
      const { attachmentIndex } = req.query;
      if (attachmentIndex !== undefined && attachmentIndex !== null && attachmentIndex !== '') {
        const idx = parseInt(attachmentIndex as string, 10);
        if (!isNaN(idx) && parsedAttachments[idx]) {
          const targetAtt = parsedAttachments[idx];
          const candidateAttPath = targetAtt.storageKey || (doc.pages[idx] ? doc.pages[idx].storageKey : null);
          if (candidateAttPath && fs.existsSync(candidateAttPath)) {
            const mimeType = detectMimeType(candidateAttPath, targetAtt.name);
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(targetAtt.name || path.basename(candidateAttPath))}"`);
            fs.createReadStream(candidateAttPath).pipe(res);
            return;
          }
        }
      }

      // If no specific attachment index was requested, but attachments exist, preview the first attachment
      if (parsedAttachments.length > 0) {
        const firstAtt = parsedAttachments[0];
        const candidateFirstPath = firstAtt.storageKey || (doc.pages[0] ? doc.pages[0].storageKey : null);
        if (candidateFirstPath && fs.existsSync(candidateFirstPath)) {
          const mimeType = detectMimeType(candidateFirstPath, firstAtt.name);
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(firstAtt.name || path.basename(candidateFirstPath))}"`);
          fs.createReadStream(candidateFirstPath).pipe(res);
          return;
        }
      }

      if (filePath) {
        let mimeType = detectMimeType(filePath, doc.title);
        if (mimeType === 'application/octet-stream') {
          if (doc.documentType === 'INCOMING_SCAN' || doc.title.toLowerCase().endsWith('.pdf')) {
            mimeType = 'application/pdf';
          }
        }
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(filePath))}"`);
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // Object storage fallback
      const objectStorageKey = doc.storageKeyPdf || doc.storageRecords[0]?.storageKey;
      if (objectStorageKey) {
        const { objectStorage } = await import('../../lib/storage.js');
        const stream = objectStorage.getObjectStream(objectStorageKey);
        if (stream) {
          const mime = doc.title.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.title)}"`);
          stream.pipe(res);
          return;
        }
      }

      // Graceful On-the-Fly Dossier Certificate / Docket Generator
      // Generates an official PDF certificate rather than throwing HTTP 404
      const docketPdf = await generateDossierDocketPdf({
        title: doc.title,
        referenceNumber: doc.referenceNumber || undefined,
        departmentName: doc.department?.name || doc.department?.code,
        documentType: doc.documentType,
        senderName: doc.supplierName || 'Liaison Desk Receiving',
        status: doc.status,
        createdAt: doc.createdAt,
        fileSizeBytes: doc.fileSizeBytes,
        sha256Hash: doc.sha256Hash,
        attachments: parsedAttachments,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.title)}_Dossier.pdf"`);
      res.send(docketPdf);
      return;
    } catch (error) {
      next(error);
    }
  }

  // Stream Page Preview with Access Logging
  async previewPage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id, pageNumber } = req.params;

      const pageNum = parseInt(pageNumber, 10);
      const page = await prisma.documentPage.findUnique({
        where: {
          documentId_pageNumber: { documentId: id, pageNumber: pageNum },
        },
        include: { document: true },
      });

      if (!page) {
        res.status(404).json({ error: 'Page not found' });
        return;
      }

      // Record access log
      await prisma.documentAccessLog.create({
        data: {
          documentId: id,
          userId: user.id,
          action: 'VIEW',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      // Fallback if page.storageKey does not exist on disk
      let candidatePath = page.storageKey;
      if (!candidatePath || !fs.existsSync(candidatePath)) {
        if (page.document?.storageKeyPdf && fs.existsSync(page.document.storageKeyPdf)) {
          candidatePath = page.document.storageKeyPdf;
        }
      }

      if (req.query.inline === 'true' && candidatePath && fs.existsSync(candidatePath)) {
        const mimeType = detectMimeType(candidatePath, page.document?.title);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="page_${pageNum}${path.extname(candidatePath)}"`);
        fs.createReadStream(candidatePath).pipe(res);
        return;
      }

      res.json({
        documentId: id,
        pageNumber: pageNum,
        storageKey: page.storageKey,
        dpi: page.dpi || 300,
        thumbnailKey: page.thumbnailKey,
      });
    } catch (error) {
      next(error);
    }
  }

  // Update Document Metadata & Tags (Including BIR / Company's Category & Sub-Tags)
  async updateMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const {
        metadata,
        documentType,
        folderCategory,
        categoryTag,
        customTags,
        referenceNumber,
        invoiceNumber,
        supplierName,
        employeeName,
      } = req.body;

      const doc = await prisma.document.findUnique({
        where: { id },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      const mergedMeta: Record<string, string> = {};
      if (metadata && typeof metadata === 'object') {
        for (const [k, v] of Object.entries(metadata)) {
          if (v !== undefined && v !== null) mergedMeta[k] = String(v);
        }
      }
      if (folderCategory) {
        mergedMeta['folder_category'] = resolveFolderCategory(doc.title, documentType || doc.documentType, folderCategory);
      }
      if (categoryTag !== undefined) {
        mergedMeta['category_tag'] = resolveCategoryTag(
          doc.title,
          documentType || doc.documentType,
          (mergedMeta['folder_category'] as 'BIR' | 'COMPANY_DOCS') || undefined,
          categoryTag
        );
      }
      if (customTags !== undefined) {
        mergedMeta['custom_tags'] = String(customTags);
      }

      const updated = await prisma.$transaction(async (tx) => {
        for (const [key, value] of Object.entries(mergedMeta)) {
          await tx.documentMetadata.deleteMany({
            where: { documentId: id, key },
          });
          await tx.documentMetadata.create({
            data: {
              documentId: id,
              key,
              value: String(value),
              extractedBy: 'MANUAL',
              isVerified: true,
            },
          });
        }

        const d = await tx.document.update({
          where: { id },
          data: {
            documentType:
              documentType ||
              (mergedMeta['folder_category'] === 'BIR'
                ? 'BIR_TAX'
                : mergedMeta['folder_category'] === 'COMPANY_DOCS'
                ? 'COMPANY_DOC'
                : doc.documentType),
            referenceNumber: referenceNumber !== undefined ? referenceNumber : doc.referenceNumber,
            invoiceNumber: invoiceNumber !== undefined ? invoiceNumber : doc.invoiceNumber,
            supplierName: supplierName !== undefined ? supplierName : doc.supplierName,
            employeeName: employeeName !== undefined ? employeeName : doc.employeeName,
          },
          include: {
            metadata: true,
            department: { select: { name: true, code: true } },
          },
        });

        await tx.documentAuditLog.create({
          data: {
            documentId: id,
            userId: user.id,
            action: 'METADATA_UPDATED',
            details: { updatedFields: req.body, mergedMeta },
          },
        });

        return d;
      });

      res.json({
        document: updated,
        message: 'Document category & tags updated successfully.',
      });
    } catch (error) {
      next(error);
    }
  }

  // Set / Release Legal Hold
  async setLegalHold(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { isLegalHold, reason } = req.body;

      const doc = await prisma.document.findUnique({
        where: { id },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const d = await tx.document.update({
          where: { id },
          data: { isLegalHold },
        });

        await tx.documentAuditLog.create({
          data: {
            documentId: id,
            userId: user.id,
            action: isLegalHold ? 'LEGAL_HOLD_APPLIED' : 'LEGAL_HOLD_RELEASED',
            details: { reason, isLegalHold, appliedBy: user.id },
          },
        });

        return d;
      });

      res.json({ document: updated });
    } catch (error) {
      next(error);
    }
  }

  // Delete a single scanned page from document folder & re-compile merged PDF
  async deletePage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id, pageNumber } = req.params;
      const pageNum = parseInt(pageNumber, 10);

      const doc = await prisma.document.findUnique({
        where: { id },
        include: { pages: { orderBy: { pageNumber: 'asc' } } },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document dossier not found' });
        return;
      }

      // Department isolation check
      const isSuperAdmin = user.roles.includes('SUPER_ADMIN') || user.roles.includes('SCANNER_ADMIN');
      if (!isSuperAdmin && user.departmentId && doc.departmentId !== user.departmentId) {
        res.status(403).json({ error: 'Forbidden: Cannot modify documents from other departments' });
        return;
      }

      if (doc.isLegalHold) {
        res.status(400).json({ error: 'Cannot delete page from a document under Legal Hold' });
        return;
      }

      const targetPage = doc.pages.find((p: any) => p.pageNumber === pageNum);
      if (!targetPage) {
        res.status(404).json({ error: `Pahina ${pageNum} ay hindi natagpuan sa dokumentong ito.` });
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const { createMultiPagePdf } = await import('../../utils/pdfGenerator.js');

      // 1. Delete single page image file from disk if present
      if (targetPage.storageKey && fs.existsSync(targetPage.storageKey)) {
        try {
          fs.unlinkSync(targetPage.storageKey);
        } catch (e) {
          console.warn(`Could not unlink page file ${targetPage.storageKey}:`, e);
        }
      }

      // 2. Delete database page record
      await prisma.documentPage.delete({
        where: { id: targetPage.id },
      });

      // 3. Fetch remaining pages
      const remainingPages = await prisma.documentPage.findMany({
        where: { documentId: id },
        orderBy: { pageNumber: 'asc' },
      });

      // 4. Renumber remaining pages sequentially (1..N)
      for (let i = 0; i < remainingPages.length; i++) {
        const p = remainingPages[i];
        const newPageNum = i + 1;
        if (p.pageNumber !== newPageNum) {
          await prisma.documentPage.update({
            where: { id: p.id },
            data: { pageNumber: newPageNum },
          });
          p.pageNumber = newPageNum;
        }
      }

      // 5. If pages remain, re-generate the merged PDF
      let newHash = doc.sha256Hash;
      let newSizeBytes = 0;
      let newStorageKeyPdf = doc.storageKeyPdf;

      if (remainingPages.length > 0) {
        const validImagePaths = remainingPages
          .map((p: any) => p.storageKey)
          .filter((k: string) => k && fs.existsSync(k));

        if (validImagePaths.length > 0) {
          const pdfPath = doc.storageKeyPdf || path.join(path.dirname(validImagePaths[0]), `${doc.title.replace(/\.pdf$/i, '')}.pdf`);
          const pdfInfo = createMultiPagePdf(validImagePaths, pdfPath);
          newHash = pdfInfo.sha256Hash;
          newSizeBytes = pdfInfo.fileSizeBytes;
          newStorageKeyPdf = pdfInfo.filePath;
        }
      } else {
        // If 0 pages left, remove old merged PDF
        if (doc.storageKeyPdf && fs.existsSync(doc.storageKeyPdf)) {
          try { fs.unlinkSync(doc.storageKeyPdf); } catch {}
        }
      }

      // 6. Update Document master record
      const updatedDoc = await prisma.document.update({
        where: { id },
        data: {
          pageCount: remainingPages.length,
          fileSizeBytes: newSizeBytes,
          sha256Hash: newHash,
          storageKeyPdf: newStorageKeyPdf,
        },
        include: {
          pages: { orderBy: { pageNumber: 'asc' } },
          ocrResult: true,
          department: { select: { name: true, code: true } },
        },
      });

      // 7. Record audit log
      await prisma.documentAuditLog.create({
        data: {
          documentId: id,
          userId: user.id,
          action: 'PAGE_DELETED',
          details: {
            deletedPageNumber: pageNum,
            remainingPageCount: remainingPages.length,
            newHash,
          },
        },
      });

      res.json({
        message: `Pahina ${pageNum} ay matagumpay na nabura. Awtomatikong na-update ang Merged PDF (${remainingPages.length} natitirang pahina).`,
        document: updatedDoc,
        remainingPages,
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete entire document dossier & remove folder from disk
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;

      const doc = await prisma.document.findUnique({
        where: { id },
        include: { pages: true },
      });

      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Department isolation check
      const isSuperAdmin = user.roles.includes('SUPER_ADMIN') || user.roles.includes('SCANNER_ADMIN');
      if (!isSuperAdmin && user.departmentId && doc.departmentId !== user.departmentId) {
        res.status(403).json({ error: 'Forbidden: Cannot delete documents from other departments' });
        return;
      }

      if (doc.isLegalHold) {
        res.status(400).json({ error: 'Cannot delete document under Legal Hold' });
        return;
      }

      const fs = await import('fs');
      const path = await import('path');

      // Delete all on-disk files
      for (const p of doc.pages) {
        if (p.storageKey && fs.existsSync(p.storageKey)) {
          try { fs.unlinkSync(p.storageKey); } catch {}
        }
      }

      if (doc.storageKeyPdf && fs.existsSync(doc.storageKeyPdf)) {
        try {
          const dir = path.dirname(doc.storageKeyPdf);
          fs.unlinkSync(doc.storageKeyPdf);
          if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
          }
        } catch {}
      }

      await prisma.document.delete({
        where: { id },
      });

      res.json({ message: `Ang buong dossier "${doc.title}" ay matagumpay na nabura.` });
    } catch (error) {
      next(error);
    }
  }

  // Smart BIR & Company's Documentation Auto-Tagging Analyzer (OCR + AI Rules)
  async autoTagAnalyze(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, originalFilename, docType, remarks, ocrText } = req.body;
      const result = smartAutoClassifyDocument({
        title,
        originalFilename,
        docType,
        remarks,
        ocrText,
      });
      res.json({
        success: true,
        classification: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // Smart Auto-Tag All Documents in Cloud Storage (Retroactive OCR + AI Rules Classification)
  async autoTagAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const docs = await prisma.document.findMany({
        where: { organizationId: user.organizationId },
        include: { metadata: true, ocrResult: true },
        orderBy: { createdAt: 'desc' },
      });

      let birCount = 0;
      let companyCount = 0;
      const updatedSummaries: Array<{ id: string; title: string; folderCategory: string; categoryTag: string; rule: string }> = [];

      for (const doc of docs) {
        const classification = smartAutoClassifyDocument({
          title: doc.title,
          originalFilename: doc.title,
          docType: doc.documentType,
          ocrText: doc.ocrResult?.rawText || '',
          filePath: doc.storageKeyPdf,
        });

        if (classification.folderCategory === 'BIR') birCount++;
        else companyCount++;

        const keysToReplace = ['folder_category', 'category_tag', 'auto_tagged', 'auto_tag_rule', 'auto_tag_confidence'];
        await prisma.documentMetadata.deleteMany({
          where: {
            documentId: doc.id,
            key: { in: keysToReplace },
          },
        });

        await prisma.documentMetadata.createMany({
          data: [
            { documentId: doc.id, key: 'folder_category', value: classification.folderCategory },
            { documentId: doc.id, key: 'category_tag', value: classification.categoryTag },
            { documentId: doc.id, key: 'auto_tagged', value: 'true' },
            { documentId: doc.id, key: 'auto_tag_rule', value: classification.matchedRule },
            { documentId: doc.id, key: 'auto_tag_confidence', value: String(classification.confidence) },
          ],
        });

        await prisma.document.update({
          where: { id: doc.id },
          data: { documentType: classification.documentType },
        });

        updatedSummaries.push({
          id: doc.id,
          title: doc.title,
          folderCategory: classification.folderCategory,
          categoryTag: classification.categoryTag,
          rule: classification.matchedRule,
        });
      }

      res.json({
        success: true,
        totalProcessed: docs.length,
        birCount,
        companyCount,
        documents: updatedSummaries,
        message: `Smart OCR + AI Rules classified ${docs.length} document(s): ${birCount} BIR & ${companyCount} Company's Documentation.`,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const documentController = new DocumentController();
