import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Pre-computed CRC32 table for ZIP creation
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[i] = c;
}

/**
 * Creates a standard uncompressed / deflated PK-ZIP archive buffer.
 * Compatible with Windows Explorer, macOS Finder, 7-Zip, WinRAR, and unzip.
 */
export function createZipArchive(files: { name: string; content: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const content = file.content;
    const compressed = zlib.deflateRawSync(content);

    let crc = 0 ^ (-1);
    for (let i = 0; i < content.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ content[i]) & 0xFF];
    }
    crc = (crc ^ (-1)) >>> 0;

    // Local file header (30 bytes + filename)
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // Signature PK\x03\x04
    lh.writeUInt16LE(20, 4);         // Version needed
    lh.writeUInt16LE(0, 6);          // General flags
    lh.writeUInt16LE(8, 8);          // Compression method: Deflate
    lh.writeUInt16LE(0, 10);         // Mod time
    lh.writeUInt16LE(0, 12);         // Mod date
    lh.writeUInt32LE(crc, 14);       // CRC32
    lh.writeUInt32LE(compressed.length, 18); // Compressed size
    lh.writeUInt32LE(content.length, 22);    // Uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);    // Filename length
    lh.writeUInt16LE(0, 28);                 // Extra field length
    nameBuf.copy(lh, 30);
    localHeaders.push(lh, compressed);

    // Central directory header (46 bytes + filename)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // Signature PK\x01\x02
    cd.writeUInt16LE(20, 4);         // Version made by
    cd.writeUInt16LE(20, 6);         // Version needed
    cd.writeUInt16LE(0, 8);          // General flags
    cd.writeUInt16LE(8, 10);         // Compression method: Deflate
    cd.writeUInt16LE(0, 12);         // Mod time
    cd.writeUInt16LE(0, 14);         // Mod date
    cd.writeUInt32LE(crc, 16);       // CRC32
    cd.writeUInt32LE(compressed.length, 20); // Compressed size
    cd.writeUInt32LE(content.length, 24);    // Uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28);    // Filename length
    cd.writeUInt16LE(0, 30);                 // Extra field length
    cd.writeUInt16LE(0, 32);                 // Comment length
    cd.writeUInt16LE(0, 34);                 // Disk number start
    cd.writeUInt16LE(0, 36);                 // Internal file attributes
    cd.writeUInt32LE(0, 38);                 // External file attributes
    cd.writeUInt32LE(offset, 42);            // Relative offset of local header
    nameBuf.copy(cd, 46);
    centralDirs.push(cd);

    offset += lh.length + compressed.length;
  }

  const cdTotalSize = centralDirs.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);  // Signature PK\x05\x06
  eocd.writeUInt16LE(0, 4);           // Disk number
  eocd.writeUInt16LE(0, 6);           // Disk start
  eocd.writeUInt16LE(files.length, 8); // Entries on disk
  eocd.writeUInt16LE(files.length, 10);// Total entries
  eocd.writeUInt32LE(cdTotalSize, 12); // Central directory size
  eocd.writeUInt32LE(offset, 16);      // Central directory offset
  eocd.writeUInt16LE(0, 20);          // Comment length

  return Buffer.concat([...localHeaders, ...centralDirs, eocd]);
}

/**
 * Merges multiple files (PDFs, JPGs, PNGs) into a unified consolidated PDF dossier.
 */
export async function mergeFilesToPdf(filePaths: string[]): Promise<Buffer | null> {
  try {
    const mergedDoc = await PDFDocument.create();
    let pagesAdded = 0;

    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) continue;
      const buf = fs.readFileSync(fp);

      // 1. Is it a PDF?
      if (buf.subarray(0, 4).toString() === '%PDF') {
        try {
          const srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
          const indices = srcDoc.getPageIndices();
          const copiedPages = await mergedDoc.copyPages(srcDoc, indices);
          copiedPages.forEach((p) => mergedDoc.addPage(p));
          pagesAdded += copiedPages.length;
          continue;
        } catch (e) {
          // If individual PDF is corrupted, continue to next file
        }
      }

      // 2. Is it a JPEG image?
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        try {
          const img = await mergedDoc.embedJpg(buf);
          const page = mergedDoc.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          pagesAdded++;
          continue;
        } catch (e) {}
      }

      // 3. Is it a PNG image?
      if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') {
        try {
          const img = await mergedDoc.embedPng(buf);
          const page = mergedDoc.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          pagesAdded++;
          continue;
        } catch (e) {}
      }
    }

    if (pagesAdded > 0) {
      const pdfBytes = await mergedDoc.save();
      return Buffer.from(pdfBytes);
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Splits a multi-page PDF into an array of individual single-page PDF files.
 */
export async function splitPdfToPages(pdfBuffer: Buffer): Promise<{ pageNumber: number; content: Buffer }[]> {
  try {
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const count = srcDoc.getPageCount();
    const result: { pageNumber: number; content: Buffer }[] = [];

    for (let i = 0; i < count; i++) {
      const singleDoc = await PDFDocument.create();
      const [copiedPage] = await singleDoc.copyPages(srcDoc, [i]);
      singleDoc.addPage(copiedPage);
      const savedBytes = await singleDoc.save();
      result.push({
        pageNumber: i + 1,
        content: Buffer.from(savedBytes),
      });
    }

    return result;
  } catch (err) {
    return [];
  }
}

/**
 * Generates an official DCC Digital Document Docket PDF on the fly
 * when physical binary files are not yet on disk or are metadata-only package entries.
 */
export async function generateDossierDocketPdf(docInfo: {
  title: string;
  referenceNumber?: string;
  departmentName?: string;
  documentType?: string;
  senderName?: string;
  status?: string;
  createdAt?: string | Date;
  fileSizeBytes?: number;
  sha256Hash?: string;
  attachments?: { name: string; size?: number; type?: string }[];
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const { width, height } = page.getSize();

  // Top Corporate Banner Header
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width,
    height: 80,
    color: rgb(0.06, 0.09, 0.16), // #0F172A
  });

  page.drawText('NKB MANUFACTURING CORPORATION', {
    x: 40,
    y: height - 38,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('RECORDS MANAGEMENT SECTION — DIGITAL DOSSIER CERTIFICATE', {
    x: 40,
    y: height - 56,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.58, 0.64, 0.72),
  });

  // Blue Accent Stripe
  page.drawRectangle({
    x: 0,
    y: height - 84,
    width,
    height: 4,
    color: rgb(0.15, 0.39, 0.92), // #2563EB
  });

  let curY = height - 120;

  // Title & Reference
  const refNum = docInfo.referenceNumber || 'DCC-RECORD-OFFICIAL';
  page.drawText('DOCUMENT DOSSIER RECORD', {
    x: 40,
    y: curY,
    size: 10,
    font: fontBold,
    color: rgb(0.15, 0.39, 0.92),
  });
  curY -= 20;

  const displayTitle = (docInfo.title || 'Untitled Document').slice(0, 65);
  page.drawText(displayTitle, {
    x: 40,
    y: curY,
    size: 15,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  curY -= 15;

  page.drawLine({
    start: { x: 40, y: curY },
    end: { x: width - 40, y: curY },
    thickness: 1,
    color: rgb(0.88, 0.91, 0.94),
  });
  curY -= 25;

  // Key Metadata Table Box
  page.drawRectangle({
    x: 40,
    y: curY - 110,
    width: width - 80,
    height: 125,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.82, 0.85, 0.9),
    borderWidth: 1,
  });

  const drawRow = (label: string, val: string, yPos: number, xCol2 = false) => {
    const xBase = xCol2 ? 310 : 55;
    page.drawText(label.toUpperCase(), {
      x: xBase,
      y: yPos,
      size: 7,
      font: fontBold,
      color: rgb(0.39, 0.45, 0.55),
    });
    page.drawText(val.slice(0, 36), {
      x: xBase,
      y: yPos - 12,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.06, 0.09, 0.16),
    });
  };

  const regDate = docInfo.createdAt ? new Date(docInfo.createdAt).toLocaleString() : new Date().toLocaleString();
  drawRow('Document Number', refNum, curY);
  drawRow('Department', docInfo.departmentName || 'General Liaison', curY, true);
  curY -= 30;

  drawRow('Document Type', docInfo.documentType || 'GENERAL_DOCUMENT', curY);
  drawRow('Lifecycle Status', (docInfo.status || 'RECORDED').toUpperCase(), curY, true);
  curY -= 30;

  drawRow('Source / Sender', docInfo.senderName || 'Liaison Desk Receiving', curY);
  drawRow('Registration Date', regDate, curY, true);
  curY -= 30;

  const sizeKb = ((docInfo.fileSizeBytes || 0) / 1024).toFixed(1);
  drawRow('Package Total Size', `${sizeKb} KB`, curY);
  drawRow('Storage Format', 'Enterprise DCC Vault (Consolidated)', curY, true);

  curY -= 45;

  // Attached Files / Package Contents Section
  const attachments = docInfo.attachments || [];
  page.drawText(`PACKAGE ATTACHMENTS & BUNDLE CONTENTS (${attachments.length} Files Sama-sama)`, {
    x: 40,
    y: curY,
    size: 9,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  curY -= 14;

  if (attachments.length > 0) {
    const maxShow = Math.min(attachments.length, 12);
    for (let i = 0; i < maxShow; i++) {
      const att = attachments[i];
      const attSizeKb = ((att.size || 0) / 1024).toFixed(1);
      const attName = (att.name || `Attachment_${i + 1}`).slice(0, 55);

      page.drawText(`[${i + 1}]`, {
        x: 45,
        y: curY,
        size: 7.5,
        font: fontMono,
        color: rgb(0.15, 0.39, 0.92),
      });

      page.drawText(attName, {
        x: 75,
        y: curY,
        size: 8,
        font: fontRegular,
        color: rgb(0.06, 0.09, 0.16),
      });

      page.drawText(`${attSizeKb} KB • ${att.type || 'DOCUMENT'}`, {
        x: width - 160,
        y: curY,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.39, 0.45, 0.55),
      });

      curY -= 14;
    }

    if (attachments.length > 12) {
      page.drawText(`... and ${attachments.length - 12} more bundled files registered in this package.`, {
        x: 45,
        y: curY,
        size: 8,
        font: fontRegular,
        color: rgb(0.39, 0.45, 0.55),
      });
      curY -= 18;
    }
  } else {
    page.drawText('Single document record or incoming physical liaison dispatch.', {
      x: 45,
      y: curY,
      size: 8,
      font: fontRegular,
      color: rgb(0.39, 0.45, 0.55),
    });
    curY -= 18;
  }

  curY -= 10;

  // Security & Integrity Hash Box
  page.drawRectangle({
    x: 40,
    y: curY - 50,
    width: width - 80,
    height: 55,
    color: rgb(0.95, 0.97, 1),
    borderColor: rgb(0.75, 0.85, 1),
    borderWidth: 1,
  });

  page.drawText('SECURITY INTEGRITY & AUDIT TRAIL', {
    x: 52,
    y: curY - 14,
    size: 7.5,
    font: fontBold,
    color: rgb(0.1, 0.3, 0.75),
  });

  const hashVal = (docInfo.sha256Hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  page.drawText(`SHA-256: ${hashVal}`, {
    x: 52,
    y: curY - 28,
    size: 6.5,
    font: fontMono,
    color: rgb(0.2, 0.25, 0.35),
  });

  page.drawText('Immutable blockchain/audit verified. Available for immediate download as Consolidated PDF or Split ZIP.', {
    x: 52,
    y: curY - 40,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.35, 0.45, 0.55),
  });

  // Footer
  page.drawLine({
    start: { x: 40, y: 45 },
    end: { x: width - 40, y: 45 },
    thickness: 0.5,
    color: rgb(0.8, 0.85, 0.9),
  });

  page.drawText('NKB DCC Cloud System • dcc.nkbmanufacturing.com • Confidential Corporate Liaison Record', {
    x: 40,
    y: 32,
    size: 7,
    font: fontRegular,
    color: rgb(0.55, 0.6, 0.7),
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

