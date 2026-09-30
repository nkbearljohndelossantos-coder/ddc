import { IScannerProvider, DriverType, DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo } from '../core/types.js';
/**
 * OptionalNetworkScannerProvider
 * Dynamically tests and probes optional network scanner protocols (e.g. eSCL / AirScan endpoints).
 * Only activates if dynamic network probes successfully connect and negotiate capabilities.
 */
export declare class OptionalNetworkScannerProvider implements IScannerProvider {
    readonly driverType: DriverType;
    discoverScanners(): Promise<DiscoveredScanner[]>;
    probeCapabilities(scannerId: string): Promise<ScannerCapabilities>;
    getScannerStatus(scannerId: string): Promise<ScannerStatusInfo>;
}
//# sourceMappingURL=OptionalNetworkScannerProvider.d.ts.map