import { NavigationItem, UserRole } from '../types/ui.js';
import { authStore } from '../services/authStore.js';

export const ALL_NAVIGATION_ITEMS: NavigationItem[] = [
  // 1. DOCUMENT TOOL
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'home', section: 'DOCUMENT TOOL' },
  { id: 'documents', label: 'Documents', path: '/documents', icon: 'file-text', section: 'DOCUMENT TOOL' },
  { id: 'search', label: 'Advanced Search', path: '/search', icon: 'search', section: 'DOCUMENT TOOL' },
  { id: 'scan-jobs', label: 'Scan Jobs', path: '/scan-jobs', icon: 'printer', section: 'DOCUMENT TOOL' },
  { id: 'document-details', label: 'Document Details', path: '/document-details', icon: 'file', section: 'DOCUMENT TOOL' },

  // 2. DOCUMENT PROCESSING
  { id: 'ocr-processing', label: 'OCR Processing', path: '/ocr-processing', icon: 'cpu', section: 'DOCUMENT PROCESSING' },
  { id: 'qc', label: 'Quality Control', path: '/qc', icon: 'check-square', section: 'DOCUMENT PROCESSING', requiredRoles: ['QC_REVIEWER', 'QUALITY_CONTROL', 'ACCOUNTING', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },
  { id: 'workflows', label: 'Workflow & Approval', path: '/workflows', icon: 'git-pull-request', section: 'DOCUMENT PROCESSING' },
  { id: 'versioning', label: 'Document Versioning', path: '/versioning', icon: 'layers', section: 'DOCUMENT PROCESSING' },
  { id: 'retention-holds', label: 'Retention & Legal Hold', path: '/retention-holds', icon: 'lock', section: 'DOCUMENT PROCESSING', requiredRoles: ['COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'ACCOUNTING'] },

  // 3. REPORT & COMPLIANCE
  { id: 'reports', label: 'Reports', path: '/reports', icon: 'bar-chart-2', section: 'REPORT & COMPLIANCE', requiredRoles: ['ACCOUNTING', 'AUDITOR', 'COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },
  { id: 'audit', label: 'Audit Trail', path: '/audit', icon: 'shield', section: 'REPORT & COMPLIANCE', requiredRoles: ['AUDITOR', 'COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },
  { id: 'compliance', label: 'Compliance', path: '/compliance', icon: 'check-circle', section: 'REPORT & COMPLIANCE', requiredRoles: ['COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'AUDITOR'] },
  { id: 'compliance-export', label: 'Compliance Export', path: '/compliance-export', icon: 'download', section: 'REPORT & COMPLIANCE', requiredRoles: ['COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'AUDITOR'] },
  { id: 'purge-records', label: 'Retention / Purge Records', path: '/purge-records', icon: 'trash-2', section: 'REPORT & COMPLIANCE', requiredRoles: ['COMPLIANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },

  // 4. SYSTEM OPERATION (ADMIN / SUPER_ADMIN ONLY)
  { id: 'sre', label: 'SRE Operations', path: '/sre', icon: 'sliders', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'health', label: 'System Health', path: '/health', icon: 'activity', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'workers', label: 'Worker Monitoring', path: '/workers', icon: 'server', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'incidents', label: 'Incidents', path: '/incidents', icon: 'alert-circle', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'maintenance', label: 'Maintenance Mode', path: '/maintenance', icon: 'tool', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'notifications', label: 'Notifications', path: '/notifications', icon: 'bell', section: 'SYSTEM OPERATION' },
  { id: 'dr', label: 'Disaster Recovery', path: '/dr', icon: 'refresh-cw', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN'] },
  { id: 'dead-letter', label: 'Dead-Letter Queue', path: '/dead-letter', icon: 'inbox', section: 'SYSTEM OPERATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },

  // 5. ADMINISTRATION (ADMIN / SUPER_ADMIN ONLY)
  { id: 'users', label: 'Users', path: '/users', icon: 'users', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },
  { id: 'roles', label: 'Roles & Permissions', path: '/roles', icon: 'key', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'departments', label: 'Departments', path: '/departments', icon: 'grid', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },
  { id: 'org-settings', label: 'Organization Settings', path: '/org-settings', icon: 'sliders', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'configuration', label: 'Configuration', path: '/configuration', icon: 'file-code', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'config-history', label: 'Configuration History', path: '/config-history', icon: 'clock', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN'] },
  { id: 'admin', label: 'System Administration', path: '/admin', icon: 'settings', section: 'ADMINISTRATION', requiredRoles: ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'] },
];

export class NavigationShell {
  /**
   * Generates authorized navigation items based on current active user roles.
   */
  public static getAuthorizedNavItems(): NavigationItem[] {
    const session = authStore.getSession();
    if (!session) return [];

    return ALL_NAVIGATION_ITEMS.filter((item) => {
      if (!item.requiredRoles || item.requiredRoles.length === 0) return true;
      return authStore.hasRole(...item.requiredRoles);
    });
  }

  /**
   * Renders accessible semantic HTML navigation shell with collapsible accordion sections.
   */
  public static renderNavHtml(currentPath: string): string {
    const items = this.getAuthorizedNavItems();
    const session = authStore.getSession();

    // Group items by section
    const sections: Record<string, NavigationItem[]> = {};
    for (const item of items) {
      const sec = item.section || 'DOCUMENT TOOL';
      if (!sections[sec]) sections[sec] = [];
      sections[sec].push(item);
    }

    const sectionsHtml = Object.entries(sections)
      .map(([sectionTitle, secItems]) => {
        const containsCurrent = secItems.some((i) => i.path === currentPath);
        const sectionId = sectionTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const linksHtml = secItems
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
          <div class="nav-accordion-section ${containsCurrent ? 'expanded' : ''}" id="section-${sectionId}" role="group" aria-label="${sectionTitle}">
            <button class="nav-accordion-header" onclick="toggleSection('${sectionId}')" aria-expanded="${containsCurrent ? 'true' : 'false'}">
              <span class="accordion-title">${sectionTitle}</span>
              <span class="accordion-chevron" aria-hidden="true">${containsCurrent ? '▾' : '▸'}</span>
            </button>
            <ul class="nav-accordion-body" role="menubar" style="display: ${containsCurrent ? 'block' : 'none'};">
              ${linksHtml}
            </ul>
          </div>
        `;
      })
      .join('\n');

    return `
      <aside class="app-sidebar" role="navigation" aria-label="Main Navigation">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <span class="brand-title">NKB Manufacturing</span>
            <span class="brand-subtitle">Document Control Center</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${sectionsHtml}
        </nav>
        <div class="sidebar-footer">
          <div class="user-badge" role="status">
            <span class="user-name">${session?.fullName || 'Authenticated User'}</span>
            <span class="user-dept">${session?.departmentId ? `Dept: ${session.departmentId}` : (session?.roles ? session.roles.join(', ') : 'HQ Staff')}</span>
          </div>
        </div>
      </aside>
    `;
  }
}
