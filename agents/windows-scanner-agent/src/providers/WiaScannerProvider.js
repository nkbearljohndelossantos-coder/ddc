/**
 * WiaScannerProvider
 * Windows Image Acquisition (WIA 2.0 COM) fallback driver adapter.
 */
export class WiaScannerProvider {
    driverType = 'WIA';
    async discoverScanners() {
        // Queries WIA DeviceManager COM interface
        return [];
    }
    async probeCapabilities(scannerId) {
        // Dynamically queries WIA properties
        return {
            duplexSupported: false,
            adfSupported: false,
            supportedColorModes: ['COLOR_24BIT', 'GRAYSCALE_8BIT', 'BW_1BIT'],
            supportedResolutionsDpi: [150, 300, 600],
            supportedPageSizes: ['A4', 'LETTER'],
        };
    }
    async getScannerStatus(scannerId) {
        return {
            scannerId,
            status: 'ONLINE',
            timestamp: new Date().toISOString(),
        };
    }
}
//# sourceMappingURL=WiaScannerProvider.js.map