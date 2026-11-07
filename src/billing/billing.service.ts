import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStateService } from '../tenant/tenant-state.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantState: TenantStateService,
    private readonly email: EmailService,
  ) {}

  async getBilling(tenantId: string) {
    const state = await this.tenantState.getState(tenantId);
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    const daysRemaining = state.trialExpiresAt
      ? Math.max(
          0,
          Math.ceil(
            (state.trialExpiresAt.getTime() - Date.now()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

    return {
      success: true,
      status: state.status,
      plan: state.status === 'TRIAL' ? 'TRIAL' : 'STANDARD',
      trialExpiresAt: state.trialExpiresAt,
      gracePeriodEndsAt: state.gracePeriodEndsAt,
      daysRemaining,
      seatCount: tenant?.seatCount ?? state.seatCount,
      lastActivityAt: state.lastActivityAt,
    };
  }

  async contact(user: any, body: any) {
    await this.email.send('contact', {
      name: String(user?.name ?? ''),
      email: String(user?.email ?? ''),
      company: body?.company ? String(body.company) : undefined,
      topic: 'Billing/Upgrade Request',
      message: String(body?.message ?? 'Upgrade request'),
      tenantId: user?.tenantId,
    });
    return { success: true };
  }
}
