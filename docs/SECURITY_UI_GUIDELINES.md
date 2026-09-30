# DCC ENTERPRISE PLATFORM — SECURITY & UI GUIDELINES

## 1. Zero Trust UI Principles
- **Client-Side RBAC**: Used strictly for UX customization (hiding unauthorized navigation elements). The backend API is always authoritative and performs complete authorization validation on every request.
- **Credential Masking**: Secrets, database URLs, JWT keys, and agent pairing tokens must never be rendered in DOM elements, query strings, or error dialogs.
- **Legal Hold Enforcement**: When a document is under active litigation hold, UI deletion and purge controls are locked and display compliance warnings.
- **XSS & Injection Protection**: All dynamic text (metadata, titles, OCR content) is sanitized before rendering.
