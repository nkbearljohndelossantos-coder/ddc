import { Request, Response, NextFunction } from 'express';
import { scannerService } from './scanner.service.js';

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
}

export const scannerController = new ScannerController();
