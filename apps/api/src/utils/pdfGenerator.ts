import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface GeneratedPdfResult {
  pageCount: number;
  fileSizeBytes: number;
  filePath: string;
  sha256Hash: string;
}

/**
 * Creates a lossless, high-performance multi-page PDF from a list of JPEG image paths.
 * Directly embeds JPEG DCT-encoded byte streams into PDF XObjects with no transcoding or quality loss.
 */
export function createMultiPagePdf(jpegPaths: string[], outputPath: string): GeneratedPdfResult {
  const images: { buffer: Buffer; width: number; height: number; path: string }[] = [];

  for (const p of jpegPaths) {
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    const dim = getJpegDimensions(buf);
    images.push({ buffer: buf, width: dim.width, height: dim.height, path: p });
  }

  if (images.length === 0) {
    throw new Error('Walang wastong scanned pages na natagpuan upang gawing PDF.');
  }

  const numPages = images.length;
  const pdfHeader = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');

  // Total objects: 1 (Catalog) + 1 (Pages Root) + 3 * numPages (Page, Content, Image per page)
  const totalObjects = 2 + 3 * numPages;
  const offsets: number[] = new Array(totalObjects + 1);
  const objectBuffers: Buffer[] = [];

  let currentOffset = pdfHeader.length;

  function writeObject(objNum: number, content: Buffer | string) {
    offsets[objNum] = currentOffset;
    const header = Buffer.from(`${objNum} 0 obj\n`, 'binary');
    const footer = Buffer.from('\nendobj\n', 'binary');
    const body = typeof content === 'string' ? Buffer.from(content, 'binary') : content;
    const fullObj = Buffer.concat([header, body, footer]);
    currentOffset += fullObj.length;
    objectBuffers.push(fullObj);
  }

  // Object 1: Catalog
  writeObject(1, '<< /Type /Catalog /Pages 2 0 R >>');

  // Object 2: Pages root
  const pageObjNumbers: number[] = [];
  for (let i = 1; i <= numPages; i++) {
    pageObjNumbers.push(2 + (i - 1) * 3 + 1);
  }
  const kidsStr = pageObjNumbers.map(n => `${n} 0 R`).join(' ');
  writeObject(2, `<< /Type /Pages /Kids [${kidsStr}] /Count ${numPages} >>`);

  // Objects for each page
  images.forEach((img, idx) => {
    const k = idx + 1;
    const pageNum = 2 + (k - 1) * 3 + 1;
    const contentNum = pageNum + 1;
    const imgNum = pageNum + 2;

    // 1. Page object
    const pageBody = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${img.width} ${img.height}] /Resources << /XObject << /Im1 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>`;
    writeObject(pageNum, pageBody);

    // 2. Content stream (Scale and draw image)
    const drawStream = `q\n${img.width} 0 0 ${img.height} 0 0 cm\n/Im1 Do\nQ\n`;
    const contentBody = `<< /Length ${drawStream.length} >>\nstream\n${drawStream}endstream`;
    writeObject(contentNum, contentBody);

    // 3. Image XObject (Lossless JPEG stream)
    const imgHeader = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.buffer.length} >>\nstream\n`;
    const imgFooter = '\nendstream';
    const imgBody = Buffer.concat([
      Buffer.from(imgHeader, 'binary'),
      img.buffer,
      Buffer.from(imgFooter, 'binary')
    ]);
    writeObject(imgNum, imgBody);
  });

  // Cross-reference table (xref)
  const startXref = currentOffset;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    xref += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  const finalPdf = Buffer.concat([
    pdfHeader,
    ...objectBuffers,
    Buffer.from(xref + trailer, 'binary')
  ]);

  const parentDir = path.dirname(outputPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, finalPdf);
  const hash = crypto.createHash('sha256').update(finalPdf).digest('hex');

  return {
    pageCount: numPages,
    fileSizeBytes: finalPdf.length,
    filePath: outputPath,
    sha256Hash: hash,
  };
}

/**
 * Extracts width and height from JPEG header (SOF0/SOF2 marker)
 */
export function getJpegDimensions(buf: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < buf.length - 8) {
    if (buf[offset] !== 0xFF) break;
    const marker = buf[offset + 1];
    if (marker === 0xC0 || marker === 0xC2) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width: width || 2480, height: height || 3508 };
    }
    const len = buf.readUInt16BE(offset + 2);
    offset += 2 + len;
  }
  return { width: 2480, height: 3508 };
}
