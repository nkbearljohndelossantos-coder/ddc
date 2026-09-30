import { Request, Response, NextFunction } from 'express';
import { vaultService } from './vault.service.js';

export interface VaultContext {
  userId: string;
  vaultRole: 'SUPER_ADMIN' | 'VAULT_MANAGER' | 'VAULT_USER';
  session: any;
}

declare global {
  namespace Express {
    interface Request {
      vault?: VaultContext;
    }
  }
}

export async function requireVaultSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionToken =
      (req.headers['x-vault-session-token'] as string) ||
      (req.query.vault_token as string) ||
      (req.headers['x-vault-token'] as string);

    if (!sessionToken) {
      res.status(401).json({
        success: false,
        error: 'Vault session token required. Please unlock the Private Vault.',
        code: 'VAULT_LOCKED',
      });
      return;
    }

    const validation = await vaultService.validateSession(
      sessionToken,
      req.ip,
      req.headers['user-agent']
    );

    req.vault = {
      userId: validation.userId,
      vaultRole: validation.vaultRole as any,
      session: validation.session,
    };

    next();
  } catch (err: any) {
    const status = err.statusCode || 401;
    res.status(status).json({
      success: false,
      error: err.message || 'Vault session validation failed.',
      code: status === 403 ? 'VAULT_ACCESS_DENIED' : 'VAULT_SESSION_EXPIRED',
    });
  }
}

export function requireVaultSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized.' });
    return;
  }

  const isSuper =
    user.roles.includes('SUPER_ADMIN') ||
    user.roles.includes('Super Admin') ||
    user.permissions.includes('admin:all');

  if (!isSuper) {
    res.status(403).json({
      success: false,
      error: '403 ACCESS DENIED: Super Administrator privileges required.',
    });
    return;
  }

  next();
}
