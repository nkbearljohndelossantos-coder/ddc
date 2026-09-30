export type DriverType = 'TWAIN' | 'WIA' | 'NETWORK_ESCL' | 'CUSTOM';

export type NormalizedScannerStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'ERROR' | 'UNKNOWN';

export type ColorMode = 'COLOR_24BIT' | 'GRAYSCALE_8BIT' | 'BW_1BIT';

export interface DiscoveredScanner {
  scannerId: string;
  displayName: string;
  driverType: DriverType;
  connectionType?: 'USB' | 'NETWORK' | 'UNKNOWN';
  isDefault?: boolean;
  rawDriverInfo?: Record<string, any>;
}

/**
 * Dynamic capability model.
 * Capabilities are strictly boolean/array values reported only if the active driver exposes them.
 * Unsupported or unknown capabilities remain undefined or empty.
 */
export interface ScannerCapabilities {
  duplexSupported: boolean;
  adfSupported: boolean;
  supportedColorModes: ColorMode[];
  supportedResolutionsDpi: number[];
  supportedPageSizes: string[];
  ultrasonicMultiFeedSupported?: boolean;
  hardwareAutoDeskewSupported?: boolean;
  paperDetectionSupported?: boolean;
  maxFeederCapacitySheets?: number;
  customDriverProperties?: Record<string, any>;
}

/**
 * Normalized hardware status with diagnostic error preservation.
 */
export interface ScannerStatusInfo {
  scannerId: string;
  status: NormalizedScannerStatus;
  feederLoaded?: boolean;
  coverOpen?: boolean;
  paperJam?: boolean;
  lastError?: string;
  diagnosticRaw?: Record<string, any>;
  timestamp: string;
}

/**
 * Abstract Scanner Provider Interface.
 */
export interface IScannerProvider {
  readonly driverType: DriverType;
  discoverScanners(): Promise<DiscoveredScanner[]>;
  probeCapabilities(scannerId: string): Promise<ScannerCapabilities>;
  getScannerStatus(scannerId: string): Promise<ScannerStatusInfo>;
}
