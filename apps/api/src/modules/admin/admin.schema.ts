import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(3, 'Organization name must be at least 3 characters'),
  code: z.string().min(2, 'Organization code must be at least 2 characters').toUpperCase(),
});

export const createDepartmentSchema = z.object({
  name: z.string().min(2, 'Department name must be at least 2 characters'),
  code: z.string().min(2, 'Department code must be at least 2 characters').toUpperCase(),
  organizationId: z.string().uuid().optional(),
});

export const createUserAdminSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  departmentId: z.string().uuid().optional(),
  roles: z.array(z.string()).min(1, 'At least one role is required'),
});

export const updateUserAdminSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  roles: z.array(z.string()).min(1).optional(),
  isActive: z.boolean().optional(),
});

export const publicSelfRegisterSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  departmentId: z.string().uuid().optional(),
  targetRole: z.enum(['VIEWER', 'DEPARTMENT_USER', 'SUPER_ADMIN']).optional(),
});

export const assignUserRoleSchema = z.object({
  roleNames: z.array(z.string()).min(1, 'At least one role is required'),
});

export const updateSettingSchema = z.object({
  key: z.string().min(2),
  value: z.string().min(1),
  description: z.string().optional(),
});

export const recordBackupSchema = z.object({
  backupType: z.enum(['FULL_DATABASE', 'OBJECT_STORAGE_MANIFEST', 'CONFIG_SNAPSHOT']),
  backupPath: z.string().min(5),
  fileSizeBytes: z.number().int().positive(),
  sha256Hash: z.string().length(64, 'SHA-256 hash must be 64 hex characters'),
});

export const resolveAlertSchema = z.object({
  notes: z.string().optional(),
});

export const resetDataSchema = z.object({
  confirmation: z.literal('CONFIRM_PURGE_ALL_DOCUMENTS', {
    errorMap: () => ({ message: "Confirmation phrase must be 'CONFIRM_PURGE_ALL_DOCUMENTS'" }),
  }),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type CreateUserAdminInput = z.infer<typeof createUserAdminSchema>;
export type UpdateUserAdminInput = z.infer<typeof updateUserAdminSchema>;
export type PublicSelfRegisterInput = z.infer<typeof publicSelfRegisterSchema>;
export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;
export type RecordBackupInput = z.infer<typeof recordBackupSchema>;
export type ResolveAlertInput = z.infer<typeof resolveAlertSchema>;
export type ResetDataInput = z.infer<typeof resetDataSchema>;
