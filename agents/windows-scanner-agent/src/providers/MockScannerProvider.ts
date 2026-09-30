import { IScannerProvider, DriverType, DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo } from '../core/types.js';

export class MockScannerProvider implements IScannerProvider {
  readonly driverType: DriverType = 'CUSTOM';
  private mockScanners: DiscoveredScanner[] = [];
  private capabilitiesMap: Map<string, ScannerCapabilities> = new Map();
  private statusMap: Map<string, ScannerStatusInfo> = new Map();

  constructor(initialScanners?: DiscoveredScanner[]) {
    if (initialScanners) {
      this.mockScanners = [...initialScanners];
    }
  }

  setMockScanners(scanners: DiscoveredScanner[]) {
    this.mockScanners = [...scanners];
  }

  setMockCapabilities(scannerId: string, caps: ScannerCapabilities) {
    this.capabilitiesMap.set(scannerId, caps);
  }

  setMockStatus(scannerId: string, status: ScannerStatusInfo) {
    this.statusMap.set(scannerId, status);
  }

  async discoverScanners(): Promise<DiscoveredScanner[]> {
    return [...this.mockScanners];
  }

  async probeCapabilities(scannerId: string): Promise<ScannerCapabilities> {
    const caps = this.capabilitiesMap.get(scannerId);
    if (!caps) {
      // Return minimum baseline unknown capability
      return {
        duplexSupported: false,
        adfSupported: false,
        supportedColorModes: ['COLOR_24BIT'],
        supportedResolutionsDpi: [300],
        supportedPageSizes: ['A4'],
      };
    }
    return { ...caps };
  }

  async getScannerStatus(scannerId: string): Promise<ScannerStatusInfo> {
    const status = this.statusMap.get(scannerId);
    if (!status) {
      return {
        scannerId,
        status: 'ONLINE',
        timestamp: new Date().toISOString(),
      };
    }
    return { ...status };
  }
}
