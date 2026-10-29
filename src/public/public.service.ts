import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResolverService } from '../tenant/tenant-resolver.service';
import { TenantProvisioningService } from '../tenant/tenant-provisioning.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolver: TenantResolverService,
    private readonly provisioning: TenantProvisioningService,
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
    const { tenant, verificationToken } = await this.prisma.withTenant(
      tenantId,
      (tx) =>
        this.provisioning.provisionTenantData(tx, {
          tenantId,
          workspaceName,
          slug,
          ownerName,
          ownerEmail,
          adminPassword: password,
        }),
    );

    try {
      await this.mailService.sendVerificationEmail(
        ownerEmail,
        ownerName,
        verificationToken,
      );
    } catch {
      // Self-serve onboarding must not fail because email delivery is down.
    }

    return {
      success: true,
      slug: tenant.slug,
      verificationRequired: true,
    };
  }

  async contact(body: any) {
    try {
      await (this.mailService as any).sendContactEmail?.(body);
    } catch {
      // A mail outage must not fail the contact form submission.
    }
    return { success: true };
  }
}
