import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { UpdateSettingInput } from './admin.schema.js';

export class SettingsService {
  /**
   * Retrieves operational system settings (safe for administration, masking sensitive values).
   */
  async getSettings() {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });

    return settings.map((s) => ({
      key: s.key,
      value: s.key.toLowerCase().includes('secret') || s.key.toLowerCase().includes('password')
        ? '[REDACTED]'
        : s.value,
      description: s.description,
      isPublic: s.isPublic,
      updatedAt: s.updatedAt,
    }));
  }

  /**
   * Updates an operational system setting with audit tracking.
   */
  async updateSetting(input: UpdateSettingInput, updatedById: string) {
    const setting = await prisma.systemSetting.upsert({
      where: { key: input.key },
      update: {
        value: input.value,
        description: input.description,
      },
      create: {
        key: input.key,
        value: input.value,
        description: input.description,
      },
    });

    logger.info(`[Settings] Updated system setting '${input.key}' by ${updatedById}`);
    return setting;
  }
}

export const settingsService = new SettingsService();
