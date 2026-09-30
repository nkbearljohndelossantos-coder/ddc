import { authStore } from '../services/authStore.js';
export const ALL_NAVIGATION_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'home' },
    { id: 'documents', label: 'Documents', path: '/documents', icon: 'file-text' },
    { id: 'search', label: 'Advanced Search', path: '/search', icon: 'search' },
    { id: 'qc', label: 'QC Workspace', path: '/qc', icon: 'check-square', requiredRoles: ['QC_REVIEWER', 'SUPER_ADMIN', 'ORG_ADMIN'] },
    { id: 'workflows', label: 'Workflows & Tasks', path: '/workflows', icon: 'git-pull-request' },
    { id: 'compliance', label: 'Compliance & Legal Hold', path: '/compliance', icon: 'shield', requiredRoles: ['COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ORG_ADMIN', 'AUDITOR'] },
    { id: 'admin', label: 'Administration & Fleet', path: '/admin', icon: 'settings', requiredRoles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
    { id: 'dr', label: 'Disaster Recovery', path: '/dr', icon: 'refresh-cw', requiredRoles: ['SUPER_ADMIN'] },
    { id: 'reports', label: 'Reports', path: '/reports', icon: 'bar-chart-2', requiredRoles: ['SUPER_ADMIN', 'ORG_ADMIN', 'AUDITOR'] },
];
export class NavigationShell {
    /**
     * Generates authorized navigation items based on current active user roles.
     */
    static getAuthorizedNavItems() {
        const session = authStore.getSession();
        if (!session)
            return [];
        return ALL_NAVIGATION_ITEMS.filter((item) => {
            if (!item.requiredRoles || item.requiredRoles.length === 0)
                return true;
            return authStore.hasRole(...item.requiredRoles);
        });
    }
    /**
     * Renders accessible semantic HTML navigation shell.
     */
    static renderNavHtml(currentPath) {
        const items = this.getAuthorizedNavItems();
        const session = authStore.getSession();
        const linksHtml = items
            .map((item) => {
            const isCurrent = currentPath === item.path;
            return `
          <li class="nav-item">
            <a href="${item.path}" 
               class="nav-link ${isCurrent ? 'active' : ''}" 
               ${isCurrent ? 'aria-current="page"' : ''}
               role="menuitem">
              <span class="nav-icon icon-${item.icon}" aria-hidden="true"></span>
              <span class="nav-label">${item.label}</span>
            </a>
          </li>
        `;
        })
            .join('\n');
        return `
      <aside class="app-sidebar" role="navigation" aria-label="Main Navigation">
        <div class="sidebar-header">
          <h1 class="app-title">DCC Enterprise</h1>
        </div>
        <nav class="sidebar-nav">
          <ul class="nav-list" role="menubar">
            ${linksHtml}
          </ul>
        </nav>
        <div class="sidebar-footer">
          <div class="user-badge" role="status">
            <span class="user-name">${session?.fullName || 'Guest'}</span>
            <span class="user-dept">${session?.departmentId ? `Dept: ${session.departmentId}` : 'Enterprise'}</span>
          </div>
        </div>
      </aside>
    `;
    }
}
//# sourceMappingURL=NavigationShell.js.map