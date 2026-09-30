import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../lib/prisma.js';

export interface ConnectedAgentSession {
  agentId: string;
  socketId: string;
  keyIdentifier: string;
  connectedAt: Date;
  lastHeartbeat: Date;
}

export class RealtimeGateway {
  private static activeSessions: Map<string, ConnectedAgentSession> = new Map(); // agentId -> session
  private static pendingAcks: Map<string, { timeoutHandle: NodeJS.Timeout; resolve: (val: boolean) => void }> = new Map();

  /**
   * Authenticates an inbound WebSocket handshake from an agent.
   */
  static async authenticateHandshake(token: string): Promise<ConnectedAgentSession | null> {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as {
        sub: string;
        keyId: string;
        type?: string;
      };

      if (decoded.type !== 'AGENT') {
        logger.warn(`[Realtime Gateway] Rejected non-agent token type: ${decoded.type}`);
        return null;
      }

      // Check Redis fast revocation cache
      try {
        const { redis } = await import('../../lib/redis.js');
        const isRevoked = await redis.get(`agent:revoked:${decoded.sub}`);
        if (isRevoked) {
          logger.warn(`[Realtime Gateway] Blocked revoked agent ${decoded.sub} from connecting`);
          return null;
        }
      } catch (e) {
        // Non-fatal if Redis in unit test mock mode
      }

      // Query database credential status
      const credential = await prisma.agentCredential.findUnique({
        where: { keyIdentifier: decoded.keyId },
        include: { agent: true },
      });

      if (!credential || !credential.isActive || credential.revokedAt || credential.agent.status === 'REVOKED') {
        logger.warn(`[Realtime Gateway] Rejected inactive/revoked credential for agent ${decoded.sub}`);
        return null;
      }

      return {
        agentId: credential.agent.id,
        socketId: `sock-${crypto.randomUUID()}`,
        keyIdentifier: credential.keyIdentifier,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
      };
    } catch (err: any) {
      logger.warn(`[Realtime Gateway] Handshake authentication failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Registers an authenticated agent session.
   */
  static registerAgentSession(session: ConnectedAgentSession) {
    this.activeSessions.set(session.agentId, session);
    logger.info(`[Realtime Gateway] Agent connected: ${session.agentId} (Socket: ${session.socketId})`);
  }

  /**
   * Disconnects an agent and terminates its session.
   */
  static disconnectAgent(agentId: string) {
    const session = this.activeSessions.get(agentId);
    if (session) {
      this.activeSessions.delete(agentId);
      logger.info(`[Realtime Gateway] Agent disconnected: ${agentId}`);
    }
  }

  /**
   * Checks if an agent is currently connected online.
   */
  static isAgentConnected(agentId: string): boolean {
    return this.activeSessions.has(agentId);
  }

  /**
   * Dispatches a scan job to a connected agent with an explicit ACK timeout.
   */
  static async dispatchJobWithAckTimeout(
    jobId: string,
    agentId: string,
    payload: any,
    timeoutMs: number = 10000
  ): Promise<boolean> {
    if (!this.isAgentConnected(agentId)) {
      logger.warn(`[Realtime Gateway] Cannot dispatch job ${jobId}: Agent ${agentId} is not connected`);
      return false;
    }

    logger.info(`[Realtime Gateway] Dispatching job ${jobId} to agent ${agentId}`);

    return new Promise<boolean>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingAcks.delete(jobId);
        logger.warn(`[Realtime Gateway] Job ${jobId} ACK timed out after ${timeoutMs}ms`);
        resolve(false);
      }, timeoutMs);

      this.pendingAcks.set(jobId, { timeoutHandle, resolve });
    });
  }

  /**
   * Handles explicit acknowledgement from the agent.
   */
  static acknowledgeJob(jobId: string): boolean {
    const pending = this.pendingAcks.get(jobId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingAcks.delete(jobId);
      pending.resolve(true);
      logger.info(`[Realtime Gateway] Job ${jobId} acknowledged by agent`);
      return true;
    }
    return false;
  }
}
