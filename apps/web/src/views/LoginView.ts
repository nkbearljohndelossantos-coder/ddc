export interface LoginViewOptions {
  error?: string;
  email?: string;
  loading?: boolean;
  redirectPath?: string;
}

export class LoginView {
  /**
   * Renders the production enterprise login view.
   */
  public static render(options: LoginViewOptions = {}): string {
    const errorAlert = options.error
      ? `<div class="login-alert error" role="alert" aria-live="assertive">${options.error}</div>`
      : '';

    const loadingAttr = options.loading ? 'disabled aria-busy="true"' : '';
    const buttonText = options.loading ? 'Signing in...' : 'Sign In';

    return `
      <div class="login-container" role="main" aria-label="NKB Manufacturing Authentication">
        <div class="login-card">
          <div class="login-header">
            <div class="login-brand">
              <span class="brand-logo" aria-hidden="true">⚙️</span>
              <span class="brand-company">NKB MANUFACTURING</span>
            </div>
            <h1 class="login-title">Document Control Center</h1>
            <p class="login-subtitle">Enterprise Document Capture, Quality Control & Compliance</p>
          </div>

          ${errorAlert}

          <form id="login-form" class="login-form" method="POST" action="/api/v1/auth/login" novalidate>
            <input type="hidden" id="redirect-url" name="redirect" value="${options.redirectPath || '/dashboard'}" />

            <div class="form-group">
              <label for="login-email" class="form-label">Work Email / Username</label>
              <input 
                type="email" 
                id="login-email" 
                name="email" 
                class="form-input" 
                placeholder="name@nkbmanufacturing.com" 
                value="${options.email || ''}" 
                required 
                autocomplete="username" 
                aria-required="true"
                ${loadingAttr}
              />
            </div>

            <div class="form-group">
              <div class="password-label-row">
                <label for="login-password" class="form-label">Password</label>
                <button type="button" id="toggle-password-btn" class="toggle-password-link" aria-label="Toggle password visibility">Show</button>
              </div>
              <div class="password-input-wrapper">
                <input 
                  type="password" 
                  id="login-password" 
                  name="password" 
                  class="form-input" 
                  placeholder="••••••••••••" 
                  required 
                  autocomplete="current-password" 
                  aria-required="true"
                  ${loadingAttr}
                />
              </div>
            </div>

            <div class="form-row-remember">
              <label class="checkbox-label">
                <input type="checkbox" id="remember-me" name="rememberMe" />
                <span>Keep session active</span>
              </label>
            </div>

            <button type="submit" id="login-submit-btn" class="btn btn-primary btn-block" ${loadingAttr}>
              ${buttonText}
            </button>
          </form>

          <footer class="login-footer">
            <span class="security-notice" role="status">Protected by Enterprise Hardware-Enforced RBAC & Audit Trails</span>
            <span class="system-domain">dcc.nkbmanufacturing.com</span>
          </footer>
        </div>
      </div>
    `;
  }
}
