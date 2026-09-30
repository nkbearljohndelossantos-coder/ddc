# DCC ENTERPRISE PLATFORM — FRONTEND ARCHITECTURE & SPECIFICATION

## 1. Overview
The DCC Enterprise Frontend (`apps/web`) is a high-performance, accessible (WCAG 2.1 AA) Single Page Application interfacing with the DCC REST API and real-time WebSocket pipelines.

## 2. Architecture & Service Layer
- `src/types/ui.ts`: TypeScript contracts for User Sessions, RBAC Roles, Document Lifecycles, and Views.
- `src/services/apiClient.ts`: Authenticated HTTP client with token handling, correlation headers (`X-Request-ID`), and safe error parsing.
- `src/services/authStore.ts`: Session store managing user identity, role-based checks (`hasRole`), and department boundaries (`hasDepartmentAccess`).
- `src/services/realTimeService.ts`: Centralized WebSocket connection manager with exponential backoff (1s $\rightarrow$ 30s) and typed event dispatching.

## 3. UI Views & Screens
- `DashboardView`: Enterprise KPI cards, RPO/RTO metrics, active alerts, and incident counters.
- `DocumentListView`: Document repository table with lifecycle status badges and `[PURGED]` controls locking.
- `DocumentDetailView`: Metadata explorer, page previews, and version history with restore actions.
- `AdvancedSearchView`: Multi-criteria search form with active chips and saved search presets.
- `ScanJobsView`: Scanner fleet table and real-time scan job progress meters.
- `QcWorkspaceView`: Side-by-side scanned page image viewer and OCR text correction editor.
- `WorkflowTasksView`: Task execution queue with claim, reassign, approve, and reject controls.
- `NotificationsView`: User notification inbox with read/unread states and target document links.
- `ComplianceView`: Litigation legal hold warning banners and retention schedule details.
- `AdministrationView`: Scanner fleet management and Disaster Recovery dashboard.
- `SreOperationsView`: SRE Console (`/admin/operations`) with Incident lifecycle management, SLO/SLA targets, and maintenance mode indicators.
- `AuditComplianceView`: Compliance audit log viewer and JSON/CSV export generator.

## 4. Security & RBAC Enforcement
- **Client-Side Navigation Filtering**: Hides unauthorized routes and actions to optimize UX while backend API enforces authoritative RBAC.
- **Secret Redaction**: Zero tokens, passwords, encryption keys, or connection strings in logs or DOM elements.
- **Legal Hold Lockout**: Disables deletion/purge actions when a document is protected under active litigation hold.
