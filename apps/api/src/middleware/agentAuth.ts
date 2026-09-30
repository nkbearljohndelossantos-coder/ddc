import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

export interface AuthenticatedAgent {
  agentId: string;
  keyIdentifier: string;
  organizationId: string | null;
  departmentId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      agent?: AuthenticatedAgent;
    }
  }
}

export async function authenticateAgent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const agentSecret = (req.headers['x-agent-secret'] as string) || (req.headers['x-agent-key'] as string);
    const agentIdHeader = (req.headers['x-agent-id'] as string) || req.body?.agentId || 'dcc-background-agent';

    // 1. Direct Pre-Shared Secret Authentication (X-Agent-Secret or Bearer matching AGENT_API_SECRET)
    if (agentSecret && agentSecret === env.AGENT_API_SECRET) {
      req.agent = {
        agentId: String(agentIdHeader),
        keyIdentifier: 'psk-secret',
        organizationId: null,
        departmentId: null,
      };
      next();
      return;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing agent credential' });
      return;
    }

    const token = authHeader.split(' ')[1];

    // 2. Pre-Shared Token Authentication
    if (token === env.AGENT_API_SECRET) {
      req.agent = {
        agentId: String(agentIdHeader),
        keyIdentifier: 'psk-token',
        organizationId: null,
        departmentId: null,
      };
      next();
      return;
    }

    // 3. Cryptographic JWT Verification
    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      keyId: string;
      orgId?: string;
      deptId?: string;
      type?: string;
    };

    if (decoded.type !== 'AGENT') {
      res.status(403).json({ error: 'Forbidden: Invalid token type for agent endpoints' });
      return;
    }

    // Check instant revocation cache
    try {
      const { redis } = await import('../lib/redis.js');
      const isRevokedInRedis = await redis.get(`agent:revoked:${decoded.sub}`);
      if (isRevokedInRedis) {
        res.status(401).json({ error: 'Unauthorized: Agent credential has been revoked' });
        return;
      }
    } catch (e) {
      // Non-fatal if Redis offline
    }

    // Verify agent is still active and credential is not revoked
    const credential = await prisma.agentCredential.findUnique({
      where: { keyIdentifier: decoded.keyId },
      include: { agent: true },
    });

    if (!credential || !credential.isActive || credential.revokedAt || credential.agent.status === 'REVOKED') {
      res.status(401).json({ error: 'Unauthorized: Agent credential has been revoked or deactivated' });
      return;
    }

    req.agent = {
      agentId: credential.agent.id,
      keyIdentifier: credential.keyIdentifier,
      organizationId: credential.agent.organizationId,
      departmentId: credential.agent.departmentId,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Unauthorized: Agent access token expired' });
      return;
    }
    res.status(401).json({ error: 'Unauthorized: Invalid agent token' });
  }
}
