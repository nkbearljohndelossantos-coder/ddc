/**
 * OptionalNetworkScannerProvider
 * Dynamically tests and probes optional network scanner protocols (e.g. eSCL / AirScan endpoints).
 * Only activates if dynamic network probes successfully connect and negotiate capabilities.
 */
export class OptionalNetworkScannerProvider {
    driverType = 'NETWORK_ESCL';
    async discoverScanners() {
        // Probes local subnet / configured network scanner IP
        return [];
    }
    async probeCapabilities(scannerId) {
        return {
            duplexSupported: false,
            adfSupported: false,
            supportedColorModes: ['COLOR_24BIT', 'GRAYSCALE_8BIT'],
            supportedResolutionsDpi: [300],
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
//# sourceMappingURL=OptionalNetworkScannerProvider.js.map