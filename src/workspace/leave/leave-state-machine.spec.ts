import {
  allowedApproverRoles,
  checkApprover,
  isLeaveAction,
  isPendingStatus,
  isTerminalStatus,
  transitionFor,
} from './leave-state-machine';

const UUID = {
  requester: '11111111-1111-4111-8111-111111111111',
  lead: '22222222-2222-4222-8222-222222222222',
  hod: '33333333-3333-4333-8333-333333333333',
  hr: '44444444-4444-4444-8444-444444444444',
  admin: '55555555-5555-4555-8555-555555555555',
};

describe('leave state machine', () => {
  it.each([
    ['PENDING_TEAM_LEAD', 'APPROVE', 'PENDING_HR', 2],
    ['PENDING_TEAM_LEAD', 'REJECT', 'REJECTED', 1],
    ['PENDING_TEAM_LEAD', 'CANCEL', 'CANCELLED', 1],
    ['PENDING_HR', 'APPROVE', 'APPROVED', 2],
    ['PENDING_HR', 'REJECT', 'REJECTED', 2],
    ['PENDING_HR', 'CANCEL', 'CANCELLED', 2],
  ] as const)('%s + %s -> %s', (from, action, to, stage) => {
    const transition = transitionFor(from, action);
    expect(transition).toMatchObject({ from, action, to, stage });
  });

  it.each(['APPROVED', 'REJECTED', 'CANCELLED'])(
    'terminal status %s is immutable',
    (status) => {
      expect(isTerminalStatus(status)).toBe(true);
      expect(isPendingStatus(status)).toBe(false);
      for (const action of ['APPROVE', 'REJECT', 'CANCEL'] as const) {
        expect(transitionFor(status, action)).toBeNull();
      }
    },
  );

  it('recognises actions and pending statuses', () => {
    expect(isLeaveAction('APPROVE')).toBe(true);
    expect(isLeaveAction('approve')).toBe(false);
    expect(isPendingStatus('PENDING_HR')).toBe(true);
    expect(isPendingStatus('PENDING_TEAM_LEAD')).toBe(true);
  });

  it('allows team lead and HOD at the first stage and HR at the second', () => {
    expect(allowedApproverRoles('PENDING_TEAM_LEAD')).toEqual([
      'TEAM_LEAD',
      'HOD',
    ]);
    expect(allowedApproverRoles('PENDING_HR')).toEqual(['HR']);
    expect(allowedApproverRoles('APPROVED')).toEqual([]);
  });

  const base = {
    requesterId: UUID.requester,
    teamLeadId: UUID.lead,
    hodId: UUID.hod,
    hrApproverId: UUID.hr,
    isTenantAdmin: false,
  };

  it('authorises the designated stage approver', () => {
    expect(
      checkApprover('PENDING_TEAM_LEAD', {
        ...base,
        actorId: UUID.lead,
      }),
    ).toEqual({ allowed: true, override: false });

    expect(
      checkApprover('PENDING_TEAM_LEAD', { ...base, actorId: UUID.hod }),
    ).toEqual({ allowed: true, override: false });

    expect(checkApprover('PENDING_HR', { ...base, actorId: UUID.hr })).toEqual({
      allowed: true,
      override: false,
    });
  });

  it('denies HR at the first stage and team lead at the second', () => {
    expect(
      checkApprover('PENDING_TEAM_LEAD', { ...base, actorId: UUID.hr }),
    ).toEqual({ allowed: false, reason: 'NOT_APPROVER' });

    expect(
      checkApprover('PENDING_HR', { ...base, actorId: UUID.lead }),
    ).toEqual({ allowed: false, reason: 'NOT_APPROVER' });
  });

  it('denies self approval without an admin override', () => {
    expect(
      checkApprover('PENDING_TEAM_LEAD', {
        ...base,
        actorId: UUID.requester,
      }),
    ).toEqual({ allowed: false, reason: 'SELF_APPROVAL' });

    expect(
      checkApprover('PENDING_HR', {
        ...base,
        actorId: UUID.requester,
        isTenantAdmin: true,
      }),
    ).toEqual({ allowed: true, override: true });
  });

  it('lets a tenant admin override any stage and records it', () => {
    expect(
      checkApprover('PENDING_HR', {
        ...base,
        actorId: UUID.admin,
        isTenantAdmin: true,
      }),
    ).toEqual({ allowed: true, override: true });
  });
});
