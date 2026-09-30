import { NavigationItem } from '../types/ui.js';
export declare const ALL_NAVIGATION_ITEMS: NavigationItem[];
export declare class NavigationShell {
    /**
     * Generates authorized navigation items based on current active user roles.
     */
    static getAuthorizedNavItems(): NavigationItem[];
    /**
     * Renders accessible semantic HTML navigation shell.
     */
    static renderNavHtml(currentPath: string): string;
}
//# sourceMappingURL=NavigationShell.d.ts.map