import { Router } from 'express';
import { qcController } from './qc.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { qcReviewActionSchema } from './qc.schema.js';

export const qcRouter = Router();

// Reviewer: Get QC Queue
qcRouter.get(
  '/queue',
  authenticate,
  requirePermission('documents:qc', 'documents:write'),
  (req, res, next) => qcController.getQueue(req, res, next)
);

// Reviewer: Get Document Details with OCR Bounding Boxes
qcRouter.get(
  '/documents/:id',
  authenticate,
  requirePermission('documents:qc', 'documents:write'),
  (req, res, next) => qcController.getDetails(req, res, next)
);

// Reviewer: Submit QC Review / Correction / Approval
qcRouter.post(
  '/documents/:id/review',
  authenticate,
  requirePermission('documents:qc', 'documents:write'),
  validate(qcReviewActionSchema),
  (req, res, next) => qcController.submitReview(req, res, next)
);
