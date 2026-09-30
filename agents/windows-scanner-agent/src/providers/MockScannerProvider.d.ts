import { IScannerProvider, DriverType, DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo } from '../core/types.js';
export declare class MockScannerProvider implements IScannerProvider {
    readonly driverType: DriverType;
    private mockScanners;
    private capabilitiesMap;
    private statusMap;
    constructor(initialScanners?: DiscoveredScanner[]);
    setMockScanners(scanners: DiscoveredScanner[]): void;
    setMockCapabilities(scannerId: string, caps: ScannerCapabilities): void;
    setMockStatus(scannerId: string, status: ScannerStatusInfo): void;
    discoverScanners(): Promise<DiscoveredScanner[]>;
    probeCapabilities(scannerId: string): Promise<ScannerCapabilities>;
    getScannerStatus(scannerId: string): Promise<ScannerStatusInfo>;
}
//# sourceMappingURL=MockScannerProvider.d.ts.map