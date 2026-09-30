export type RealTimeEventType =
  | 'JOB_CREATED'
  | 'JOB_DISPATCHED'
  | 'SCAN_PROGRESS'
  | 'UPLOAD_COMPLETED'
  | 'OCR_COMPLETED'
  | 'QC_REQUIRED'
  | 'WORKFLOW_TASK_ASSIGNED'
  | 'WORKFLOW_TASK_OVERDUE'
  | 'ALERT_TRIGGERED'
  | 'INCIDENT_CREATED'
  | 'INCIDENT_UPDATED';

export interface RealTimeMessage {
  type: RealTimeEventType;
  payload: any;
  timestamp: string;
}

export class RealTimeService {
  private static instance: RealTimeService;
  private socket: any = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectDelayMs = 30000;
  private listeners = new Map<RealTimeEventType | string, Set<(payload: any) => void>>();

  public static getInstance(): RealTimeService {
    if (!RealTimeService.instance) {
      RealTimeService.instance = new RealTimeService();
    }
    return RealTimeService.instance;
  }

  public connect(url: string, token?: string) {
    if (this.isConnected) return;

    try {
      // Create connection or simulate in test environments
      this.isConnected = true;
      this.reconnectAttempts = 0;
    } catch {
      this.handleDisconnect();
    }
  }

  public handleDisconnect() {
    this.isConnected = false;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelayMs);
    this.reconnectAttempts++;
    return delay;
  }

  public subscribe(eventType: RealTimeEventType | string, callback: (payload: any) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);

    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  public dispatchEvent(eventType: RealTimeEventType | string, payload: any) {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }

  public getConnectionStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  public disconnect() {
    this.isConnected = false;
    this.listeners.clear();
  }
}

export const realTimeService = RealTimeService.getInstance();
