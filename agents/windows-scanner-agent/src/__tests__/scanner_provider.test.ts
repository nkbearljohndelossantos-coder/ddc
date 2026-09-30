import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MockScannerProvider,
  ScannerProviderFactory,
  DiscoveredScanner,
  ScannerCapabilities,
  ScannerStatusInfo,
} from '../index.js';

describe('Windows Scanner Agent: Provider Abstraction & Capability Detection', () => {
  it('should register and discover scanners dynamically via MockScannerProvider', async () => {
    const brotherADS4300N: DiscoveredScanner = {
      scannerId: 'BROTHER_ADS4300N_SN12345',
      displayName: 'Brother ADS-4300N',
      driverType: 'TWAIN',
      connectionType: 'NETWORK',
      isDefault: true,
      rawDriverInfo: {
        driverVersion: '2.4.0',
        dsmVersion: '2.4.1',
      },
    };

    const fallbackScanner: DiscoveredScanner = {
      scannerId: 'WIA_DESKTOP_SCANNER_01',
      displayName: 'Generic WIA Flatbed/ADF Scanner',
      driverType: 'WIA',
      connectionType: 'USB',
    };

    const mockProvider = new MockScannerProvider([brotherADS4300N, fallbackScanner]);
    ScannerProviderFactory.registerProvider('CUSTOM', mockProvider);

    const discovered = await mockProvider.discoverScanners();
    assert.strictEqual(discovered.length, 2);
    assert.strictEqual(discovered[0].displayName, 'Brother ADS-4300N');
    assert.strictEqual(discovered[0].driverType, 'TWAIN');
    assert.strictEqual(discovered[1].displayName, 'Generic WIA Flatbed/ADF Scanner');
  });

  it('should only report capabilities exposed by the active driver', async () => {
    const mockProvider = new MockScannerProvider();

    // Define dynamically probed capabilities for Brother ADS-4300N
    const brotherCapabilities: ScannerCapabilities = {
      duplexSupported: true,
      adfSupported: true,
      supportedColorModes: ['COLOR_24BIT', 'GRAYSCALE_8BIT', 'BW_1BIT'],
      supportedResolutionsDpi: [100, 150, 200, 300, 400, 600, 1200],
      supportedPageSizes: ['A4', 'A5', 'LETTER', 'LEGAL', 'CUSTOM'],
      ultrasonicMultiFeedSupported: true,
      hardwareAutoDeskewSupported: true,
      paperDetectionSupported: true,
      maxFeederCapacitySheets: 80,
    };

    mockProvider.setMockCapabilities('BROTHER_ADS4300N_SN12345', brotherCapabilities);

    const probed = await mockProvider.probeCapabilities('BROTHER_ADS4300N_SN12345');
    assert.strictEqual(probed.duplexSupported, true);
    assert.strictEqual(probed.adfSupported, true);
    assert.strictEqual(probed.ultrasonicMultiFeedSupported, true);
    assert.strictEqual(probed.maxFeederCapacitySheets, 80);
    assert.deepStrictEqual(probed.supportedColorModes, ['COLOR_24BIT', 'GRAYSCALE_8BIT', 'BW_1BIT']);

    // Unknown scanner probe returns minimum unknown capability
    const unknownProbed = await mockProvider.probeCapabilities('UNKNOWN_SCANNER_999');
    assert.strictEqual(unknownProbed.duplexSupported, false);
    assert.strictEqual(unknownProbed.adfSupported, false);
    assert.strictEqual(unknownProbed.ultrasonicMultiFeedSupported, undefined);
  });

  it('should report normalized scanner status without losing diagnostics', async () => {
    const mockProvider = new MockScannerProvider();

    const statusInfo: ScannerStatusInfo = {
      scannerId: 'BROTHER_ADS4300N_SN12345',
      status: 'ONLINE',
      feederLoaded: true,
      coverOpen: false,
      paperJam: false,
      timestamp: new Date().toISOString(),
      diagnosticRaw: {
        sensorBitmask: 0x01,
        vendorCode: 0,
      },
    };

    mockProvider.setMockStatus('BROTHER_ADS4300N_SN12345', statusInfo);

    const reported = await mockProvider.getScannerStatus('BROTHER_ADS4300N_SN12345');
    assert.strictEqual(reported.status, 'ONLINE');
    assert.strictEqual(reported.feederLoaded, true);
    assert.strictEqual(reported.coverOpen, false);
    assert.strictEqual(reported.paperJam, false);
    assert.ok(reported.diagnosticRaw);
  });
});
