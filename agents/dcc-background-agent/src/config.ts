import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface AgentConfig {
  apiUrl: string;
  agentId: string;
  agentName: string;
  machineName: string;
  osVersion: string;
  version: string;
  watchFolder: string;
  processedFolder: string;
  failedFolder: string;
  logFolder: string;
  queueFilePath: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  maxRetries: number;
  authToken: string;
  rejectUnauthorizedTls: boolean;
}

export function loadConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const defaultBaseDir = process.platform === 'win32' ? 'C:\\DCC' : path.join(os.homedir(), 'DCC');

  // Check for local production configuration file (e.g. C:\DCC\agent-config.json)
  let fileConfig: any = {};
  const externalConfigFile = process.env.DCC_CONFIG_FILE || path.join(defaultBaseDir, 'agent-config.json');
  if (fs.existsSync(externalConfigFile)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(externalConfigFile, 'utf8'));
    } catch {}
  }

  const watchFolder =
    overrides?.watchFolder ||
    process.env.DCC_WATCH_FOLDER ||
    fileConfig.watchFolder ||
    path.join(defaultBaseDir, 'Incoming');

  const processedFolder =
    overrides?.processedFolder ||
    process.env.DCC_PROCESSED_FOLDER ||
    fileConfig.processedFolder ||
    path.join(defaultBaseDir, 'Processed');

  const failedFolder =
    overrides?.failedFolder ||
    process.env.DCC_FAILED_FOLDER ||
    fileConfig.failedFolder ||
    path.join(defaultBaseDir, 'Failed');

  const logFolder =
    overrides?.logFolder ||
    process.env.DCC_LOG_FOLDER ||
    fileConfig.logFolder ||
    path.join(defaultBaseDir, 'logs');

  const dataDir = path.resolve(process.cwd(), 'data');

  const apiUrl =
    overrides?.apiUrl ||
    process.env.DCC_API_URL ||
    fileConfig.apiUrl ||
    'http://localhost:4000/api/v1';

  const authToken =
    overrides?.authToken ||
    process.env.DCC_AGENT_TOKEN ||
    process.env.DCC_AGENT_SECRET ||
    fileConfig.authToken ||
    fileConfig.agentSecret ||
    'dcc-enterprise-agent-default-secret';

  return {
    apiUrl,
    agentId:
      overrides?.agentId ||
      process.env.DCC_AGENT_ID ||
      fileConfig.agentId ||
      `agent-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    agentName:
      overrides?.agentName ||
      process.env.DCC_AGENT_NAME ||
      fileConfig.agentName ||
      `DCC-Agent-${os.hostname()}`,
    machineName: os.hostname(),
    osVersion: `${os.type()} ${os.release()} (${os.arch()})`,
    version: '1.2.0',
    watchFolder,
    processedFolder,
    failedFolder,
    logFolder,
    queueFilePath:
      overrides?.queueFilePath ||
      process.env.DCC_QUEUE_FILE ||
      fileConfig.queueFilePath ||
      path.join(dataDir, 'agent-queue.json'),
    pollIntervalMs:
      overrides?.pollIntervalMs ||
      parseInt(process.env.DCC_POLL_INTERVAL_MS || String(fileConfig.pollIntervalMs || '3000'), 10),
    heartbeatIntervalMs:
      overrides?.heartbeatIntervalMs ||
      parseInt(process.env.DCC_HEARTBEAT_INTERVAL_MS || String(fileConfig.heartbeatIntervalMs || '10000'), 10),
    maxRetries:
      overrides?.maxRetries ||
      parseInt(process.env.DCC_MAX_RETRIES || String(fileConfig.maxRetries || '5'), 10),
    authToken,
    rejectUnauthorizedTls: process.env.DCC_REJECT_UNAUTHORIZED !== '0',
    ...overrides,
  };
}
