import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResolverService } from '../tenant/tenant-resolver.service';
import { TenantProvisioningService } from '../tenant/tenant-provisioning.service';
import { EmailService } from '../email/email.service';
import { EmailLinkService } from '../email/email-link.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolver: TenantResolverService,
    private readonly provisioning: TenantProvisioningService,
    private readonly email: EmailService,
    private readonly emailLink: EmailLinkService,
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
    // The onboarding UI sends workspaceName/email/ownerName; older callers
    // used name/ownerEmail. Accept both so the two flows cannot drift.
    const workspaceName = String(
      body?.workspaceName ?? body?.name ?? '',
    ).trim();
    const slug = String(body?.slug ?? '')
      .trim()
      .toLowerCase();
    const ownerName = String(body?.ownerName ?? '').trim();
    const ownerEmail = String(body?.ownerEmail ?? body?.email ?? '')
      .trim()
      .toLowerCase();
    const password = body?.password;

    if (!workspaceName || !slug || !ownerName || !ownerEmail || !password) {
      throw new BadRequestException('Missing required fields');
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug)) {
      throw new BadRequestException(
        'Slug must be 3-50 characters of lowercase letters, numbers, or hyphens',
      );
    }

    // `tenants` is RLS-protected, so an unauthenticated crm_app query cannot
    // see other rows. The SECURITY DEFINER helper is the only safe way to
    // check slug availability before a tenant context exists.
    const available = await this.tenantResolver.isSlugAvailable(slug);
    if (!available) throw new ConflictException('Slug not available');

    const tenantId = randomUUID();
    const { tenant, verificationToken, verificationExpiresAt } =
      await this.prisma.withTenant(tenantId, (tx) =>
        this.provisioning.provisionTenantData(tx, {
          tenantId,
          workspaceName,
          slug,
          ownerName,
          ownerEmail,
          adminPassword: password,
        }),
      );

    await this.email.send('welcome', {
      to: ownerEmail,
      name: ownerName,
      workspaceName: tenant.name,
      verifyUrl: this.emailLink.build(tenant.slug, 'verify-email', {
        token: verificationToken,
      }),
      expiresAt: verificationExpiresAt,
      tenantId,
      idempotencyKey: `welcome:${tenantId}:${ownerEmail}`,
    });

    return {
      success: true,
      slug: tenant.slug,
      verificationRequired: true,
    };
  }

  async contact(body: any) {
    await this.email.send('contact', {
      name: String(body?.name ?? body?.fullName ?? ''),
      email: String(body?.email ?? ''),
      company: body?.company ? String(body.company) : undefined,
      topic: body?.topic ? String(body.topic) : undefined,
      message: String(body?.message ?? ''),
    });
    return { success: true };
  }
}
