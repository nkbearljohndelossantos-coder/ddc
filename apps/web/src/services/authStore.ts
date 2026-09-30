import { UserRole, UserSession } from '../types/ui.js';
import { apiClient } from './apiClient.js';

export class AuthStore {
  private static instance: AuthStore;
  private currentSession: UserSession | null = null;
  private listeners: Array<(session: UserSession | null) => void> = [];

  public static getInstance(): AuthStore {
    if (!AuthStore.instance) {
      AuthStore.instance = new AuthStore();
    }
    return AuthStore.instance;
  }

  setSession(session: UserSession | null, token?: string) {
    this.currentSession = session;
    if (token) {
      apiClient.setAccessToken(token);
    } else if (!session) {
      apiClient.setAccessToken(null);
    }
    this.notifyListeners();
  }

  getSession(): UserSession | null {
    return this.currentSession;
  }

  isAuthenticated(): boolean {
    return this.currentSession !== null;
  }

  hasRole(...roles: UserRole[]): boolean {
    if (!this.currentSession) return false;
    if (this.currentSession.roles.includes('SUPER_ADMIN')) return true;
    return roles.some((r) => this.currentSession!.roles.includes(r));
  }

  hasDepartmentAccess(departmentId?: string): boolean {
    if (!this.currentSession) return false;
    if (this.currentSession.roles.includes('SUPER_ADMIN')) return true;
    if (!departmentId) return true;
    return this.currentSession.departmentId === departmentId;
  }

  subscribe(listener: (session: UserSession | null) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.currentSession);
    }
  }
}

export const authStore = AuthStore.getInstance();
