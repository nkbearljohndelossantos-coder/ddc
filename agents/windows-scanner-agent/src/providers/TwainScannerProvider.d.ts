import { IScannerProvider, DriverType, DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo } from '../core/types.js';
/**
 * TwainScannerProvider
 * Isolated Windows TWAIN 2.4 DSM driver adapter.
 * Interrogates TWAIN data sources dynamically without hardcoded scanner assumptions.
 */
export declare class TwainScannerProvider implements IScannerProvider {
    readonly driverType: DriverType;
    discoverScanners(): Promise<DiscoveredScanner[]>;
    probeCapabilities(scannerId: string): Promise<ScannerCapabilities>;
    getScannerStatus(scannerId: string): Promise<ScannerStatusInfo>;
}
//# sourceMappingURL=TwainScannerProvider.d.ts.map