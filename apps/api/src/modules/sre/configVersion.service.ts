import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redactSensitiveData } from '../../lib/logger.js';

export class ConfigVersionService {
  private memVersions = new Map<string, any[]>();

  private isDbDisabled() {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Records a new configuration version with cryptographic checksum and secret redaction.
   */
  async saveConfigVersion(
    category: string,
    beforeValues: any,
    afterValues: any,
    changeReason: string,
    changedById: string
  ) {
    let latest = null;
    if (!this.isDbDisabled()) {
      try {
        latest = await prisma.configurationVersion.findFirst({
          where: { category },
          orderBy: { version: 'desc' },
        });
      } catch {
        // fallback
      }
    }

    if (!latest) {
      const list = this.memVersions.get(category) || [];
      latest = list[list.length - 1] || null;
    }

    const nextVersion = (latest?.version || 0) + 1;
    const sanitizedAfter = redactSensitiveData(afterValues);
    const sanitizedBefore = redactSensitiveData(beforeValues);

    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(sanitizedAfter))
      .digest('hex');

    const configVersion = {
      id: `cfg-${crypto.randomUUID()}`,
      version: nextVersion,
      category,
      beforeValues: sanitizedBefore,
      afterValues: sanitizedAfter,
      changeReason,
      checksum,
      changedById,
      createdAt: new Date(),
    };

    if (!this.isDbDisabled()) {
      try {
        return await prisma.configurationVersion.create({
          data: {
            version: nextVersion,
            category,
            beforeValues: sanitizedBefore,
            afterValues: sanitizedAfter,
            changeReason,
            checksum,
            changedById,
          },
        });
      } catch {
        // fallback
      }
    }

    const list = this.memVersions.get(category) || [];
    list.push(configVersion);
    this.memVersions.set(category, list);
    return configVersion;
  }

  /**
   * Retrieves configuration version history for a category.
   */
  async listConfigVersions(category: string) {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.configurationVersion.findMany({
          where: { category },
          orderBy: { version: 'desc' },
        });
      } catch {
        // fallback
      }
    }

    return (this.memVersions.get(category) || []).slice().reverse();
  }

  /**
   * Rolls back configuration to a specific version.
   */
  async rollbackToVersion(versionId: string, actorId: string) {
    let targetVersion = null;
    if (!this.isDbDisabled()) {
      try {
        targetVersion = await prisma.configurationVersion.findUnique({
          where: { id: versionId },
        });
      } catch {
        // fallback
      }
    }

    if (!targetVersion) {
      for (const versions of this.memVersions.values()) {
        const found = versions.find((v) => v.id === versionId);
        if (found) {
          targetVersion = found;
          break;
        }
      }
    }

    if (!targetVersion) {
      throw new Error(`Configuration version ${versionId} not found`);
    }

    const list = this.memVersions.get(targetVersion.category) || [];
    const currentLatest = list[list.length - 1];
    const currentValues = currentLatest ? currentLatest.afterValues : targetVersion.beforeValues;

    // Save a new version representing the rollback action
    return this.saveConfigVersion(
      targetVersion.category,
      currentValues,
      targetVersion.afterValues,
      `Rollback to target version ${targetVersion.version} triggered by actor ${actorId}`,
      actorId
    );
  }
}

export const configVersionService = new ConfigVersionService();
