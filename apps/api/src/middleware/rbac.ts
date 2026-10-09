import { Request, Response, NextFunction } from 'express';

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User not authenticated' });
      return;
    }

    // SUPER_ADMIN has universal access
    if (req.user.roles.includes('SUPER_ADMIN')) {
      return next();
    }

    const hasRole = allowedRoles.some((role) => req.user?.roles.includes(role));
    if (!hasRole) {
      res.status(403).json({
        error: `Forbidden: Requires one of roles: [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User not authenticated' });
      return;
    }

    // SUPER_ADMIN has universal access
    if (req.user.roles.includes('SUPER_ADMIN')) {
      return next();
    }

    const hasAllPermissions = requiredPermissions.every((perm) =>
      req.user?.permissions.includes(perm)
    );

    if (!hasAllPermissions) {
      res.status(403).json({
        error: `Forbidden: Missing required permission(s): [${requiredPermissions.join(', ')}]`,
      });
      return;
    }

    next();
  };
}

export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User not authenticated' });
      return;
    }

    // SUPER_ADMIN has universal access
    if (req.user.roles.includes('SUPER_ADMIN')) {
      return next();
    }

    const hasAnyPermission = permissions.some((perm) =>
      req.user?.permissions.includes(perm)
    );

    if (!hasAnyPermission) {
      res.status(403).json({
        error: `Forbidden: Missing required permission (requires one of: [${permissions.join(', ')}])`,
      });
      return;
    }

    next();
  };
}

export function requireDepartmentAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized: User not authenticated' });
    return;
  }

  // Admins bypass department scoping
  if (req.user.roles.includes('SUPER_ADMIN') || req.user.roles.includes('SCANNER_ADMIN')) {
    return next();
  }

  const targetDepartmentId = req.params.departmentId || req.body.departmentId || req.query.departmentId;

  if (targetDepartmentId && req.user.departmentId !== targetDepartmentId) {
    res.status(403).json({
      error: 'Forbidden: Access restricted to user department',
    });
    return;
  }

  next();
}
