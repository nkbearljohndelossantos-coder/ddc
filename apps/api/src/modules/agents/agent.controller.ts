import { Request, Response, NextFunction } from 'express';
import { agentService } from './agent.service.js';

export class AgentController {
  // Admin: Create pairing token
  async createPairingToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await agentService.createPairingToken(req.body, user.id, user.organizationId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Admin: List pairing tokens
  async listPairingTokens(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await agentService.listPairingTokens(user.organizationId);
      res.json({ tokens: result });
    } catch (error) {
      next(error);
    }
  }

  // Agent: Register with pairing token
  async registerAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await agentService.registerAgent(req.body, req.ip);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agent: Exchange credentials for short-lived JWT
  async exchangeToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await agentService.exchangeToken(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Admin: Approve agent
  async approveAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await agentService.approveAgent(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Admin: Revoke agent
  async revokeAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await agentService.revokeAgent(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Admin: Rotate agent credentials
  async rotateCredential(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await agentService.rotateCredential(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Admin / User: List agents
  async listAgents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await agentService.listAgents(user.organizationId);
      res.json({ agents: result });
    } catch (error) {
      next(error);
    }
  }

  // Admin / User: Get agent
  async getAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await agentService.getAgent(id);
      res.json({ agent: result });
    } catch (error) {
      next(error);
    }
  }

  // Agent: Send Heartbeat
  async heartbeat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent!;
      const result = await agentService.processHeartbeat(agent.agentId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Web App / Admin: Get current agent status & telemetry
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await agentService.getAgentStatus();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agent: Ingest Document into DCC Repository
  async ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent;
      const result = await agentService.ingestDocument(req.body, agent?.agentId);
      const statusCode = result.duplicate ? 409 : 201;
      res.status(statusCode).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agent: Sync discovered scanners and capabilities
  async syncScanners(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent!;
      const result = await agentService.syncScanners(agent.agentId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const agentController = new AgentController();
