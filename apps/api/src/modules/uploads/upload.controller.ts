import { Request, Response, NextFunction } from 'express';
import { uploadService } from './upload.service.js';

export class UploadController {
  // Agent: Initialize or Resume Upload Session
  async createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent!;
      const result = await uploadService.createOrResumeSession(req.body, agent.agentId);
      res.status(result.resumed ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agent: Upload Chunk
  async uploadChunk(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent!;
      const { id, chunkNumber } = req.params;
      const chunkHash = req.headers['x-chunk-hash'] as string;
      const chunkBuffer = req.body; // Buffer from express.raw

      if (!Buffer.isBuffer(chunkBuffer) || chunkBuffer.length === 0) {
        res.status(400).json({ error: 'Missing or invalid chunk payload' });
        return;
      }

      if (!chunkHash) {
        res.status(400).json({ error: 'Missing X-Chunk-Hash header' });
        return;
      }

      const result = await uploadService.uploadChunk(
        id,
        parseInt(chunkNumber, 10),
        chunkBuffer,
        chunkHash,
        agent.agentId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agent: Complete Upload Session & Finalize
  async completeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agent = req.agent!;
      const { id } = req.params;
      const result = await uploadService.completeSession(id, req.body, agent.agentId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const uploadController = new UploadController();
