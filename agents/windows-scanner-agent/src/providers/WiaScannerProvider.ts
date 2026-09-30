import crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  IScannerProvider,
  DriverType,
  DiscoveredScanner,
  ScannerCapabilities,
  ScannerStatusInfo,
} from '../core/types.js';
import {
  ScanAcquisitionOptions,
  AcquiredPageFrame,
  HardwareEvent,
  HardwareEventCode,
} from '../core/driverEvents.js';

/**
 * Windows Image Acquisition (WIA 2.0 COM) Fallback Driver Provider.
 */
export class WiaScannerProvider extends EventEmitter implements IScannerProvider {
  readonly driverType: DriverType = 'WIA';

  async discoverScanners(): Promise<DiscoveredScanner[]> {
    return [
      {
        scannerId: 'BROTHER_ADS_4300N_WIA_01',
        displayName: 'Brother ADS-4300N WIA',
        driverType: 'WIA',
        connectionType: 'USB',
        isDefault: false,
        rawDriverInfo: {
          manufacturer: 'Brother',
          deviceType: 'ScannerDeviceType (WIA 2.0)',
        },
      },
    ];
  }

  async probeCapabilities(scannerId: string): Promise<ScannerCapabilities> {
    return {
      duplexSupported: true,
      adfSupported: true,
      supportedColorModes: ['COLOR_24BIT', 'GRAYSCALE_8BIT', 'BW_1BIT'],
      supportedResolutionsDpi: [150, 200, 300, 600],
      supportedPageSizes: ['A4', 'LETTER', 'LEGAL'],
      ultrasonicMultiFeedSupported: false, // WIA does not expose vendor-specific ultrasonic sensor APIs
      hardwareAutoDeskewSupported: false,
      paperDetectionSupported: true,
      maxFeederCapacitySheets: 80,
    };
  }

  async getScannerStatus(scannerId: string): Promise<ScannerStatusInfo> {
    return {
      scannerId,
      status: 'ONLINE',
      feederLoaded: true,
      coverOpen: false,
      paperJam: false,
      timestamp: new Date().toISOString(),
    };
  }

  async acquirePages(
    options: ScanAcquisitionOptions,
    onPageAcquired: (frame: AcquiredPageFrame) => Promise<void>
  ): Promise<{ totalPagesAcquired: number }> {
    const pages = options.duplex ? 2 : 1;
    let pageNumber = 1;

    for (let i = 0; i < pages; i++) {
      const isDuplexBack = options.duplex && i % 2 === 1;
      const mockRawBuffer = Buffer.alloc(1024 * 256, (pageNumber * 23) % 255);
      const sha256Hash = crypto.createHash('sha256').update(mockRawBuffer).digest('hex');

      const frame: AcquiredPageFrame = {
        pageNumber,
        widthPixels: 2480,
        heightPixels: 3508,
        dpi: options.resolutionDpi,
        colorMode: options.colorMode,
        isDuplexBackPage: isDuplexBack,
        rawBuffer: mockRawBuffer,
        sha256Hash,
        byteSize: mockRawBuffer.length,
        timestamp: new Date().toISOString(),
      };

      await onPageAcquired(frame);
      pageNumber++;
    }

    return { totalPagesAcquired: pageNumber - 1 };
  }

  mapWiaHResult(scannerId: string, hresult: number): HardwareEvent {
    let eventCode: HardwareEventCode = 'UNKNOWN_ERROR';
    let message = `WIA Error HRESULT 0x${(hresult >>> 0).toString(16).toUpperCase()}`;

    switch (hresult) {
      case 0x80210002: // WIA_ERROR_PAPER_JAM
        eventCode = 'PAPER_JAM';
        message = 'WIA reported paper jam in document feeder';
        break;
      case 0x80210003: // WIA_ERROR_PAPER_EMPTY
        eventCode = 'FEEDER_EMPTY';
        message = 'WIA reported ADF feeder is empty';
        break;
      case 0x80210006: // WIA_ERROR_COVER_OPEN
        eventCode = 'COVER_OPEN';
        message = 'WIA reported scanner top cover open';
        break;
      case 0x80210001: // WIA_ERROR_GENERAL_ERROR
      default:
        eventCode = 'HARDWARE_COMMUNICATION_ERROR';
        message = `WIA hardware communication error`;
    }

    return {
      eventCode,
      scannerId,
      driverType: this.driverType,
      message,
      rawErrorCode: hresult,
      timestamp: new Date().toISOString(),
    };
  }
}
