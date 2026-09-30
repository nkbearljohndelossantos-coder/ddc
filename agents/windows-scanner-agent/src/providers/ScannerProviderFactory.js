import { TwainScannerProvider } from './TwainScannerProvider.js';
import { WiaScannerProvider } from './WiaScannerProvider.js';
import { OptionalNetworkScannerProvider } from './OptionalNetworkScannerProvider.js';
export class ScannerProviderFactory {
    static registeredProviders = new Map();
    static initializeDefaults() {
        this.registerProvider('TWAIN', new TwainScannerProvider());
        this.registerProvider('WIA', new WiaScannerProvider());
        this.registerProvider('NETWORK_ESCL', new OptionalNetworkScannerProvider());
    }
    static registerProvider(type, provider) {
        this.registeredProviders.set(type, provider);
    }
    static getProvider(type) {
        const provider = this.registeredProviders.get(type);
        if (!provider) {
            throw new Error(`No scanner provider registered for driver type: ${type}`);
        }
        return provider;
    }
    static getAllProviders() {
        return Array.from(this.registeredProviders.values());
    }
    /**
     * Discovers scanners across all registered native and fallback drivers.
     */
    static async discoverAll() {
        const results = [];
        for (const provider of this.getAllProviders()) {
            try {
                const scanners = await provider.discoverScanners();
                for (const s of scanners) {
                    results.push({ provider: provider.driverType, scanner: s });
                }
            }
            catch (err) {
                // Log diagnostic error without aborting entire discovery
            }
        }
        return results;
    }
}
//# sourceMappingURL=ScannerProviderFactory.js.map