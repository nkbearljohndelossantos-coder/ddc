import { Request, Response, NextFunction } from 'express';
import { jobService } from './job.service.js';

export class JobController {
  // Operator: Create Scan Job
  async createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await jobService.createScanJob(req.body, user.id);
      res.status(result.isIdempotentReplay ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agent: Explicit Job Acknowledgement
  async acknowledgeJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent!;
      const result = await jobService.acknowledgeJob(req.body, agent.agentId);
      res.json({ job: result });
    } catch (error) {
      next(error);
    }
  }

  // Agent / Worker: Update Job Status
  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const agentId = req.agent?.agentId;
      const result = await jobService.updateJobStatus(id, req.body, agentId);
      res.json({ job: result });
    } catch (error) {
      next(error);
    }
  }

  // User: Cancel Job
  async cancelJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user!;
      const result = await jobService.cancelJob(id, req.body, user.id);
      res.json({ job: result });
    } catch (error) {
      next(error);
    }
  }

  // User: Get Job Details & Audit Log
  async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await jobService.getJob(id);
      res.json({ job: result });
    } catch (error) {
      next(error);
    }
  }

  // User: List Jobs
  async listJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, scannerId, agentId } = req.query;
      const result = await jobService.listJobs({
        status: status as string,
        scannerId: scannerId as string,
        agentId: agentId as string,
      });
      res.json({ jobs: result });
    } catch (error) {
      next(error);
    }
  }
}

export const jobController = new JobController();
