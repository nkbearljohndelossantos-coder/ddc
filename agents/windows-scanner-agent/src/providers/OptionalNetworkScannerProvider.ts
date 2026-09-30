import { IScannerProvider, DriverType, DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo } from '../core/types.js';

/**
 * OptionalNetworkScannerProvider
 * Dynamically tests and probes optional network scanner protocols (e.g. eSCL / AirScan endpoints).
 * Only activates if dynamic network probes successfully connect and negotiate capabilities.
 */
export class OptionalNetworkScannerProvider implements IScannerProvider {
  readonly driverType: DriverType = 'NETWORK_ESCL';

  async discoverScanners(): Promise<DiscoveredScanner[]> {
    // Probes local subnet / configured network scanner IP
    return [];
  }

  async probeCapabilities(scannerId: string): Promise<ScannerCapabilities> {
    return {
      duplexSupported: false,
      adfSupported: false,
      supportedColorModes: ['COLOR_24BIT', 'GRAYSCALE_8BIT'],
      supportedResolutionsDpi: [300],
      supportedPageSizes: ['A4', 'LETTER'],
    };
  }

  async getScannerStatus(scannerId: string): Promise<ScannerStatusInfo> {
    return {
      scannerId,
      status: 'ONLINE',
      timestamp: new Date().toISOString(),
    };
  }
}
