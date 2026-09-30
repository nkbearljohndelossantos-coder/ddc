import { Request, Response, NextFunction } from 'express';
import { vaultService } from './vault.service.js';

export class VaultController {
  // Check authorization & session status
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const auth = await vaultService.checkUserAuthorization(user.id);

      let isUnlocked = false;
      let remainingSeconds = 0;

      const sessionToken =
        (req.headers['x-vault-session-token'] as string) ||
        (req.query.vault_token as string) ||
        (req.headers['x-vault-token'] as string);

      if (sessionToken && auth.authorized) {
        try {
          const val = await vaultService.validateSession(sessionToken);
          isUnlocked = val.valid;
          remainingSeconds = Math.max(0, Math.floor((val.session.expiresAt.getTime() - Date.now()) / 1000));
        } catch (e) {
          isUnlocked = false;
        }
      }

      res.json({
        success: true,
        authorized: auth.authorized,
        vaultRole: auth.vaultRole,
        status: auth.status,
        isUnlocked,
        remainingSeconds,
      });
    } catch (err) {
      next(err);
    }
  }

  // Unlock Vault with DCC Account Password
  async unlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { password } = req.body;

      if (!password || typeof password !== 'string') {
        res.status(400).json({ success: false, error: 'Password is required to unlock Private Vault.' });
        return;
      }

      const result = await vaultService.unlockVault(
        user.id,
        password,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        message: 'Private Vault unlocked successfully.',
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
        vaultRole: result.vaultRole,
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Vault unlock failed.',
      });
    }
  }

  // Lock Vault
  async lock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionToken =
        (req.headers['x-vault-session-token'] as string) ||
        (req.query.vault_token as string) ||
        (req.headers['x-vault-token'] as string);

      await vaultService.lockVault(
        sessionToken,
        req.user?.id,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        message: 'Private Vault locked successfully.',
      });
    } catch (err) {
      next(err);
    }
  }

  // List Documents in Vault
  async listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vaultCtx = req.vault!;
      const { folder, search, status } = req.query as { folder?: string; search?: string; status?: string };

      const documents = await vaultService.listDocuments(
        vaultCtx.userId,
        vaultCtx.vaultRole,
        { folder, search, status }
      );

      res.json({
        success: true,
        count: documents.length,
        documents,
      });
    } catch (err) {
      next(err);
    }
  }

  // Upload Document to Vault
  async uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vaultCtx = req.vault!;
      const { title, folder, documentType, fileData, fileName } = req.body;

      if (!fileData) {
        res.status(400).json({ success: false, error: 'File data is required.' });
        return;
      }

      const fileBuffer = Buffer.from(fileData, 'base64');
      if (fileBuffer.length === 0) {
        res.status(400).json({ success: false, error: 'Invalid or empty file payload.' });
        return;
      }

      const document = await vaultService.uploadDocument({
        title: title || fileName || 'Confidential_Document.pdf',
        folder: folder || '/',
        documentType: documentType || 'EXECUTIVE_CONFIDENTIAL',
        fileBuffer,
        fileName: fileName || 'confidential.pdf',
        userId: vaultCtx.userId,
        vaultRole: vaultCtx.vaultRole,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json({
        success: true,
        message: 'Document securely uploaded to Private Vault.',
        document,
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Vault document upload failed.',
      });
    }
  }

  // Get Document Details
  async getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vaultCtx = req.vault!;
      const { id } = req.params;

      const document = await vaultService.getDocument(
        id,
        vaultCtx.userId,
        vaultCtx.vaultRole,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        document,
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Failed to fetch vault document.',
      });
    }
  }

  // Stream Preview
  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vaultCtx = req.vault!;
      const { id } = req.params;

      const { stream, title, size, contentType } = await vaultService.getDocumentStream(
        id,
        vaultCtx.userId,
        vaultCtx.vaultRole,
        'PREVIEW',
        req.ip,
        req.headers['user-agent']
      );

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', size);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(title)}"`);
      stream.pipe(res);
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Failed to preview document.',
      });
    }
  }

  // Stream Download
  async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vaultCtx = req.vault!;
      const { id } = req.params;

      const { stream, title, size, contentType } = await vaultService.getDocumentStream(
        id,
        vaultCtx.userId,
        vaultCtx.vaultRole,
        'DOWNLOAD',
        req.ip,
        req.headers['user-agent']
      );

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}"`);
      stream.pipe(res);
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Failed to download document.',
      });
    }
  }

  // Delete Document
  async deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vaultCtx = req.vault!;
      const { id } = req.params;

      await vaultService.deleteDocument(
        id,
        vaultCtx.userId,
        vaultCtx.vaultRole,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        message: 'Document permanently deleted from Private Vault.',
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Failed to delete vault document.',
      });
    }
  }

  // Super Admin: List Users and Vault Status
  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await vaultService.listVaultUsers();
      res.json({
        success: true,
        users,
      });
    } catch (err) {
      next(err);
    }
  }

  // Super Admin: Authorize User
  async authorizeUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { userId, vaultRole, notes } = req.body;

      if (!userId) {
        res.status(400).json({ success: false, error: 'User ID is required.' });
        return;
      }

      if (!['VAULT_MANAGER', 'VAULT_USER'].includes(vaultRole)) {
        res.status(400).json({ success: false, error: 'Vault role must be VAULT_MANAGER or VAULT_USER.' });
        return;
      }

      const auth = await vaultService.authorizeUser({
        targetUserId: userId,
        vaultRole,
        authorizedById: user.id,
        notes,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        message: 'User authorization granted for Private Vault.',
        authorization: auth,
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Failed to authorize user.',
      });
    }
  }

  // Super Admin: Revoke User
  async revokeUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { userId, reason } = req.body;

      if (!userId) {
        res.status(400).json({ success: false, error: 'User ID is required.' });
        return;
      }

      await vaultService.revokeUser({
        targetUserId: userId,
        revokedById: user.id,
        reason,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        message: 'User Private Vault access revoked and active sessions terminated.',
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        error: err.message || 'Failed to revoke user.',
      });
    }
  }

  // Super Admin: Audit Logs
  async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, action, userId } = req.query;

      const result = await vaultService.getAuditLogs({
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 25,
        action: action as string,
        userId: userId as string,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const vaultController = new VaultController();
