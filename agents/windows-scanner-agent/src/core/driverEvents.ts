import { DiscoveredScanner, ScannerCapabilities, ScannerStatusInfo, ColorMode } from '../core/types.js';

export interface ScanAcquisitionOptions {
  scannerId: string;
  resolutionDpi: number;
  colorMode: ColorMode;
  duplex: boolean;
  autoDeskew?: boolean;
  maxPages?: number;
}

export interface AcquiredPageFrame {
  pageNumber: number;
  widthPixels: number;
  heightPixels: number;
  dpi: number;
  colorMode: ColorMode;
  isDuplexBackPage: boolean;
  rawBuffer: Buffer;
  sha256Hash: string;
  byteSize: number;
  timestamp: string;
}

export type HardwareEventCode =
  | 'DEVICE_ONLINE'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_BUSY'
  | 'FEEDER_EMPTY'
  | 'PAPER_JAM'
  | 'COVER_OPEN'
  | 'MULTIFEED_DETECTED'
  | 'HARDWARE_COMMUNICATION_ERROR'
  | 'DRIVER_NOT_RESPONDING'
  | 'UNKNOWN_ERROR';

export interface HardwareEvent {
  eventCode: HardwareEventCode;
  scannerId: string;
  driverType: string;
  message: string;
  rawErrorCode?: number | string;
  timestamp: string;
}
