import { describe, expect, it } from 'vitest';
import { hasPermission, permissionsFor, PERMISSIONS } from '@/server/auth/permissions';

describe('permission matrix', () => {
  it('gives the HSE manager the full safety workflow', () => {
    for (const p of [
      'incident.classify',
      'incident.close',
      'investigation.approve',
      'action.verify',
      'incident.view_sensitive',
    ] as const) {
      expect(hasPermission('HSE_MANAGER', p), p).toBe(true);
    }
  });

  it('never lets an org admin read injury or health records', () => {
    // Deliberate: IT administers the system, it does not read employees'
    // medical detail. docs/05-RBAC-MATRIX.md section 2.
    expect(hasPermission('ORG_ADMIN', 'incident.view_sensitive')).toBe(false);
  });

  it('keeps read-only roles read-only', () => {
    for (const role of ['EXECUTIVE', 'AUDITOR'] as const) {
      expect(hasPermission(role, 'incident.create')).toBe(false);
      expect(hasPermission(role, 'incident.close')).toBe(false);
      expect(hasPermission(role, 'action.verify')).toBe(false);
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
    }
  });

  it('does not let an employee classify, close or verify', () => {
    for (const p of ['incident.classify', 'incident.close', 'action.verify'] as const) {
      expect(hasPermission('EMPLOYEE', p), p).toBe(false);
    }
    expect(hasPermission('EMPLOYEE', 'incident.create')).toBe(true);
  });

  it('grants only permissions that exist in the registry', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of [
      'ORG_ADMIN', 'HSE_MANAGER', 'INVESTIGATOR', 'SITE_MANAGER',
      'ACTION_OWNER', 'EMPLOYEE', 'EXECUTIVE', 'AUDITOR',
    ] as const) {
      for (const p of permissionsFor(role)) expect(known.has(p), `${role}: ${p}`).toBe(true);
    }
  });
});
