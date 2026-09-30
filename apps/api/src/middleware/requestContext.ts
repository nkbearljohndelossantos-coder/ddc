import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      id?: string;
      startTime?: number;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  // Extract or generate unique Request ID
  const incomingId = req.headers['x-request-id'];
  const requestId = (typeof incomingId === 'string' && incomingId.trim().length > 0)
    ? incomingId.trim()
    : crypto.randomUUID();

  req.id = requestId;
  req.startTime = Date.now();

  // Set X-Request-ID in response header
  res.setHeader('X-Request-ID', requestId);

  next();
}
