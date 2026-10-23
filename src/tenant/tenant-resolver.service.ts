import { Injectable } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicWorkspace {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
}

/**
 * Resolves public workspace metadata before a tenant context exists.
 *
 * Only the two audited public functions created by the RLS migration are used.
 * They expose the minimum fields needed to render a workspace login page and
 * to validate a slug during onboarding, and never return tenant business data.
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTenantBySlug(slug: string): Promise<PublicWorkspace | null> {
    const normalized = normalizeSlug(slug);
    if (!normalized) {
      return null;
    }

    const rows = await this.prisma.$queryRaw<PublicWorkspace[]>`
      SELECT id, name, slug, status
      FROM public.public_workspace_lookup(${normalized})
    `;

    return rows[0] ?? null;
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const normalized = normalizeSlug(slug);
    if (!normalized) {
      return false;
    }

    const rows = await this.prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT public.tenant_slug_available(${normalized}) AS "available"
    `;

    return rows[0]?.available === true;
  }
}

export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
