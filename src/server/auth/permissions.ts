import type { org_role } from '@prisma/client';

/**
 * The permission matrix from docs/05-RBAC-MATRIX.md, encoded.
 *
 * This file is the single source of truth for what a role may do. It is
 * deliberately data, not logic: record-level rules (owner-cannot-verify,
 * site scope, the author's 30-minute edit window) live in each module's
 * policy.ts, because they need the record to decide.
 */
export const PERMISSIONS = [
  'org.settings.manage',
  'org.users.manage',
  'org.sites.manage',
  'org.taxonomy.manage',
  'org.notifications.configure',
  'org.billing.manage',
  'incident.create',
  'incident.view',
  'incident.view_sensitive',
  'incident.edit',
  'incident.classify',
  'incident.acknowledge',
  'incident.reject',
  'incident.close',
  'investigation.assign',
  'investigation.conduct',
  'investigation.view',
  'investigation.approve',
  'action.create',
  'action.view',
  'action.update_progress',
  'action.submit_for_verification',
  'action.verify',
  'action.reassign',
  'action.approve_extension',
  'action.cancel',
  'dashboard.view',
  'report.export',
  'audit.view',
  'attachment.upload',
  'attachment.delete',
  'ai.use',
  'ai.configure',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<org_role, readonly Permission[]> = {
  ORG_ADMIN: [
    'org.settings.manage',
    'org.users.manage',
    'org.sites.manage',
    'org.taxonomy.manage',
    'org.notifications.configure',
    'org.billing.manage',
    'incident.create',
    'incident.view',
    'investigation.view',
    'action.view',
    'dashboard.view',
    'report.export',
    'audit.view',
    'attachment.upload',
    'ai.use',
    'ai.configure',
    // Deliberately absent: incident.view_sensitive. IT administers the
    // system; it does not read employees' injury records. See 05-RBAC §2.
  ],
  HSE_MANAGER: [
    'org.taxonomy.manage',
    'org.notifications.configure',
    'incident.create',
    'incident.view',
    'incident.view_sensitive',
    'incident.edit',
    'incident.classify',
    'incident.acknowledge',
    'incident.reject',
    'incident.close',
    'investigation.assign',
    'investigation.conduct',
    'investigation.view',
    'investigation.approve',
    'action.create',
    'action.view',
    'action.update_progress',
    'action.submit_for_verification',
    'action.verify',
    'action.reassign',
    'action.approve_extension',
    'action.cancel',
    'dashboard.view',
    'report.export',
    'audit.view',
    'attachment.upload',
    'attachment.delete',
    'ai.use',
    'ai.configure',
  ],
  INVESTIGATOR: [
    'incident.create',
    'incident.view',
    'incident.view_sensitive',
    'incident.edit',
    'investigation.conduct',
    'investigation.view',
    'action.create',
    'action.view',
    'action.update_progress',
    'action.submit_for_verification',
    'dashboard.view',
    'report.export',
    'attachment.upload',
    'ai.use',
  ],
  SITE_MANAGER: [
    'incident.create',
    'incident.view',
    'incident.edit',
    'incident.classify',
    'incident.acknowledge',
    'investigation.assign',
    'investigation.view',
    'action.create',
    'action.view',
    'action.update_progress',
    'action.submit_for_verification',
    'action.verify',
    'action.reassign',
    'action.approve_extension',
    'dashboard.view',
    'report.export',
    'audit.view',
    'attachment.upload',
    'ai.use',
  ],
  ACTION_OWNER: [
    'incident.create',
    'incident.view',
    'incident.edit',
    'action.view',
    'action.update_progress',
    'action.submit_for_verification',
    'dashboard.view',
    'attachment.upload',
    'attachment.delete',
  ],
  EMPLOYEE: [
    'incident.create',
    'incident.view',
    'incident.view_sensitive',
    'incident.edit',
    'action.view',
    'action.update_progress',
    'action.submit_for_verification',
    'dashboard.view',
    'attachment.upload',
    'attachment.delete',
  ],
  EXECUTIVE: ['incident.view', 'investigation.view', 'action.view', 'dashboard.view', 'report.export'],
  AUDITOR: [
    'incident.view',
    'investigation.view',
    'action.view',
    'dashboard.view',
    'report.export',
    'audit.view',
  ],
};

// Built explicitly rather than via Object.fromEntries so the compiler
// proves every role is covered — a missing role here would silently deny
// every permission at runtime.
const ROLE_PERMISSION_SETS = {
  ORG_ADMIN: new Set(ROLE_PERMISSIONS.ORG_ADMIN),
  HSE_MANAGER: new Set(ROLE_PERMISSIONS.HSE_MANAGER),
  INVESTIGATOR: new Set(ROLE_PERMISSIONS.INVESTIGATOR),
  SITE_MANAGER: new Set(ROLE_PERMISSIONS.SITE_MANAGER),
  ACTION_OWNER: new Set(ROLE_PERMISSIONS.ACTION_OWNER),
  EMPLOYEE: new Set(ROLE_PERMISSIONS.EMPLOYEE),
  EXECUTIVE: new Set(ROLE_PERMISSIONS.EXECUTIVE),
  AUDITOR: new Set(ROLE_PERMISSIONS.AUDITOR),
} satisfies Record<org_role, ReadonlySet<Permission>>;

export function hasPermission(role: org_role, permission: Permission): boolean {
  return ROLE_PERMISSION_SETS[role].has(permission);
}

export function permissionsFor(role: org_role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
