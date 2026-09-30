import { IScannerProvider, DriverType, DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo } from '../core/types.js';
/**
 * WiaScannerProvider
 * Windows Image Acquisition (WIA 2.0 COM) fallback driver adapter.
 */
export declare class WiaScannerProvider implements IScannerProvider {
    readonly driverType: DriverType;
    discoverScanners(): Promise<DiscoveredScanner[]>;
    probeCapabilities(scannerId: string): Promise<ScannerCapabilities>;
    getScannerStatus(scannerId: string): Promise<ScannerStatusInfo>;
}
//# sourceMappingURL=WiaScannerProvider.d.ts.map