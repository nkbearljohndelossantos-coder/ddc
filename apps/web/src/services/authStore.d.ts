import { UserRole, UserSession } from '../types/ui.js';
export declare class AuthStore {
    private static instance;
    private currentSession;
    private listeners;
    static getInstance(): AuthStore;
    setSession(session: UserSession | null, token?: string): void;
    getSession(): UserSession | null;
    isAuthenticated(): boolean;
    hasRole(...roles: UserRole[]): boolean;
    hasDepartmentAccess(departmentId?: string): boolean;
    subscribe(listener: (session: UserSession | null) => void): () => void;
    private notifyListeners;
}
export declare const authStore: AuthStore;
//# sourceMappingURL=authStore.d.ts.map