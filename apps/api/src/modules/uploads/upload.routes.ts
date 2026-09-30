import express, { Router } from 'express';
import { uploadController } from './upload.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticateAgent } from '../../middleware/agentAuth.js';
import {
  createUploadSessionSchema,
  completeUploadSessionSchema,
} from './upload.schema.js';

export const uploadRouter = Router();

// Agent: Create or Resume Session
uploadRouter.post(
  '/sessions',
  authenticateAgent,
  validate(createUploadSessionSchema),
  (req, res, next) => uploadController.createSession(req, res, next)
);

// Agent: Upload Chunk (Accepts raw binary stream)
uploadRouter.put(
  '/sessions/:id/chunks/:chunkNumber',
  authenticateAgent,
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  (req, res, next) => uploadController.uploadChunk(req, res, next)
);

// Agent: Complete Session & Trigger Finalization
uploadRouter.post(
  '/sessions/:id/complete',
  authenticateAgent,
  validate(completeUploadSessionSchema),
  (req, res, next) => uploadController.completeSession(req, res, next)
);
