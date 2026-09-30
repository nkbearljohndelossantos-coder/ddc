import { IScannerProvider, DriverType } from '../core/types.js';
export declare class ScannerProviderFactory {
    private static registeredProviders;
    static initializeDefaults(): void;
    static registerProvider(type: DriverType, provider: IScannerProvider): void;
    static getProvider(type: DriverType): IScannerProvider;
    static getAllProviders(): IScannerProvider[];
    /**
     * Discovers scanners across all registered native and fallback drivers.
     */
    static discoverAll(): Promise<Array<{
        provider: DriverType;
        scanner: any;
    }>>;
}
//# sourceMappingURL=ScannerProviderFactory.d.ts.map