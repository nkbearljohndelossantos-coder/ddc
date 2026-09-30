import { apiClient } from './apiClient.js';
export class AuthStore {
    static instance;
    currentSession = null;
    listeners = [];
    static getInstance() {
        if (!AuthStore.instance) {
            AuthStore.instance = new AuthStore();
        }
        return AuthStore.instance;
    }
    setSession(session, token) {
        this.currentSession = session;
        if (token) {
            apiClient.setAccessToken(token);
        }
        else if (!session) {
            apiClient.setAccessToken(null);
        }
        this.notifyListeners();
    }
    getSession() {
        return this.currentSession;
    }
    isAuthenticated() {
        return this.currentSession !== null;
    }
    hasRole(...roles) {
        if (!this.currentSession)
            return false;
        if (this.currentSession.roles.includes('SUPER_ADMIN'))
            return true;
        return roles.some((r) => this.currentSession.roles.includes(r));
    }
    hasDepartmentAccess(departmentId) {
        if (!this.currentSession)
            return false;
        if (this.currentSession.roles.includes('SUPER_ADMIN'))
            return true;
        if (!departmentId)
            return true;
        return this.currentSession.departmentId === departmentId;
    }
    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }
    notifyListeners() {
        for (const listener of this.listeners) {
            listener(this.currentSession);
        }
    }
}
export const authStore = AuthStore.getInstance();
//# sourceMappingURL=authStore.js.map