import crypto from 'crypto';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { UserContext } from '../../versioning/versioning.service.js';

export interface CreateIntegrationInput {
  name: string;
  type: 'EMAIL_SMTP' | 'WEBHOOK' | 'EXTERNAL_API' | 'CUSTOM';
  description?: string;
  secretPayload: Record<string, any>;
}

export class IntegrationService {
  /**
   * Registers a new third-party enterprise integration with encrypted credentials.
   */
  async createIntegration(input: CreateIntegrationInput, user: UserContext) {
    const keyIdentifier = `int_key_${crypto.randomBytes(12).toString('hex')}`;
    const rawSecretJson = JSON.stringify(input.secretPayload);

    const integration = await prisma.$transaction(async (tx) => {
      const int = await tx.integration.create({
        data: {
          organizationId: user.organizationId,
          name: input.name,
          type: input.type,
          description: input.description,
          status: 'ACTIVE',
        },
      });

      await tx.integrationCredential.create({
        data: {
          integrationId: int.id,
          keyIdentifier,
          secretEncrypted: rawSecretJson,
          version: 1,
          isActive: true,
        },
      });

      return int;
    });

    logger.info(`[Integration Admin] Registered integration '${integration.name}' (${integration.type})`);

    return {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      status: integration.status,
      createdAt: integration.createdAt,
    };
  }

  /**
   * Lists integrations with sensitive secrets masked.
   */
  async listIntegrations(user: UserContext) {
    const integrations = await prisma.integration.findMany({
      where: { organizationId: user.organizationId },
      include: {
        credentials: {
          select: { keyIdentifier: true, version: true, isActive: true, rotatedAt: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return integrations.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      status: i.status,
      description: i.description,
      lastUsedAt: i.lastUsedAt,
      credentials: i.credentials.map((c) => ({
        keyIdentifier: c.keyIdentifier,
        version: c.version,
        isActive: c.isActive,
        secret: '[REDACTED]',
        createdAt: c.createdAt,
      })),
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }));
  }

  /**
   * Rotates credentials for an integration.
   */
  async rotateCredential(integrationId: string, newSecretPayload: Record<string, any>, user: UserContext) {
    const int = await prisma.integration.findUnique({ where: { id: integrationId } });
    if (!int) throw { statusCode: 404, message: 'Integration not found' };

    const newKey = `int_key_${crypto.randomBytes(12).toString('hex')}`;
    const rawSecret = JSON.stringify(newSecretPayload);

    await prisma.$transaction(async (tx) => {
      // Deactivate old credentials
      await tx.integrationCredential.updateMany({
        where: { integrationId },
        data: { isActive: false, rotatedAt: new Date() },
      });

      // Create new active credential version
      await tx.integrationCredential.create({
        data: {
          integrationId,
          keyIdentifier: newKey,
          secretEncrypted: rawSecret,
          version: 2,
          isActive: true,
        },
      });
    });

    logger.info(`[Integration Admin] Rotated credentials for integration ${integrationId}`);
    return { success: true, integrationId, newKeyIdentifier: newKey };
  }
}

export const integrationService = new IntegrationService();
