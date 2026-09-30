import { z } from 'zod';

export const createPairingTokenSchema = z.object({
  departmentId: z.string().uuid().optional(),
  expiresInMinutes: z.number().int().min(1).max(60).default(15),
});

export const registerAgentSchema = z.object({
  pairingToken: z.string().min(16, 'Pairing token is required'),
  agentName: z.string().min(2),
  machineName: z.string().min(1),
  osVersion: z.string().min(1),
  version: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const agentTokenExchangeSchema = z.object({
  agentId: z.string().uuid(),
  keyIdentifier: z.string().min(1),
  secret: z.string().min(16),
});

export const agentHeartbeatSchema = z.object({
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  machineName: z.string().optional(),
  osVersion: z.string().optional(),
  version: z.string().optional(),
  timestamp: z.string(),
  status: z.enum(['ONLINE', 'OFFLINE', 'BUSY', 'ERROR', 'SYNCING']),
  telemetry: z.record(z.any()).optional(),
});

export const agentIngestSchema = z.object({
  title: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative(),
  sha256Hash: z.string().min(16),
  documentType: z.string().default('INCOMING_SCAN'),
  fileData: z.string().optional(),
  originalFileName: z.string().min(1),
  agentId: z.string().optional(),
  machineName: z.string().optional(),
  departmentId: z.string().optional(),
});

export const syncScannersSchema = z.object({
  scanners: z.array(
    z.object({
      localScannerId: z.string().min(1),
      scannerName: z.string().min(1),
      model: z.string().default('Generic Scanner'),
      serialNumber: z.string().optional(),
      driverType: z.enum(['TWAIN', 'WIA', 'NETWORK_ESCL', 'CUSTOM']),
      status: z.enum(['READY', 'BUSY', 'OFFLINE', 'ERROR']),
      capabilities: z.record(z.any()).optional(),
      lastError: z.string().optional(),
    })
  ),
});

export type CreatePairingTokenInput = z.infer<typeof createPairingTokenSchema>;
export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;
export type AgentTokenExchangeInput = z.infer<typeof agentTokenExchangeSchema>;
export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>;
export type AgentIngestInput = z.infer<typeof agentIngestSchema>;
export type SyncScannersInput = z.infer<typeof syncScannersSchema>;
