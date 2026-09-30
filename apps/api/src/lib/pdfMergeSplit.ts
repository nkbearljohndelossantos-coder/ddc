import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { PDFDocument } from 'pdf-lib';

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
