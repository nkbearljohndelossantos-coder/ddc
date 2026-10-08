import { Router } from 'express';
import { documentController } from './document.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

export const documentRouter = Router();

// List Documents
documentRouter.get(
  '/',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.list(req, res, next)
);

// Ingest / Create Document
documentRouter.post(
  '/',
  authenticate,
  requirePermission('documents:write', 'scan:execute'),
  (req, res, next) => documentController.create(req, res, next)
);

// Batch Ingest / Create Multiple Documents
documentRouter.post(
  '/batch',
  authenticate,
  requirePermission('documents:write', 'scan:execute'),
  (req, res, next) => documentController.createBatch(req, res, next)
);

// Full-Text Search
documentRouter.get(
  '/search',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.search(req, res, next)
);

// Smart OCR + AI Rules Auto-Tag Analyzer (Single File / Text)
documentRouter.post(
  '/auto-tag-analyze',
  authenticate,
  (req, res, next) => documentController.autoTagAnalyze(req, res, next)
);

// Smart OCR + AI Rules Bulk Auto-Tag All Documents
documentRouter.post(
  '/auto-tag-all',
  authenticate,
  (req, res, next) => documentController.autoTagAll(req, res, next)
);

// Get Document by ID
documentRouter.get(
  '/:id',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.getById(req, res, next)
);

// Get Document OCR Details
documentRouter.get(
  '/:id/ocr',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.getOcr(req, res, next)
);

// Get Document Pages
documentRouter.get(
  '/:id/pages',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.getPages(req, res, next)
);

// Get Processing Status
documentRouter.get(
  '/:id/processing-status',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.getProcessingStatus(req, res, next)
);

// Download Document (Searchable PDF or Source Scan)
documentRouter.get(
  '/:id/download',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.download(req, res, next)
);

// Preview Document File directly (Inline for browser iframe / previewer)
documentRouter.get(
  '/:id/preview',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.preview(req, res, next)
);

// Preview Page
documentRouter.get(
  '/:id/pages/:pageNumber/preview',
  authenticate,
  requirePermission('documents:read'),
  (req, res, next) => documentController.previewPage(req, res, next)
);

// Update Metadata & Tags
documentRouter.put(
  '/:id/metadata',
  authenticate,
  requirePermission('documents:write'),
  (req, res, next) => documentController.updateMetadata(req, res, next)
);

// Set / Release Legal Hold
documentRouter.post(
  '/:id/legal-hold',
  authenticate,
  requirePermission('documents:write', 'documents:delete'),
  (req, res, next) => documentController.setLegalHold(req, res, next)
);

// Delete Single Page from Document Dossier & Re-merge PDF
documentRouter.delete(
  '/:id/pages/:pageNumber',
  authenticate,
  requirePermission('documents:delete', 'documents:write'),
  (req, res, next) => documentController.deletePage(req, res, next)
);

// Delete Entire Document Dossier
documentRouter.delete(
  '/:id',
  authenticate,
  requirePermission('documents:delete'),
  (req, res, next) => documentController.delete(req, res, next)
);

