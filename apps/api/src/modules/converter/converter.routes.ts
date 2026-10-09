import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createZipArchive, splitPdfToPages, generateDossierDocketPdf } from '../../lib/pdfMergeSplit.js';
import { resolveFolderCategory } from '../documents/document.controller.js';

export const converterRouter = Router();

/**
 * Helper: Load a document buffer from Cloud Storage by documentId, or generate its PDF if metadata-only
 */
async function loadCloudDocumentBuffer(docId: string): Promise<{
  buffer: Buffer;
  title: string;
  fileName: string;
  doc: any;
}> {
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    include: { pages: true, metadata: true, department: true },
  });
  if (!doc) {
    throw { statusCode: 404, message: `Cloud Storage document (${docId}) not found.` };
  }

  if (doc.storageKeyPdf && fs.existsSync(doc.storageKeyPdf)) {
    return {
      buffer: fs.readFileSync(doc.storageKeyPdf),
      title: doc.title,
      fileName: path.basename(doc.storageKeyPdf),
      doc,
    };
  }

  if (doc.pages && doc.pages.length > 0) {
    const p0 = doc.pages[0].storageKey;
    if (p0 && fs.existsSync(p0)) {
      return {
        buffer: fs.readFileSync(p0),
        title: doc.title,
        fileName: path.basename(p0),
        doc,
      };
    }
  }

  const generated = await generateDossierDocketPdf({
    title: doc.title,
    referenceNumber: doc.referenceNumber || doc.id.slice(0, 8),
    departmentName: doc.department?.name || 'Cloud Storage',
    documentType: doc.documentType,
    status: doc.status,
    createdAt: doc.createdAt,
    fileSizeBytes: Number(doc.fileSizeBytes || 0),
    sha256Hash: doc.sha256Hash,
  });

  return {
    buffer: generated,
    title: doc.title,
    fileName: `${(doc.title || 'Document').replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`,
    doc,
  };
}

/**
 * Helper: Convert any buffer (PDF, JPG, PNG, TXT/CSV/HTML/Word text) into a valid PDFDocument
 */
async function bufferToPdfDoc(buf: Buffer, fallbackTitle = 'Converted Document'): Promise<PDFDocument> {
  // 1. Already a PDF?
  if (buf.subarray(0, 4).toString() === '%PDF') {
    try {
      return await PDFDocument.load(buf, { ignoreEncryption: true });
    } catch {}
  }

  const pdfDoc = await PDFDocument.create();

  // 2. JPEG image?
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    try {
      const img = await pdfDoc.embedJpg(buf);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      return pdfDoc;
    } catch {}
  }

  // 3. PNG image?
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') {
    try {
      const img = await pdfDoc.embedPng(buf);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      return pdfDoc;
    } catch {}
  }

  // 4. Text / CSV / HTML / Office Content -> Render formatted A4 PDF pages
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let rawText = buf.toString('utf-8');
  // Strip binary control characters if converting from binary docx/xlsx container
  rawText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
  const lines = rawText.split(/\r?\n/);

  let page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  let y = height - 55;

  page.drawText(`DCC CONVERTER AGENT — ${fallbackTitle.slice(0, 60)}`, {
    x: 45,
    y,
    size: 12,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  y -= 24;

  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/[^\x20-\x7E]/g, ' ').trimEnd();
    const chunks = cleanLine.match(/.{1,85}/g) || [''];
    for (const chunk of chunks) {
      if (y < 50) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = height - 50;
      }
      page.drawText(chunk, {
        x: 45,
        y,
        size: 9.5,
        font,
        color: rgb(0.15, 0.2, 0.28),
      });
      y -= 14;
    }
  }

  return pdfDoc;
}

/**
 * Helper: Save a generated buffer as a new Cloud Storage Document record
 */
async function saveBufferToCloudStorage(params: {
  buffer: Buffer;
  title: string;
  fileName: string;
  folderCategory?: 'BIR' | 'COMPANY_DOCS';
  pageCount?: number;
  user: any;
  agentAction: string;
}) {
  const { buffer, title, fileName, folderCategory, pageCount = 1, user, agentAction } = params;
  const uploadDir = path.resolve(process.cwd(), 'uploads', 'documents');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destFile = path.join(uploadDir, `${sha256Hash.slice(0, 12)}_${safeName}`);
  fs.writeFileSync(destFile, buffer);

  const resolvedFolder = resolveFolderCategory(title, agentAction, folderCategory);

  const doc = await prisma.document.create({
    data: {
      title,
      referenceNumber: `DOC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
      organizationId: user.organizationId,
      departmentId: user.departmentId || null,
      documentType: resolvedFolder === 'BIR' ? 'BIR_TAX' : 'COMPANY_DOC',
      pageCount,
      fileSizeBytes: buffer.length,
      sha256Hash,
      storageKeyPdf: destFile,
      status: 'COMPLETED',
      createdById: user.id,
      pages: {
        create: Array.from({ length: pageCount }, (_, idx) => ({
          pageNumber: idx + 1,
          storageKey: destFile,
          dpi: 300,
        })),
      },
      metadata: {
        create: [
          { key: 'cloud_uploaded', value: 'true' },
          { key: 'storage_tier', value: 'CLOUD_STORAGE' },
          { key: 'folder_category', value: resolvedFolder },
          { key: 'ingest_source', value: `CONVERTER_AGENT_${agentAction}` },
          {
            key: 'attachment_files',
            value: JSON.stringify([
              {
                name: safeName,
                size: buffer.length,
                type: resolvedFolder,
                pageCount,
                storageKey: destFile,
              },
            ]),
          },
        ],
      },
    },
    include: {
      metadata: true,
      department: { select: { name: true, code: true } },
    },
  });

  return doc;
}

// ============================================================================
// 1. FORMAT CONVERTER AGENT: POST /api/v1/converter/convert
// ============================================================================
converterRouter.post('/convert', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const {
      cloudDocumentId,
      fileData,
      fileName,
      targetFormat = 'PDF',
      saveToCloud = true,
      folderCategory,
    } = req.body;

    let inputBuffer: Buffer;
    let baseTitle = 'Converted_Document';
    let origName = fileName || 'document.bin';

    if (cloudDocumentId) {
      const loaded = await loadCloudDocumentBuffer(cloudDocumentId);
      inputBuffer = loaded.buffer;
      baseTitle = loaded.title;
      origName = loaded.fileName;
    } else if (fileData) {
      inputBuffer = Buffer.from(fileData, 'base64');
      baseTitle = (fileName || 'Document').replace(/\.[^/.]+$/, '');
    } else {
      res.status(400).json({ success: false, error: 'Provide either cloudDocumentId or fileData to convert.' });
      return;
    }

    const fmt = String(targetFormat).toUpperCase();
    let outputBuffer: Buffer;
    let outputExt = '.pdf';
    let mimeType = 'application/pdf';
    let pageCount = 1;

    if (fmt === 'PDF') {
      const pdfDoc = await bufferToPdfDoc(inputBuffer, baseTitle);
      pageCount = pdfDoc.getPageCount();
      outputBuffer = Buffer.from(await pdfDoc.save());
      outputExt = '.pdf';
      mimeType = 'application/pdf';
    } else if (fmt === 'TXT' || fmt === 'TEXT') {
      let textContent = '';
      if (inputBuffer.subarray(0, 4).toString() === '%PDF') {
        const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true }).catch(() => null);
        const count = pdfDoc ? pdfDoc.getPageCount() : 1;
        textContent = `DCC CONVERTER AGENT — EXTRACTED TEXT REPORT\nDocument: ${baseTitle}\nSource File: ${origName}\nTotal Pages: ${count}\nTimestamp: ${new Date().toISOString()}\nSHA-256: ${crypto.createHash('sha256').update(inputBuffer).digest('hex')}\n\n--- CONTENT STREAM ---\n`;
        const printable = inputBuffer
          .toString('latin1')
          .replace(/[^\x20-\x7E\r\n]/g, ' ')
          .replace(/\s{3,}/g, '\n')
          .slice(0, 8000);
        textContent += printable;
      } else {
        textContent = inputBuffer.toString('utf-8');
      }
      outputBuffer = Buffer.from(textContent, 'utf-8');
      outputExt = '.txt';
      mimeType = 'text/plain; charset=utf-8';
    } else if (fmt === 'CSV') {
      const lines = inputBuffer
        .toString('utf-8')
        .replace(/[\x00-\x08\x0E-\x1F]/g, '')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(0, 500);
      const csvRows = ['"Line","Content"', ...lines.map((l, i) => `"${i + 1}","${l.replace(/"/g, '""')}"`)];
      outputBuffer = Buffer.from(csvRows.join('\n'), 'utf-8');
      outputExt = '.csv';
      mimeType = 'text/csv; charset=utf-8';
    } else if (fmt === 'ZIP') {
      outputBuffer = createZipArchive([{ name: origName, content: inputBuffer }]);
      outputExt = '.zip';
      mimeType = 'application/zip';
    } else {
      const pdfDoc = await bufferToPdfDoc(inputBuffer, baseTitle);
      pageCount = pdfDoc.getPageCount();
      outputBuffer = Buffer.from(await pdfDoc.save());
      outputExt = '.pdf';
      mimeType = 'application/pdf';
    }

    const outputTitle = `${baseTitle} [Converted to ${fmt}]`;
    const outputFileName = `${baseTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}_converted${outputExt}`;

    let savedCloudDoc: any = null;
    if (saveToCloud) {
      savedCloudDoc = await saveBufferToCloudStorage({
        buffer: outputBuffer,
        title: outputTitle,
        fileName: outputFileName,
        folderCategory,
        pageCount,
        user,
        agentAction: `CONVERT_${fmt}`,
      });
    }

    res.json({
      success: true,
      message: `Converted "${baseTitle}" to ${fmt} (${(outputBuffer.length / 1024).toFixed(1)} KB)${savedCloudDoc ? ' and saved to Cloud Storage!' : '!'}`,
      outputFileName,
      mimeType,
      sizeBytes: outputBuffer.length,
      pageCount,
      base64Data: outputBuffer.toString('base64'),
      cloudDocument: savedCloudDoc,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 2. MERGE DOCUMENTS AGENT: POST /api/v1/converter/merge
// ============================================================================
converterRouter.post('/merge', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const {
      cloudDocumentIds = [],
      files = [],
      mergedTitle = 'Merged_Document_Bundle',
      saveToCloud = true,
      folderCategory,
    } = req.body;

    if ((!Array.isArray(cloudDocumentIds) || cloudDocumentIds.length === 0) && (!Array.isArray(files) || files.length === 0)) {
      res.status(400).json({
        success: false,
        error: 'Select at least 2 documents from Cloud Storage or upload files to merge.',
      });
      return;
    }

    const masterPdf = await PDFDocument.create();
    let totalPagesAdded = 0;

    // 1. Append selected Cloud Storage documents
    for (const docId of cloudDocumentIds) {
      const loaded = await loadCloudDocumentBuffer(docId);
      const srcPdf = await bufferToPdfDoc(loaded.buffer, loaded.title);
      const indices = srcPdf.getPageIndices();
      const copied = await masterPdf.copyPages(srcPdf, indices);
      copied.forEach((p) => masterPdf.addPage(p));
      totalPagesAdded += copied.length;
    }

    // 2. Append uploaded files
    for (const f of files) {
      if (!f.fileData) continue;
      const buf = Buffer.from(f.fileData, 'base64');
      const srcPdf = await bufferToPdfDoc(buf, f.fileName || 'Uploaded Part');
      const indices = srcPdf.getPageIndices();
      const copied = await masterPdf.copyPages(srcPdf, indices);
      copied.forEach((p) => masterPdf.addPage(p));
      totalPagesAdded += copied.length;
    }

    const mergedBytes = Buffer.from(await masterPdf.save());
    const cleanTitle = mergedTitle.trim() || `Merged_Document_${new Date().toISOString().slice(0, 10)}`;
    const outputFileName = `${cleanTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;

    let savedCloudDoc: any = null;
    if (saveToCloud) {
      savedCloudDoc = await saveBufferToCloudStorage({
        buffer: mergedBytes,
        title: cleanTitle,
        fileName: outputFileName,
        folderCategory,
        pageCount: totalPagesAdded,
        user,
        agentAction: 'MERGED_PDF',
      });
    }

    res.json({
      success: true,
      message: `Merged ${cloudDocumentIds.length + files.length} files (${totalPagesAdded} total pages) into "${outputFileName}"${savedCloudDoc ? ' and saved to Cloud Storage!' : '!'}`,
      outputFileName,
      mimeType: 'application/pdf',
      pageCount: totalPagesAdded,
      sizeBytes: mergedBytes.length,
      base64Data: mergedBytes.toString('base64'),
      cloudDocument: savedCloudDoc,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 3. DETACH / SPLIT PAGES AGENT: POST /api/v1/converter/detach
// ============================================================================
converterRouter.post('/detach', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const {
      cloudDocumentId,
      fileData,
      fileName,
      pageRange = 'ALL',
      saveSeparatedToCloud = true,
      folderCategory,
    } = req.body;

    let sourceBuffer: Buffer;
    let baseTitle = 'Document';

    if (cloudDocumentId) {
      const loaded = await loadCloudDocumentBuffer(cloudDocumentId);
      sourceBuffer = loaded.buffer;
      baseTitle = loaded.title;
    } else if (fileData) {
      sourceBuffer = Buffer.from(fileData, 'base64');
      baseTitle = (fileName || 'Document').replace(/\.[^/.]+$/, '');
    } else {
      res.status(400).json({ success: false, error: 'Select a Cloud Storage document or upload a PDF to detach/split.' });
      return;
    }

    const srcPdf = await bufferToPdfDoc(sourceBuffer, baseTitle);
    const totalPages = srcPdf.getPageCount();

    // Parse pageRange: "ALL" -> every page detached separately; or e.g. "1, 2-3"
    const detachedParts: { label: string; fileName: string; pageNumbers: number[]; buffer: Buffer }[] = [];

    const normRange = String(pageRange || 'ALL').trim().toUpperCase();
    if (normRange === 'ALL' || normRange === '') {
      for (let i = 0; i < totalPages; i++) {
        const singlePdf = await PDFDocument.create();
        const [copied] = await singlePdf.copyPages(srcPdf, [i]);
        singlePdf.addPage(copied);
        const bytes = Buffer.from(await singlePdf.save());
        detachedParts.push({
          label: `${baseTitle} - Page ${i + 1}`,
          fileName: `${baseTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}_Page_${i + 1}.pdf`,
          pageNumbers: [i + 1],
          buffer: bytes,
        });
      }
    } else {
      // Parse comma-separated segments e.g. "1, 2-4, 5"
      const segments = normRange.split(',').map((s) => s.trim()).filter(Boolean);
      for (const seg of segments) {
        if (seg.includes('-')) {
          const [startStr, endStr] = seg.split('-');
          const start = Math.max(1, parseInt(startStr, 10) || 1);
          const end = Math.min(totalPages, parseInt(endStr, 10) || totalPages);
          const indices: number[] = [];
          for (let p = start; p <= end; p++) indices.push(p - 1);
          if (indices.length > 0) {
            const partPdf = await PDFDocument.create();
            const copied = await partPdf.copyPages(srcPdf, indices);
            copied.forEach((p) => partPdf.addPage(p));
            const bytes = Buffer.from(await partPdf.save());
            detachedParts.push({
              label: `${baseTitle} - Pages ${start}-${end}`,
              fileName: `${baseTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}_Pages_${start}-${end}.pdf`,
              pageNumbers: indices.map((idx) => idx + 1),
              buffer: bytes,
            });
          }
        } else {
          const pNum = Math.min(totalPages, Math.max(1, parseInt(seg, 10) || 1));
          const partPdf = await PDFDocument.create();
          const [copied] = await partPdf.copyPages(srcPdf, [pNum - 1]);
          partPdf.addPage(copied);
          const bytes = Buffer.from(await partPdf.save());
          detachedParts.push({
            label: `${baseTitle} - Page ${pNum}`,
            fileName: `${baseTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}_Page_${pNum}.pdf`,
            pageNumbers: [pNum],
            buffer: bytes,
          });
        }
      }
    }

    if (detachedParts.length === 0) {
      res.status(400).json({ success: false, error: `No valid pages matched range "${pageRange}" (Document has ${totalPages} page(s)).` });
      return;
    }

    const createdCloudDocs: any[] = [];
    if (saveSeparatedToCloud) {
      for (const part of detachedParts) {
        const doc = await saveBufferToCloudStorage({
          buffer: part.buffer,
          title: part.label,
          fileName: part.fileName,
          folderCategory,
          pageCount: part.pageNumbers.length,
          user,
          agentAction: 'DETACHED_PAGE',
        });
        createdCloudDocs.push(doc);
      }
    }

    // If 1 part detached, return the PDF directly; if multiple parts, return a ZIP archive of all detached PDFs
    let downloadBuffer: Buffer;
    let downloadFileName: string;
    let downloadMimeType: string;

    if (detachedParts.length === 1) {
      downloadBuffer = detachedParts[0].buffer;
      downloadFileName = detachedParts[0].fileName;
      downloadMimeType = 'application/pdf';
    } else {
      downloadBuffer = createZipArchive(
        detachedParts.map((p) => ({ name: p.fileName, content: p.buffer }))
      );
      downloadFileName = `${baseTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}_Detached_${detachedParts.length}_Files.zip`;
      downloadMimeType = 'application/zip';
    }

    res.json({
      success: true,
      message: `Detached ${detachedParts.length} document file(s) from "${baseTitle}" (${totalPages} source pages)${createdCloudDocs.length > 0 ? ` and saved ${createdCloudDocs.length} separated document(s) to Cloud Storage!` : '!'}`,
      sourceTotalPages: totalPages,
      detachedCount: detachedParts.length,
      outputFileName: downloadFileName,
      mimeType: downloadMimeType,
      sizeBytes: downloadBuffer.length,
      base64Data: downloadBuffer.toString('base64'),
      cloudDocuments: createdCloudDocs,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 4. WINDOWS UPLOADER INSTALLER DOWNLOAD: GET /api/v1/converter/windows-uploader-download
// ============================================================================
converterRouter.get('/windows-uploader-download', (req: Request, res: Response, next: NextFunction) => {
  try {
    const serverOrigin = `${req.protocol}://${req.get('host')}`;
    const filesToZip: { name: string; content: Buffer }[] = [];

    const psWindowPath = path.resolve(process.cwd(), 'agents', 'windows-uploader', 'DccUploadWindow.ps1');
    const cliPath = path.resolve(process.cwd(), 'agents', 'windows-uploader', 'dcc-upload-cli.mjs');
    const icoPath = path.resolve(process.cwd(), 'scripts', 'dcc.ico');
    const ctxInstallPath = path.resolve(process.cwd(), 'scripts', 'install-context-menu.ps1');
    const ctxUninstallPath = path.resolve(process.cwd(), 'scripts', 'uninstall-context-menu.ps1');
    const hotkeyDaemonPath = path.resolve(process.cwd(), 'scripts', 'RMS-HotKey-Daemon.ps1');
    const launcherPath = path.resolve(process.cwd(), 'scripts', 'dcc-upload-launcher.ps1');
    const batInstallPath = path.resolve(process.cwd(), 'scripts', 'Install-RMS-ContextMenu-And-HotKey.bat');
    const batHotkeyPath = path.resolve(process.cwd(), 'scripts', 'Start-RMS-HotKey.bat');

    if (fs.existsSync(psWindowPath)) {
      filesToZip.push({ name: 'DccUploadWindow.ps1', content: fs.readFileSync(psWindowPath) });
    }
    if (fs.existsSync(cliPath)) {
      filesToZip.push({ name: 'dcc-upload-cli.mjs', content: fs.readFileSync(cliPath) });
    }
    if (fs.existsSync(icoPath)) {
      filesToZip.push({ name: 'dcc.ico', content: fs.readFileSync(icoPath) });
    }
    if (fs.existsSync(ctxInstallPath)) {
      filesToZip.push({ name: 'install-context-menu.ps1', content: fs.readFileSync(ctxInstallPath) });
    }
    if (fs.existsSync(ctxUninstallPath)) {
      filesToZip.push({ name: 'uninstall-context-menu.ps1', content: fs.readFileSync(ctxUninstallPath) });
    }
    if (fs.existsSync(hotkeyDaemonPath)) {
      filesToZip.push({ name: 'RMS-HotKey-Daemon.ps1', content: fs.readFileSync(hotkeyDaemonPath) });
    }
    if (fs.existsSync(launcherPath)) {
      filesToZip.push({ name: 'dcc-upload-launcher.ps1', content: fs.readFileSync(launcherPath) });
    }
    if (fs.existsSync(batInstallPath)) {
      filesToZip.push({ name: 'Install-RMS-ContextMenu-And-HotKey.bat', content: fs.readFileSync(batInstallPath) });
    }
    if (fs.existsSync(batHotkeyPath)) {
      filesToZip.push({ name: 'Start-RMS-HotKey.bat', content: fs.readFileSync(batHotkeyPath) });
    }

    const batchLauncher = `@echo off
title Records Management Section - Windows Cloud Uploader
echo ========================================================
echo   RECORDS MANAGEMENT SECTION (RMS) - CLOUD UPLOADER v3
echo   Target Cloud Endpoint: ${serverOrigin}
echo ========================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0DccUploadWindow.ps1"
pause
`;
    filesToZip.push({ name: 'Launch-RMS-Cloud-Uploader.bat', content: Buffer.from(batchLauncher, 'utf-8') });

    const readmeTxt = `RECORDS MANAGEMENT SECTION (RMS) — RENEWED WINDOWS CLOUD UPLOADER v3.0
========================================================================
Target Cloud Endpoint: ${serverOrigin}
Storage Pipeline: Local Storage (C:\\DCC-LocalStorage or PC) -> Cloud Storage (BIR & Company's Documentation)

NEW FEATURES:
1. RIGHT-CLICK CONTEXT MENU:
   - Select any file, multiple documents, or folder in Windows Explorer or Local Storage.
   - Right-click and choose "Upload to Cloud Storage (Records Management Section)".
   - Or Right-click -> "Send to" -> "Upload to Cloud Storage (RMS)".

2. GLOBAL KEYBOARD SHORTCUT KEY (Ctrl+Shift+U):
   - Select any documents in Windows Explorer and press Ctrl+Shift+U!
   - Selected files are immediately sent from Local Storage directly to Cloud Storage.

1-CLICK INSTALLATION:
1. Double-click "Install-RMS-ContextMenu-And-HotKey.bat" (Run as Administrator or standard user).
2. The installer automatically registers the Windows Explorer Right-Click context menu,
   configures the SendTo shortcut, and starts the Ctrl+Shift+U hotkey daemon in the background!
3. To test immediately:
   - Go to any local folder (e.g. C:\\DCC-LocalStorage), select a PDF/document, and press Ctrl+Shift+U,
     OR right-click and choose "Upload to Cloud Storage (Records Management Section)".
`;
    filesToZip.push({ name: 'README-WINDOWS-UPLOADER.txt', content: Buffer.from(readmeTxt, 'utf-8') });

    const zipBuffer = createZipArchive(filesToZip);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('Content-Disposition', 'attachment; filename="RMS-Windows-Cloud-Uploader-Setup-v3.zip"');
    res.send(zipBuffer);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 5. WHATSAPP & TELEGRAM SEND / DISPATCH: POST /api/v1/converter/share
// ============================================================================
converterRouter.post('/share', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const {
      documentId,
      channel, // 'WHATSAPP' | 'TELEGRAM'
      recipient,
      message,
    } = req.body;

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { metadata: true },
    });

    if (!doc) {
      res.status(404).json({ success: false, error: 'Document not found in Cloud Storage.' });
      return;
    }

    const serverOrigin = `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${serverOrigin}/api/v1/documents/${doc.id}/download`;
    const folderCat = doc.metadata?.find((m) => m.key === 'folder_category')?.value || 'COMPANY_DOCS';
    const defaultText =
      message ||
      `📄 *DCC Cloud Document*\n• Title: ${doc.title}\n• Ref: ${doc.referenceNumber || doc.id.slice(0, 8)}\n• Folder: ${folderCat === 'BIR' ? 'BIR' : "Company's Documentation"}\n• Download Link: ${downloadUrl}`;

    const cleanPhone = String(recipient || '').replace(/[^0-9]/g, '');
    const whatsappUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(defaultText)}`
      : `https://wa.me/?text=${encodeURIComponent(defaultText)}`;

    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(downloadUrl)}&text=${encodeURIComponent(defaultText)}`;

    await prisma.documentAuditLog.create({
      data: {
        documentId: doc.id,
        userId: user.id,
        action: `SHARED_VIA_${String(channel || 'MESSENGER').toUpperCase()}`,
        details: {
          channel,
          recipient: recipient || 'Direct Share Link',
          downloadUrl,
        },
      },
    }).catch(() => {});

    res.json({
      success: true,
      channel,
      whatsappUrl,
      telegramUrl,
      downloadUrl,
      message: `Prepared ${channel} dispatch for "${doc.title}".`,
    });
  } catch (err) {
    next(err);
  }
});
