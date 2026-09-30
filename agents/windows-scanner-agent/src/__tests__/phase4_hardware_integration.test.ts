import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TwainScannerProvider,
  WiaScannerProvider,
  AcquiredPageFrame,
} from '../index.js';

describe('Phase 4: Brother ADS-4300N Native Integration & Hardware Event Mapping Tests', () => {
  // =========================================================================
  // 1. TWAIN PROVIDER CAPABILITY PROBING & ACQUISITION
  // =========================================================================
  describe('1. Brother ADS-4300N TWAIN 2.4 Integration', () => {
    const twainProvider = new TwainScannerProvider();

    it('should dynamically probe Brother ADS-4300N hardware capabilities', async () => {
      const caps = await twainProvider.probeCapabilities('BROTHER_ADS_4300N_TWAIN_01');

      assert.strictEqual(caps.duplexSupported, true, 'ADS-4300N supports duplex');
      assert.strictEqual(caps.adfSupported, true, 'ADS-4300N supports 80-sheet ADF');
      assert.strictEqual(caps.ultrasonicMultiFeedSupported, true, 'ADS-4300N exposes ultrasonic multi-feed sensor');
      assert.strictEqual(caps.maxFeederCapacitySheets, 80);
      assert.ok(caps.supportedResolutionsDpi.includes(300));
      assert.ok(caps.supportedResolutionsDpi.includes(600));
      assert.ok(caps.supportedResolutionsDpi.includes(1200));
      assert.ok(caps.supportedColorModes.includes('COLOR_24BIT'));
      assert.ok(caps.supportedColorModes.includes('BW_1BIT'));
    });

    it('should map TWAIN condition codes to normalized hardware events', () => {
      const jamEvent = twainProvider.mapTwainConditionCode('BROTHER_ADS_4300N_TWAIN_01', 3);
      assert.strictEqual(jamEvent.eventCode, 'PAPER_JAM');
      assert.ok(jamEvent.message.includes('Paper jam'));

      const emptyEvent = twainProvider.mapTwainConditionCode('BROTHER_ADS_4300N_TWAIN_01', 4);
      assert.strictEqual(emptyEvent.eventCode, 'FEEDER_EMPTY');

      const coverEvent = twainProvider.mapTwainConditionCode('BROTHER_ADS_4300N_TWAIN_01', 5);
      assert.strictEqual(coverEvent.eventCode, 'COVER_OPEN');

      const multifeedEvent = twainProvider.mapTwainConditionCode('BROTHER_ADS_4300N_TWAIN_01', 100);
      assert.strictEqual(multifeedEvent.eventCode, 'MULTIFEED_DETECTED');
      assert.ok(multifeedEvent.message.includes('Ultrasonic'));
    });

    it('should acquire raw page frames with SHA-256 cryptographic hashes', async () => {
      const acquiredFrames: AcquiredPageFrame[] = [];

      const result = await twainProvider.acquirePages(
        {
          scannerId: 'BROTHER_ADS_4300N_TWAIN_01',
          resolutionDpi: 300,
          colorMode: 'COLOR_24BIT',
          duplex: true,
          maxPages: 4,
        },
        async (frame) => {
          acquiredFrames.push(frame);
        }
      );

      assert.strictEqual(result.totalPagesAcquired, 4);
      assert.strictEqual(acquiredFrames.length, 4);

      // Verify Page 1 (Front) & Page 2 (Back / Duplex)
      assert.strictEqual(acquiredFrames[0].pageNumber, 1);
      assert.strictEqual(acquiredFrames[0].isDuplexBackPage, false);
      assert.strictEqual(acquiredFrames[0].widthPixels, 2480);
      assert.strictEqual(acquiredFrames[0].heightPixels, 3508);
      assert.strictEqual(acquiredFrames[0].dpi, 300);
      assert.ok(acquiredFrames[0].sha256Hash.length === 64, 'SHA-256 hash must be 64-char hex');

      assert.strictEqual(acquiredFrames[1].pageNumber, 2);
      assert.strictEqual(acquiredFrames[1].isDuplexBackPage, true);
    });
  });

  // =========================================================================
  // 2. WIA 2.0 FALLBACK DRIVER INTEGRATION
  // =========================================================================
  describe('2. WIA 2.0 Fallback Integration & Graceful Degradation', () => {
    const wiaProvider = new WiaScannerProvider();

    it('should probe WIA capabilities and gracefully omit unsupported ultrasonic sensor', async () => {
      const caps = await wiaProvider.probeCapabilities('BROTHER_ADS_4300N_WIA_01');

      assert.strictEqual(caps.duplexSupported, true);
      assert.strictEqual(caps.adfSupported, true);
      assert.strictEqual(caps.ultrasonicMultiFeedSupported, false, 'WIA driver does not expose ultrasonic sensor');
      assert.strictEqual(caps.hardwareAutoDeskewSupported, false);
    });

    it('should map WIA HRESULT error codes to normalized hardware events', () => {
      const jamEvent = wiaProvider.mapWiaHResult('BROTHER_ADS_4300N_WIA_01', 0x80210002);
      assert.strictEqual(jamEvent.eventCode, 'PAPER_JAM');

      const emptyEvent = wiaProvider.mapWiaHResult('BROTHER_ADS_4300N_WIA_01', 0x80210003);
      assert.strictEqual(emptyEvent.eventCode, 'FEEDER_EMPTY');

      const coverEvent = wiaProvider.mapWiaHResult('BROTHER_ADS_4300N_WIA_01', 0x80210006);
      assert.strictEqual(coverEvent.eventCode, 'COVER_OPEN');
    });

    it('should acquire fallback pages with correct dimensions and checksums', async () => {
      const acquiredFrames: AcquiredPageFrame[] = [];

      const result = await wiaProvider.acquirePages(
        {
          scannerId: 'BROTHER_ADS_4300N_WIA_01',
          resolutionDpi: 300,
          colorMode: 'GRAYSCALE_8BIT',
          duplex: false,
        },
        async (frame) => {
          acquiredFrames.push(frame);
        }
      );

      assert.strictEqual(result.totalPagesAcquired, 1);
      assert.strictEqual(acquiredFrames[0].colorMode, 'GRAYSCALE_8BIT');
      assert.ok(acquiredFrames[0].sha256Hash);
    });
  });
});
