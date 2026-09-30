import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting NKB Database Seed...');

  // 1. Create Default Organization
  const org = await prisma.organization.upsert({
    where: { code: 'NKB-HQ' },
    update: {},
    create: {
      name: 'NKB Enterprise Systems HQ',
      code: 'NKB-HQ',
      isActive: true,
    },
  });
  console.log(`✅ Organization created: ${org.name}`);

  // 2. Create Standard Departments
  const departmentsData = [
    { name: 'Executive & Administration', code: 'ADMIN' },
    { name: 'Accounting & Finance', code: 'ACCOUNTING' },
    { name: 'Human Resources', code: 'HR' },
    { name: 'Quality Control & Audit', code: 'QC' },
    { name: 'Operations & Production', code: 'OPERATIONS' },
    { name: 'Legal & Compliance', code: 'LEGAL' },
  ];

  const departments: Record<string, string> = {};
  for (const dept of departmentsData) {
    const d = await prisma.department.upsert({
      where: {
        organizationId_code: {
          organizationId: org.id,
          code: dept.code,
        },
      },
      update: {},
      create: {
        organizationId: org.id,
        name: dept.name,
        code: dept.code,
      },
    });
    departments[dept.code] = d.id;
  }
  console.log(`✅ ${Object.keys(departments).length} Departments seeded.`);

  // 3. Create Standard RBAC Roles
  const rolesData = [
    { name: 'SUPER_ADMIN', description: 'Full system-wide administrative access' },
    { name: 'SCANNER_ADMIN', description: 'Manage scanner hardware, agents, and master profiles' },
    { name: 'SCAN_OPERATOR', description: 'Execute scan jobs, batches, and edit capture metadata' },
    { name: 'QUALITY_CONTROL', description: 'Review, approve, or reject scanned documents' },
    { name: 'DEPARTMENT_USER', description: 'View documents assigned to own department' },
    { name: 'VIEWER', description: 'Read-only document access' },
  ];

  const roles: Record<string, string> = {};
  for (const r of rolesData) {
    const createdRole = await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: r,
    });
    roles[r.name] = createdRole.id;
  }
  console.log(`✅ ${Object.keys(roles).length} RBAC Roles seeded.`);

  // 4. Create Standard Permissions
  const permissionsData = [
    { code: 'admin:all', description: 'Universal system control' },
    { code: 'scanners:manage', description: 'Register, configure, and approve scanner agents' },
    { code: 'scan:execute', description: 'Initiate and cancel scan jobs' },
    { code: 'profiles:manage', description: 'Create and modify scan profiles' },
    { code: 'documents:read', description: 'View and search documents' },
    { code: 'documents:write', description: 'Edit document metadata and tags' },
    { code: 'documents:review', description: 'Approve or reject documents in QC' },
    { code: 'audit:read', description: 'Inspect audit and compliance logs' },
  ];

  for (const p of permissionsData) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });

    // Assign to SUPER_ADMIN
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roles['SUPER_ADMIN'],
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: roles['SUPER_ADMIN'],
        permissionId: perm.id,
      },
    });

    // Assign to DEPARTMENT_USER (Boss View: documents:read, audit:read)
    if (['documents:read', 'audit:read'].includes(p.code)) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roles['DEPARTMENT_USER'],
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: roles['DEPARTMENT_USER'],
          permissionId: perm.id,
        },
      });
    }

    // Assign to VIEWER (Liaison: documents:read, documents:write, scan:execute)
    if (['documents:read', 'documents:write', 'scan:execute'].includes(p.code)) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roles['VIEWER'],
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: roles['VIEWER'],
          permissionId: perm.id,
        },
      });
    }
  }
  console.log(`✅ Permissions created and linked to SUPER_ADMIN, DEPARTMENT_USER, and VIEWER.`);

  // 5. Create Default Super Admin Account
  const adminPasswordHash = await bcrypt.hash('Admin@NKB2026!Secure', 12);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@nkb-scanning.local' },
    update: {},
    create: {
      organizationId: org.id,
      departmentId: departments['ADMIN'],
      email: 'admin@nkb-scanning.local',
      passwordHash: adminPasswordHash,
      fullName: 'NKB System Administrator',
      isActive: true,
      userRoles: {
        create: { roleId: roles['SUPER_ADMIN'] },
      },
    },
  });
  console.log(`✅ Super Admin created: ${adminUser.email}`);

  // 6. Create Standard Enterprise Scan Profiles
  const defaultProfiles = [
    {
      name: 'Accounting Invoice Scan (300 DPI Duplex)',
      description: 'Optimized for invoices and receipts with OCR and barcode separation',
      departmentId: departments['ACCOUNTING'],
      isDefault: true,
      settings: {
        resolutionDpi: 300,
        colorMode: 'COLOR_24BIT',
        duplex: true,
        autoDeskew: true,
        blankPageRemoval: true,
        blankThresholdPercent: 0.5,
        ocrEnabled: true,
        ocrLanguage: 'eng',
        separationRule: 'BARCODE_OR_BLANK',
        outputFormat: 'SEARCHABLE_PDF',
        targetDocumentType: 'INVOICE',
      },
    },
    {
      name: 'HR Employee Record (300 DPI B&W)',
      description: 'Clean monochrome high-compression scan for HR files and IDs',
      departmentId: departments['HR'],
      isDefault: false,
      settings: {
        resolutionDpi: 300,
        colorMode: 'BW_1BIT',
        duplex: true,
        autoDeskew: true,
        blankPageRemoval: true,
        ocrEnabled: true,
        ocrLanguage: 'eng',
        separationRule: 'MANUAL',
        outputFormat: 'SEARCHABLE_PDF',
        targetDocumentType: 'HR',
      },
    },
    {
      name: 'Quick Contract Capture (300 DPI Color)',
      description: 'High-fidelity color capture for signed legal agreements',
      departmentId: departments['LEGAL'],
      isDefault: false,
      settings: {
        resolutionDpi: 300,
        colorMode: 'COLOR_24BIT',
        duplex: true,
        autoDeskew: true,
        blankPageRemoval: false,
        ocrEnabled: true,
        ocrLanguage: 'eng',
        separationRule: 'FIXED_PAGE_COUNT',
        fixedPagesPerDoc: 1,
        outputFormat: 'SEARCHABLE_PDF',
        targetDocumentType: 'CONTRACT',
      },
    },
  ];

  for (const profile of defaultProfiles) {
    const existing = await prisma.scanProfile.findFirst({
      where: { name: profile.name },
    });

    if (!existing) {
      await prisma.scanProfile.create({
        data: {
          ...profile,
          createdById: adminUser.id,
        },
      });
    }
  }
  console.log(`✅ Default Scan Profiles seeded.`);

  // 8. Seed Default Scanner Agent & Hardware Scanner (Brother ADS-4300N)
  const agent = await prisma.scannerAgent.upsert({
    where: { id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' },
    update: {
      status: 'ONLINE',
      lastHeartbeat: new Date(),
    },
    create: {
      id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      organizationId: org.id,
      departmentId: departments['ACCOUNTING'],
      agentName: 'NKB-Workstation-Brother-ADS4300N',
      machineName: 'DESKTOP-NKB-SCANNER',
      osVersion: 'Windows 11 Enterprise (WIA/TWAIN 2.4)',
      ipAddress: '127.0.0.1',
      status: 'ONLINE',
      lastHeartbeat: new Date(),
      version: '1.0.0',
      metadata: {
        driver: 'Brother Industries Ltd. WIA 2.0',
        hardwareId: 'USB\\VID_04F9&PID_04D6',
        deviceType: 'High-Speed ADF Desktop Scanner',
        maxDpi: 600,
        duplex: true,
      },
    },
  });

  const scanner = await prisma.scanner.upsert({
    where: {
      agentId_driverType_localScannerId: {
        agentId: agent.id,
        driverType: 'WIA',
        localScannerId: 'brother-ads4300n-wia-01',
      },
    },
    update: {
      status: 'READY',
      updatedAt: new Date(),
    },
    create: {
      organizationId: org.id,
      departmentId: departments['ACCOUNTING'],
      agentId: agent.id,
      localScannerId: 'brother-ads4300n-wia-01',
      scannerName: 'Brother ADS-4300N High-Speed Scanner',
      model: 'Brother ADS-4300N',
      serialNumber: 'U65922M2N123456',
      driverType: 'WIA',
      status: 'READY',
      capabilities: {
        duplexSupported: true,
        adfSupported: true,
        supportedColorModes: ['COLOR_24BIT', 'GRAYSCALE_8BIT', 'BW_1BIT'],
        supportedResolutionsDpi: [150, 200, 300, 600],
        supportedPageSizes: ['A4', 'LETTER', 'LEGAL'],
        maxFeederCapacitySheets: 80,
      },
    },
  });
  console.log(`✅ Default Scanner Agent & Hardware Scanner (Brother ADS-4300N) seeded.`);
  console.log('🎉 Database Seeding Complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
