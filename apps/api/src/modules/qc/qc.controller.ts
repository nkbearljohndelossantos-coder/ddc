import { Request, Response, NextFunction } from 'express';
import { qcService } from './qc.service.js';

export class QcController {
  // Reviewer: Get QC Queue
  async getQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { page, limit, departmentId } = req.query;

      const result = await qcService.getQcQueue(
        {
          page: page ? parseInt(page as string, 10) : 1,
          limit: limit ? parseInt(limit as string, 10) : 20,
          departmentId: departmentId as string,
        },
        {
          id: user.id,
          organizationId: user.organizationId,
          departmentId: user.departmentId,
          roles: user.roles,
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Reviewer: Get QC Document Details
  async getDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;

      const doc = await qcService.getQcDocumentDetails(id, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });

      res.json({ document: doc });
    } catch (error) {
      next(error);
    }
  }

  // Reviewer: Submit QC Review Action
  async submitReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;

      const updated = await qcService.submitQcReview(id, req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });

      res.json({ document: updated });
    } catch (error) {
      next(error);
    }
  }
}

export const qcController = new QcController();
