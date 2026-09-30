import { Request, Response, NextFunction } from 'express';
import { complianceService } from './compliance.service.js';

export class ComplianceController {
  // Create Retention Policy
  async createPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const policy = await complianceService.createRetentionPolicy(req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
        permissions: user.permissions,
      });

      res.status(201).json({ policy });
    } catch (error) {
      next(error);
    }
  }

  // Update Retention Policy
  async updatePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const updated = await complianceService.updateRetentionPolicy(id, req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
        permissions: user.permissions,
      });

      res.json({ policy: updated });
    } catch (error) {
      next(error);
    }
  }

  // Get Retention Policies
  async getPolicies(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { departmentId, isActive } = req.query;

      const policies = await complianceService.getRetentionPolicies(
        {
          departmentId: departmentId as string,
          isActive: isActive !== undefined ? isActive === 'true' : undefined,
        },
        {
          id: user.id,
          organizationId: user.organizationId,
          departmentId: user.departmentId,
          roles: user.roles,
          permissions: user.permissions,
        }
      );

      res.json({ policies });
    } catch (error) {
      next(error);
    }
  }

  // Assign Retention Policy to Document
  async assignPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { policyId } = req.body;

      const updated = await complianceService.assignRetentionPolicy(id, policyId, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
        permissions: user.permissions,
      });

      res.json({ document: updated });
    } catch (error) {
      next(error);
    }
  }

  // Controlled Document Deletion Request
  async deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;

      const updated = await complianceService.deleteDocument(id, req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
        permissions: user.permissions,
      });

      res.json({ document: updated });
    } catch (error) {
      next(error);
    }
  }

  // Permanent Document Purge
  async purgeDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;

      const result = await complianceService.purgeDocument(id, req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
        permissions: user.permissions,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Query Immutable Audit Logs
  async queryAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { documentId, userId, action, departmentId, startDate, endDate, page, limit } = req.query;

      const result = await complianceService.queryAuditLogs(
        {
          documentId: documentId as string,
          userId: userId as string,
          action: action as string,
          departmentId: departmentId as string,
          startDate: startDate as string,
          endDate: endDate as string,
          page: page ? parseInt(page as string, 10) : 1,
          limit: limit ? parseInt(limit as string, 10) : 20,
        },
        {
          id: user.id,
          organizationId: user.organizationId,
          departmentId: user.departmentId,
          roles: user.roles,
          permissions: user.permissions,
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const complianceController = new ComplianceController();
