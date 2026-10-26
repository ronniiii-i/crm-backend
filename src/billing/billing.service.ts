import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStateService } from '../tenant/tenant-state.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantState: TenantStateService,
    private readonly mailService: MailService,
  ) {}

  async getBilling(tenantId: string) {
    const state = await this.tenantState.getState(tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
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
    try {
      await (this.mailService as any).sendContactEmail?.({
        name: user.name,
        email: user.email,
        subject: 'Billing/Upgrade Request',
        message: body?.message || 'Upgrade request',
        company: body?.company,
      });
    } catch {}
    return { success: true };
  }
}
