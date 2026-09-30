import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../../lib/prisma.js';

const execAsync = promisify(exec);

import { createMultiPagePdf } from '../../utils/pdfGenerator.js';

export interface PhysicalScanOptions {
  title?: string;
  dpi?: number;
  duplex?: boolean;
}

export interface PhysicalScanPage {
  pageNumber: number;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sha256Hash: string;
}

export interface PhysicalScanResult {
  success: boolean;
  folderPath: string;
  folderName: string;
  mergedPdfPath: string;
  mergedPdfName: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sha256Hash: string;
  pageCount: number;
  pages: PhysicalScanPage[];
  scannerModel: string;
  driverType: string;
}

export class ScannerService {
  private scansDir = path.resolve(process.cwd(), 'uploads', 'scans');

  /**
   * Directly triggers physical continuous ADF multi-page scan on the connected Brother ADS-4300N via Windows WIA
   * Groups all scanned pages into a dossier folder and automatically compiles them into a merged multi-page PDF.
   */
  async triggerPhysicalScan(options?: PhysicalScanOptions): Promise<PhysicalScanResult> {
    if (!fs.existsSync(this.scansDir)) {
      fs.mkdirSync(this.scansDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = (options?.title || `Scan_Brother_ADS4300N_${timestamp}`)
      .replace(/\.pdf$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');

    const folderPath = path.join(this.scansDir, safeTitle);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const scriptPath = path.join(this.scansDir, `wia_exec_${Date.now()}.ps1`);

    const psScript = `
$ErrorActionPreference = 'Stop'
$targetFolder = "${folderPath.replace(/\\/g, '\\\\')}"
$maxAttempts = 3
$attempt = 1
$success = $false

while ($attempt -le $maxAttempts -and -not $success) {
    try {
        $dm = New-Object -ComObject WIA.DeviceManager
        $targetDevInfo = $null
        
        foreach ($d in $dm.DeviceInfos) {
            $name = $d.Properties.Item("Name").Value
            if ($name -match "ADS-4300N" -and $d.Type -eq 1) {
                $targetDevInfo = $d
                break
            }
        }

        if (-not $targetDevInfo) {
            foreach ($d in $dm.DeviceInfos) {
                if ($d.Type -eq 1) {
                    $targetDevInfo = $d
                    break
                }
            }
        }

        if (-not $targetDevInfo) {
            Write-Output "ERROR: SCANNER_NOT_FOUND"
            exit 10
        }

        $device = $targetDevInfo.Connect()
        if ($device.Items.Count -eq 0) {
            Write-Output "ERROR: NO_SCANNER_ITEMS"
            exit 11
        }

        # Select Feeder (ADF)
        try {
            $device.Properties.Item("Document Handling Select").Value = 1
        } catch {}

        $pageIndex = 1
        $acquiredCount = 0

        while ($true) {
            try {
                $item = $device.Items.Item(1)
                $image = $item.Transfer("{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}")
                $pagePath = Join-Path $targetFolder "page_$pageIndex.jpg"
                
                if (Test-Path $pagePath) {
                    Remove-Item $pagePath -Force
                }
                
                $image.SaveFile($pagePath)
                Write-Output "PAGE_SAVED: $pagePath"
                $pageIndex++
                $acquiredCount++
            } catch {
                $hresult = $_.Exception.HResult
                $msg = $_.Exception.Message
                
                # Feeder empty error code (0x80210003 or -2145320957)
                if ($acquiredCount -ge 1) {
                    Write-Output "FEEDER_COMPLETED: Acquired $acquiredCount pages."
                    break
                } else {
                    if ($msg -match "busy" -or $hresult -eq -2145320954) {
                        if ($attempt -lt $maxAttempts) {
                            Start-Sleep -Milliseconds 1500
                            $attempt++
                            break
                        }
                        Write-Output "ERROR: SCANNER_BUSY: Scanner is busy. Please wait a moment and try again."
                        exit 22
                    } elseif ($msg -match "empty" -or $hresult -eq -2145320957 -or $msg -match "paper") {
                        Write-Output "ERROR: FEEDER_EMPTY: Please place documents in the Brother ADS-4300N paper tray."
                        exit 20
                    } elseif ($msg -match "jam" -or $hresult -eq -2145320958) {
                        Write-Output "ERROR: PAPER_JAM: Paper jam detected in Brother ADS-4300N feeder."
                        exit 21
                    } else {
                        Write-Output "ERROR: WIA_FAILURE: $msg"
                        exit 30
                    }
                }
            }
        }

        if ($acquiredCount -ge 1) {
            $success = $true
        }
    } catch {
        $msg = $_.Exception.Message
        Write-Output "ERROR: WIA_CRITICAL: $msg"
        exit 31
    } finally {
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
    }
}
`;

    try {
      fs.writeFileSync(scriptPath, psScript, 'utf-8');

      await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { timeout: 90000 }
      );

      // Collect all page files in the folder
      const pageFiles = fs.readdirSync(folderPath)
        .filter(f => /^page_\d+\.jpe?g$/i.test(f))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)![0], 10);
          const numB = parseInt(b.match(/\d+/)![0], 10);
          return numA - numB;
        });

      if (pageFiles.length === 0) {
        throw new Error('Walang pahina na naiscan mula sa Brother ADS-4300N.');
      }

      const pages: PhysicalScanPage[] = pageFiles.map((pf, idx) => {
        const fullPath = path.join(folderPath, pf);
        const buf = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        return {
          pageNumber: idx + 1,
          filePath: fullPath,
          fileName: pf,
          fileSizeBytes: buf.length,
          sha256Hash: hash,
        };
      });

      // Generate the unified multi-page PDF
      const mergedPdfName = `${safeTitle}.pdf`;
      const mergedPdfPath = path.join(folderPath, mergedPdfName);
      const pdfResult = createMultiPagePdf(
        pages.map(p => p.filePath),
        mergedPdfPath
      );

      return {
        success: true,
        folderPath,
        folderName: safeTitle,
        mergedPdfPath,
        mergedPdfName,
        filePath: mergedPdfPath,
        fileName: mergedPdfName,
        fileSizeBytes: pdfResult.fileSizeBytes,
        sha256Hash: pdfResult.sha256Hash,
        pageCount: pdfResult.pageCount,
        pages,
        scannerModel: 'Brother ADS-4300N',
        driverType: 'WIA 2.0 (Duplex ADF)',
      };
    } catch (err: any) {
      const outputText = `${err.stdout || ''} ${err.stderr || ''} ${err.message || ''}`;
      if (outputText.includes('FEEDER_EMPTY') || outputText.includes('empty')) {
        throw new Error('Walang papel sa tray ng scanner: Pakilagyan ng papel ang feeder ng Brother ADS-4300N at subukang muli.');
      } else if (outputText.includes('PAPER_JAM') || outputText.includes('jam')) {
        throw new Error('Paper jam: May nagbara na papel sa feeder ng Brother ADS-4300N.');
      } else if (outputText.includes('SCANNER_BUSY') || outputText.includes('busy')) {
        throw new Error('Kasalukuyang abala ang scanner (Busy): Pakihintay sandali at subukang muli.');
      } else if (outputText.includes('SCANNER_NOT_FOUND')) {
        throw new Error('Hindi makita ang Brother ADS-4300N scanner: Pakisuri ang USB cable o power.');
      } else {
        throw new Error(err.message || 'Nabigo ang pag-scan sa Brother ADS-4300N scanner.');
      }
    } finally {
      try {
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      } catch {}
    }
  }

  async listScanners(organizationId?: string, departmentId?: string) {
    return prisma.scanner.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(departmentId ? { departmentId } : {}),
      },
      include: {
        agent: {
          select: {
            id: true,
            agentName: true,
            machineName: true,
            status: true,
            lastHeartbeat: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: { scannerName: 'asc' },
    });
  }

  async getScanner(scannerId: string) {
    const scanner = await prisma.scanner.findUnique({
      where: { id: scannerId },
      include: {
        agent: {
          select: {
            id: true,
            agentName: true,
            machineName: true,
            status: true,
            lastHeartbeat: true,
          },
        },
        department: true,
      },
    });

    if (!scanner) {
      throw { statusCode: 404, message: 'Scanner not found' };
    }

    return scanner;
  }

  async getScannerCapabilities(scannerId: string) {
    const scanner = await prisma.scanner.findUnique({
      where: { id: scannerId },
      select: {
        id: true,
        scannerName: true,
        driverType: true,
        capabilities: true,
        status: true,
        lastError: true,
      },
    });

    if (!scanner) {
      throw { statusCode: 404, message: 'Scanner not found' };
    }

    return {
      scannerId: scanner.id,
      scannerName: scanner.scannerName,
      driverType: scanner.driverType,
      capabilities: scanner.capabilities || {},
    };
  }

  async getScannerStatus(scannerId: string) {
    const scanner = await prisma.scanner.findUnique({
      where: { id: scannerId },
      select: {
        id: true,
        scannerName: true,
        status: true,
        lastError: true,
        updatedAt: true,
        agent: {
          select: {
            status: true,
            lastHeartbeat: true,
          },
        },
      },
    });

    if (!scanner) {
      throw { statusCode: 404, message: 'Scanner not found' };
    }

    // If agent is offline, scanner status is considered OFFLINE
    const isAgentOffline = !scanner.agent || scanner.agent.status !== 'ONLINE';
    const effectiveStatus = isAgentOffline ? 'OFFLINE' : scanner.status;

    return {
      scannerId: scanner.id,
      scannerName: scanner.scannerName,
      status: effectiveStatus,
      lastError: scanner.lastError,
      agentStatus: scanner.agent?.status || 'OFFLINE',
      lastHeartbeat: scanner.agent?.lastHeartbeat || null,
      updatedAt: scanner.updatedAt,
    };
  }
}

export const scannerService = new ScannerService();
