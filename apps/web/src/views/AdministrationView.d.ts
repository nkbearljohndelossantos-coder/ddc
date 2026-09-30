export interface ScannerAgentInfo {
    id: string;
    scannerModel: string;
    status: 'ONLINE' | 'OFFLINE';
    ipAddress: string;
    lastHeartbeat: string;
}
export interface DrDashboardStatus {
    observedRpoMinutes: number;
    observedRtoMinutes: number;
    rpoTargetMinutes: number;
    rtoTargetMinutes: number;
    lastDrillStatus: 'SUCCESS' | 'WARNING' | 'FAILED';
    lastDrillTimestamp: string;
}
export declare class AdministrationView {
    /**
     * Renders the enterprise administration, scanner fleet, and DR status views.
     */
    static render(agents: ScannerAgentInfo[], dr: DrDashboardStatus): string;
}
//# sourceMappingURL=AdministrationView.d.ts.map