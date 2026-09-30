export class MockScannerProvider {
    driverType = 'CUSTOM';
    mockScanners = [];
    capabilitiesMap = new Map();
    statusMap = new Map();
    constructor(initialScanners) {
        if (initialScanners) {
            this.mockScanners = [...initialScanners];
        }
    }
    setMockScanners(scanners) {
        this.mockScanners = [...scanners];
    }
    setMockCapabilities(scannerId, caps) {
        this.capabilitiesMap.set(scannerId, caps);
    }
    setMockStatus(scannerId, status) {
        this.statusMap.set(scannerId, status);
    }
    async discoverScanners() {
        return [...this.mockScanners];
    }
    async probeCapabilities(scannerId) {
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
    async getScannerStatus(scannerId) {
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
//# sourceMappingURL=MockScannerProvider.js.map