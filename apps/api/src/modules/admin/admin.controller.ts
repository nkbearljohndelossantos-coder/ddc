import { Request, Response, NextFunction } from 'express';
import { adminService } from './admin.service.js';
import { drService } from './dr.service.js';
import { alertService } from './alert.service.js';
import { settingsService } from './settings.service.js';

export class AdminController {
  // Create Organization
  async createOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const org = await adminService.createOrganization(req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.status(201).json({ organization: org });
    } catch (err) { next(err); }
  }

  // Create Department
  async createDept(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const dept = await adminService.createDepartment(req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.status(201).json({ department: dept });
    } catch (err) { next(err); }
  }

  // Create User
  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await adminService.createUser(req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.status(201).json({ user: result });
    } catch (err) { next(err); }
  }

  // List Users
  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const users = await adminService.listUsers({
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.json({ users });
    } catch (err) { next(err); }
  }

  // Update User
  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await adminService.updateUser(id, req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  // Delete User
  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await adminService.deleteUser(id, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  // Public Self-Registration via link
  async publicRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await adminService.publicRegisterUser(req.body);
      res.status(201).json({ user, message: 'Registration successful! You may now sign in.' });
    } catch (err) { next(err); }
  }

  // Assign Roles to User
  async assignRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await adminService.assignRoles(id, req.body, {
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  // Fleet Overview
  async getFleet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const overview = await adminService.getFleetOverview({
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.json({ fleet: overview });
    } catch (err) { next(err); }
  }

  // Recover Stale Jobs
  async recoverStaleJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.recoverStaleJobs();
      res.json(result);
    } catch (err) { next(err); }
  }

  // Get Settings
  async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await settingsService.getSettings();
      res.json({ settings });
    } catch (err) { next(err); }
  }

  // Update Setting
  async updateSetting(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const setting = await settingsService.updateSetting(req.body, user.id);
      res.json({ setting });
    } catch (err) { next(err); }
  }

  // Record Backup
  async recordBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await drService.recordBackupMetadata(req.body, user.id);
      res.status(201).json({ backup: result });
    } catch (err) { next(err); }
  }

  // Verify Backup
  async verifyBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await drService.verifyBackup(id, user.id);
      res.json({ backup: result });
    } catch (err) { next(err); }
  }

  // Run Integrity Sweep
  async runIntegritySweep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchSize = req.query.batchSize ? parseInt(req.query.batchSize as string, 10) : 50;
      const report = await drService.runDataIntegritySweep(batchSize);
      res.json({ report });
    } catch (err) { next(err); }
  }

  // Get Alerts
  async getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { severity, isResolved, page, limit } = req.query;
      const result = await alertService.getAlerts({
        severity: severity as string,
        isResolved: isResolved !== undefined ? isResolved === 'true' : undefined,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 20,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  // Resolve Alert
  async resolveAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { notes } = req.body;
      const resolved = await alertService.resolveAlert(id, user.id, notes);
      res.json({ alert: resolved });
    } catch (err) { next(err); }
  }

  // Danger Zone: Reset System Data (Back to Zero)
  async resetData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await adminService.resetSystemData({
        id: user.id,
        organizationId: user.organizationId,
        departmentId: user.departmentId,
        roles: user.roles,
      });
      res.json({
        success: true,
        message: 'System documents and scan operational data successfully purged back to zero.',
        purged: result,
      });
    } catch (err) { next(err); }
  }
}

export const adminController = new AdminController();
