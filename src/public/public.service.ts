import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResolverService } from '../tenant/tenant-resolver.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolver: TenantResolverService,
    private readonly mailService: MailService,
  ) {}

  async getWorkspace(slug: string) {
    const tenant = await this.tenantResolver.resolveTenantBySlug(slug);
    if (!tenant) return { success: false };
    return {
      success: true,
      workspace: {
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
      },
    };
  }

  async createWorkspace(body: any) {
    const { name, slug, ownerName, ownerEmail, password } = body || {};
    if (!name || !slug || !ownerEmail || !password) {
      throw new BadRequestException('Missing required fields');
    }

    const available = await (this.prisma as any).tenant_slug_available?.(slug);
    if (available !== true) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug } });
      if (exists) throw new ConflictException('Slug not available');
    }

    const trialDays = Number.parseInt(
      process.env.WORKSPACE_TRIAL_DAYS || '14',
      10,
    );
    const trialExpiresAt = new Date(
      Date.now() + trialDays * 24 * 60 * 60 * 1000,
    );

    const result = await this.prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: {
          name,
          slug,
          status: 'TRIAL',
          trialExpiresAt,
          ownerName,
          ownerEmail,
          seatCount: 1,
          sessionVersion: 0,
        },
      });

      const tenantAdminRole = await tx.role.findFirst({
        where: { tenantId: tenant.id, isTenantAdmin: true },
      });
      if (tenantAdminRole) {
        const bcrypt = require('bcryptjs');
        const hashed = await bcrypt.hash(password, 10);
        await tx.user.create({
          data: {
            email: ownerEmail.toLowerCase(),
            password: hashed,
            name: ownerName,
            roleId: tenantAdminRole.id,
            tenantId: tenant.id,
            isVerified: false,
          },
        });
      }

      return tenant;
    });

    try {
      if ((this.mailService as any).sendWorkspaceVerificationEmail) {
        await (this.mailService as any).sendWorkspaceVerificationEmail(
          ownerEmail,
          ownerName,
          result.slug,
        );
      } else if ((this.mailService as any).sendVerificationEmail) {
        await (this.mailService as any).sendVerificationEmail(
          ownerEmail,
          ownerName,
        );
      }
    } catch {}

    return { success: true, slug: result.slug, verificationRequired: true };
  }

  async contact(body: any) {
    try {
      await (this.mailService as any).sendContactEmail?.(body);
    } catch {}
    return { success: true };
  }
}
