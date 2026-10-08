import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../lib/prisma.js';
import { LoginInput, RefreshTokenInput, RegisterUserInput } from './auth.schema.js';

export class AuthService {
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateAccessToken(userId: string): string {
    const expiresIn = (!env.JWT_EXPIRES_IN || env.JWT_EXPIRES_IN === '15m') ? '7d' : env.JWT_EXPIRES_IN;
    return jwt.sign({ userId }, env.JWT_SECRET, {
      expiresIn: expiresIn as any,
    });
  }

  private generateRefreshToken(userId: string): string {
    return jwt.sign(
      { userId, nonce: crypto.randomBytes(16).toString('hex') },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any }
    );
  }

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
        organization: true,
        department: true,
      },
    });

    if (!user || !user.isActive) {
      throw { statusCode: 401, message: 'Invalid email or password' };
    }

    const passwordMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatch) {
      throw { statusCode: 401, message: 'Invalid email or password' };
    }

    const accessToken = this.generateAccessToken(user.id);
    const rawRefreshToken = this.generateRefreshToken(user.id);
    const tokenHash = this.hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Save initial refresh token in a new session family
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash,
        expiresAt,
      },
    });

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code)
        )
      )
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        departmentId: user.departmentId,
        departmentName: user.department?.name || null,
        roles,
        permissions,
      },
    };
  }

  async refresh(input: RefreshTokenInput) {
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };
    } catch (err: any) {
      throw { statusCode: 401, message: 'Invalid or expired refresh token' };
    }

    const tokenHash = this.hashToken(input.refreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken) {
      throw { statusCode: 401, message: 'Invalid refresh token: token does not exist' };
    }

    // =========================================================================
    // REFRESH TOKEN REUSE PROTECTION
    // =========================================================================
    if (storedToken.revoked) {
      logger.warn(
        `[SECURITY ALERT] Refresh token reuse detected for user ${storedToken.userId} (Family: ${storedToken.familyId}). Revoking all active tokens.`
      );

      // Invalidate all tokens for this user and family
      await prisma.refreshToken.updateMany({
        where: {
          OR: [
            { familyId: storedToken.familyId || undefined },
            { userId: storedToken.userId },
          ],
        },
        data: { revoked: true },
      });

      throw {
        statusCode: 401,
        message: 'Security violation: Refresh token reuse detected. All active sessions have been invalidated. Please log in again.',
      };
    }

    if (storedToken.expiresAt < new Date()) {
      throw { statusCode: 401, message: 'Refresh token has expired' };
    }

    // Rotate: Revoke current token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Issue new token pair within the same session family
    const newAccessToken = this.generateAccessToken(decoded.userId);
    const newRefreshToken = this.generateRefreshToken(decoded.userId);
    const newTokenHash = this.hashToken(newRefreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        userId: decoded.userId,
        familyId: storedToken.familyId || storedToken.id,
        tokenHash: newTokenHash,
        expiresAt,
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (storedToken) {
      await prisma.refreshToken.updateMany({
        where: {
          OR: [
            { familyId: storedToken.familyId || undefined },
            { id: storedToken.id },
          ],
        },
        data: { revoked: true },
      });
    }

    return { success: true };
  }

  async registerUser(input: RegisterUserInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existing) {
      throw { statusCode: 409, message: 'User with this email already exists' };
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const roles = await prisma.role.findMany({
      where: { name: { in: input.roleNames } },
    });

    if (roles.length === 0) {
      throw { statusCode: 400, message: 'Invalid roles specified' };
    }

    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        fullName: input.fullName,
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        userRoles: {
          create: roles.map((r) => ({ roleId: r.id })),
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        organizationId: true,
        departmentId: true,
        createdAt: true,
      },
    });

    return user;
  }
}

export const authService = new AuthService();
