import { Request, Response, NextFunction } from 'express';
import { scannerService } from './scanner.service.js';
import { documentController } from '../documents/document.controller.js';

export class ScannerController {
  async listScanners(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const departmentId = req.query.departmentId as string | undefined;
      const result = await scannerService.listScanners(user.organizationId, departmentId);
      res.json({ scanners: result });
    } catch (error) {
      next(error);
    }
  }

  async getScanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await scannerService.getScanner(id);
      res.json({ scanner: result });
    } catch (error) {
      next(error);
    }
  }

  async getScannerCapabilities(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await scannerService.getScannerCapabilities(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getScannerStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await scannerService.getScannerStatus(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async detectPorts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await scannerService.detectConnectedScanners();
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async switchScanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { scannerId, scannerName, portName, driverType } = req.body;
      if (!scannerId) {
        res.status(400).json({ success: false, error: 'scannerId is required' });
        return;
      }
      const result = await scannerService.switchActiveScanner({
        scannerId,
        scannerName,
        portName,
        driverType,
      });
      res.json({
        success: true,
        message: `Switched active scanner to ${result.activeScanner.scannerName} (${result.activeScanner.portName})`,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getLocalStorage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const info = await scannerService.getLocalStorageInfo();
      res.json({ success: true, ...info });
    } catch (error) {
      next(error);
    }
  }

  async redirectLocalStorage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { newPath } = req.body;
      const info = await scannerService.redirectLocalStoragePath(newPath);
      res.json({
        success: true,
        message: `Local Storage path redirected to: ${info.localStoragePath}`,
        ...info,
      });
    } catch (error) {
      next(error);
    }
  }

  async triggerScan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      req.body.usePhysicalHardware = true;
      if (!req.body.scannerDevice && req.body.scannerId) {
        req.body.scannerDevice = req.body.scannerId;
      }
      if (!req.body.portName && req.body.port) {
        req.body.portName = req.body.port;
      }
      await documentController.create(req, res, next);
    } catch (error) {
      next(error);
    }
  }
}

export const scannerController = new ScannerController();

