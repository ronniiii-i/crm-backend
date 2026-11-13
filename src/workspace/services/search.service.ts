import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import { FrontendAdapterService } from '../../auth/frontend-adapter.service';
import {
  AccessibleModule,
  Permission,
  UserWithDepartments,
} from '../../auth/permission-types';
import { PrismaService } from '../../prisma/prisma.service';
import { toWorkspaceActor, WorkspaceActor } from '../types/actor';
import { EntityDescriptor, WhereInput } from '../types/entity';
import { EntityRegistryService } from './entity-registry.service';
import { ScopeFilterService } from './scope-filter.service';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;
const MAX_TOTAL_ITEMS = 20;
const COALESCE_MS = 2_000;
const EXCLUDED_EMPLOYMENT_STATUSES = ['SUSPENDED', 'FIRED'];

export type SearchGroupType = 'record' | 'department' | 'document';

export interface SearchItem {
  id: string;
  title: string;
  subtitle?: string | null;
  updatedAt?: string | null;
  /** Same-origin relative path selected by the command palette. */
  href?: string | null;
}

export interface SearchGroup {
  type: SearchGroupType;
  moduleId?: string | null;
  moduleKey?: string | null;
  deptKey?: string | null;
  moduleName?: string | null;
  items: SearchItem[];
}

export interface SearchResult {
  query: string;
  groups: SearchGroup[];
  tookMs: number;
}

interface SearchInput {
  q: string;
  limit: number;
}

interface ModuleRow {
  id: string;
  key: string;
  name: string;
  path: string;
  type: string;
  targetEntity: string | null;
  dataScope: string | null;
  departmentId: string | null;
  department: { id: string; key: string; name: string } | null;
}

interface RecentEntry {
  expiresAt: number;
  result: Promise<SearchResult>;
}

interface SearchSource {
  group: SearchGroup;
}

function asText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function parseQ(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Clamp the per-group item limit to the palette contract (1-5). */
function parseLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

/** Append `?open=<id>` without breaking an existing query string. */
function withOpen(path: string, id: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}open=${encodeURIComponent(id)}`;
}

/**
 * Global command-palette search.
 *
 * The caller's accessible modules are resolved once through the ACL adapter;
 * every source then applies its own scope. Sources run through
 * `Promise.allSettled`, so one failing scope cannot take down the palette.
 *
 * No request value ever names an entity, delegate or column. Records are only
 * read through descriptors in the entity registry, and only for modules the
 * caller can already open.
 */
@Injectable()
export class SearchService {
  /** Short-lived coalescing so a keystroke storm shares one computation. */
  private readonly recent = new Map<string, RecentEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: FrontendAdapterService,
    private readonly registry: EntityRegistryService,
    private readonly scopes: ScopeFilterService,
  ) {}

  async search(
    user: UserWithDepartments,
    rawQuery: Record<string, unknown>,
  ): Promise<SearchResult> {
    const input: SearchInput = {
      q: this.parseQuery(rawQuery.q),
      limit: parseLimit(rawQuery.limit),
    };

    const key = [
      (user as { tenantId?: string | null }).tenantId ?? '',
      (user as { id?: string }).id ?? '',
      input.q.toLowerCase(),
      input.limit,
    ].join(':');

    const now = Date.now();
    const cached = this.recent.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    const entry: RecentEntry = {
      expiresAt: now + COALESCE_MS,
      result: this.run(user, input),
    };
    this.recent.set(key, entry);

    // Evict defensively even when the promise rejects; `.unref()` keeps the
    // timer from holding an otherwise idle process open (notably in tests).
    const timer = setTimeout(() => {
      if (this.recent.get(key) === entry) this.recent.delete(key);
    }, COALESCE_MS + 10);
    timer.unref?.();

    try {
      return await entry.result;
    } catch (error) {
      if (this.recent.get(key) === entry) this.recent.delete(key);
      throw error;
    }
  }

  private parseQuery(value: unknown): string {
    const q = parseQ(value);
    if (q.length < MIN_QUERY_LENGTH) {
      throw new BadRequestException({
        code: 'SEARCH_QUERY_TOO_SHORT',
        message: 'Enter at least 2 characters to search.',
      });
    }
    return q.slice(0, MAX_QUERY_LENGTH);
  }

  private async run(
    user: UserWithDepartments,
    input: SearchInput,
  ): Promise<SearchResult> {
    const startedAt = Date.now();
    const actor = toWorkspaceActor({
      ...user,
      tenantId: user.tenantId ?? undefined,
    });
    const accessible = await this.adapter.getAccessibleModules(user);
    const viewable = accessible.filter((module) =>
      Array.isArray(module.actions)
        ? module.actions.includes(Permission.VIEW)
        : false,
    );

    const modules = await this.loadModules(actor, viewable);

    const sources: Array<Promise<SearchSource>> = [];

    for (const module of modules) {
      if (module.type === ModuleType.DOCUMENT_HUB) {
        sources.push(this.searchDocuments(actor, module, input));
        continue;
      }

      const descriptor = this.registry.forModule(module.targetEntity);
      if (
        descriptor &&
        descriptor.searchFields.length > 0 &&
        descriptor.key !== 'departments'
      ) {
        sources.push(this.searchRecords(actor, module, descriptor, input));
      }
    }

    sources.push(this.searchDepartments(actor, modules, input));

    const settled = await Promise.allSettled(sources);
    const groups: SearchGroup[] = [];
    for (const result of settled) {
      if (
        result.status === 'fulfilled' &&
        result.value.group.items.length > 0
      ) {
        groups.push(result.value.group);
      }
    }

    return {
      query: input.q,
      groups: this.capTotal(groups),
      tookMs: Date.now() - startedAt,
    };
  }

  /** Active modules the ACL adapter says are visible, with scope metadata. */
  private async loadModules(
    actor: WorkspaceActor,
    accessible: AccessibleModule[],
  ): Promise<ModuleRow[]> {
    const ids = accessible.map((module) => module.id);
    if (ids.length === 0) return [];

    const rows: ModuleRow[] = await this.prisma.withTenant(
      actor.tenantId,
      (tx) =>
        (tx as any).module.findMany({
          where: {
            tenantId: actor.tenantId,
            id: { in: ids },
            isActive: true,
          },
          select: {
            id: true,
            key: true,
            name: true,
            path: true,
            type: true,
            targetEntity: true,
            dataScope: true,
            departmentId: true,
            department: {
              select: { id: true, key: true, name: true },
            },
          },
        }),
    );

    const order = new Map(ids.map((id, index) => [id, index]));
    return [...rows].sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
  }

  private async searchRecords(
    actor: WorkspaceActor,
    module: ModuleRow,
    descriptor: EntityDescriptor,
    input: SearchInput,
  ): Promise<SearchSource> {
    const group: SearchGroup = {
      type: 'record',
      moduleId: module.id,
      moduleKey: module.key,
      deptKey: module.department?.key ?? null,
      moduleName: module.name,
      items: [],
    };

    const scope = await this.scopes.build(descriptor, actor, module.dataScope);

    const searchable = descriptor.searchFields.filter((field) =>
      descriptor.select.includes(field),
    );
    if (searchable.length === 0) return { group };

    const filters: WhereInput[] = [scope.where];
    if (descriptor.softDelete) {
      filters.push({ deletedAt: null });
    }
    filters.push({
      OR: searchable.map((field) => ({
        [field]: { contains: input.q, mode: 'insensitive' },
      })),
    });

    const rows: Array<Record<string, unknown>> = await this.prisma.withTenant(
      actor.tenantId,
      (tx) =>
        (tx as any)[descriptor.delegate].findMany({
          where: { AND: filters },
          select: this.recordSelect(descriptor),
          orderBy: { updatedAt: 'desc' },
          take: input.limit,
        }),
    );

    group.items = rows.map((row) => {
      const title = this.recordTitle(descriptor, row);
      return {
        id: String(row.id),
        title,
        subtitle: this.recordSubtitle(descriptor, row, title),
        updatedAt: asText(row.updatedAt) || null,
        href: withOpen(module.path, String(row.id)),
      };
    });

    return { group };
  }

  private async searchDocuments(
    actor: WorkspaceActor,
    module: ModuleRow,
    input: SearchInput,
  ): Promise<SearchSource> {
    const group: SearchGroup = {
      type: 'document',
      moduleId: module.id,
      moduleKey: module.key,
      deptKey: module.department?.key ?? null,
      moduleName: module.name,
      items: [],
    };

    const filters: WhereInput[] = [
      this.departmentScope(actor),
      { moduleId: module.id },
      { status: { not: 'ARCHIVED' } },
      { deletedAt: null },
      {
        OR: [
          { title: { contains: input.q, mode: 'insensitive' } },
          { content: { contains: input.q, mode: 'insensitive' } },
        ],
      },
    ];

    const rows: Array<Record<string, unknown>> = await this.prisma.withTenant(
      actor.tenantId,
      (tx) =>
        (tx as any).document.findMany({
          where: { AND: filters },
          select: {
            id: true,
            title: true,
            status: true,
            category: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: input.limit,
        }),
    );

    group.items = rows.map((row) => ({
      id: String(row.id),
      title: asText(row.title) || 'Untitled document',
      subtitle:
        [asText(row.status), asText(row.category)]
          .filter(Boolean)
          .join(' · ') || null,
      updatedAt: asText(row.updatedAt) || null,
      href: module.path,
    }));

    return { group };
  }

  private async searchDepartments(
    actor: WorkspaceActor,
    modules: ModuleRow[],
    input: SearchInput,
  ): Promise<SearchSource> {
    const group: SearchGroup = { type: 'department', items: [] };

    const where: WhereInput = {
      tenantId: actor.tenantId,
      OR: [
        { name: { contains: input.q, mode: 'insensitive' } },
        { key: { contains: input.q, mode: 'insensitive' } },
      ],
    };

    if (!actor.isTenantAdmin && actor.dataScope !== 'TENANT') {
      const ids = new Set<string>();
      for (const module of modules) {
        if (module.departmentId) ids.add(module.departmentId);
      }
      if (actor.departmentId) ids.add(actor.departmentId);
      if (actor.managedDepartmentId) ids.add(actor.managedDepartmentId);

      if (ids.size === 0) return { group };
      where.id = { in: Array.from(ids) };
    }

    const rows: Array<Record<string, unknown>> = await this.prisma.withTenant(
      actor.tenantId,
      (tx) =>
        (tx as any).department.findMany({
          where,
          select: { id: true, key: true, name: true },
          orderBy: { name: 'asc' },
          take: input.limit,
        }),
    );

    if (rows.length === 0) return { group };

    const counts = await this.departmentMemberCounts(
      actor.tenantId,
      rows.map((row) => String(row.id)),
    );

    group.items = rows.map((row) => {
      const count = counts.get(String(row.id));
      return {
        id: String(row.id),
        title: asText(row.name) || asText(row.key) || 'Department',
        subtitle:
          count === undefined
            ? asText(row.key) || null
            : `${count} ${count === 1 ? 'member' : 'members'}`,
        href: `/departments/${encodeURIComponent(asText(row.key))}`,
      };
    });

    return { group };
  }

  /** Member counts tolerate a Prisma double that does not emulate `_count`. */
  private async departmentMemberCounts(
    tenantId: string,
    departmentIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (departmentIds.length === 0) return counts;

    try {
      const rows: Array<{
        departmentId: string | null;
        _count?: { _all?: number };
      }> = await this.prisma.withTenant(tenantId, (tx) =>
        (tx as any).user.groupBy({
          by: ['departmentId'],
          where: {
            tenantId,
            departmentId: { in: departmentIds },
            status: { notIn: EXCLUDED_EMPLOYMENT_STATUSES },
          },
          _count: { _all: true },
        }),
      );

      for (const row of rows) {
        if (!row.departmentId) continue;
        const count = row._count?._all;
        if (typeof count === 'number') counts.set(row.departmentId, count);
      }
    } catch {
      // A missing count is cosmetic; the palette still links the department.
    }

    return counts;
  }

  private recordSelect(descriptor: EntityDescriptor): Record<string, unknown> {
    const select: Record<string, unknown> = { id: true, updatedAt: true };
    const scalar = new Set(descriptor.select);

    const add = (field: string | undefined) => {
      if (!field || select[field]) return;
      const include = descriptor.includeMap[field];
      if (include) {
        select[field] = include;
      } else if (scalar.has(field)) {
        select[field] = true;
      }
    };

    add(descriptor.displayField);
    for (const field of descriptor.secondaryDisplayFields ?? []) add(field);

    return select;
  }

  private recordTitle(
    descriptor: EntityDescriptor,
    row: Record<string, unknown>,
  ): string {
    if (descriptor.key === 'contacts') {
      const full = [asText(row.firstName), asText(row.lastName)]
        .filter(Boolean)
        .join(' ');
      if (full) return full;
    }

    const display = row[descriptor.displayField];

    if (display && typeof display === 'object' && !(display instanceof Date)) {
      const relation = display as Record<string, unknown>;
      const preferred = [
        relation.name,
        [asText(relation.firstName), asText(relation.lastName)]
          .filter(Boolean)
          .join(' '),
        relation.title,
        relation.key,
      ]
        .map((value) => asText(value))
        .find(Boolean);
      if (preferred) return preferred;
    }

    return asText(display) || descriptor.label;
  }

  private recordSubtitle(
    descriptor: EntityDescriptor,
    row: Record<string, unknown>,
    title: string,
  ): string | null {
    const parts: string[] = [];

    for (const field of descriptor.secondaryDisplayFields ?? []) {
      if (field === descriptor.displayField) continue;
      const meta = descriptor.fields.find((entry) => entry.name === field);
      if (!meta || meta.type === 'email' || meta.sensitive) continue;

      const value = row[field];
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object' && !(value instanceof Date)) continue;

      const text = asText(value).slice(0, 80);
      if (!text || title.includes(text) || parts.includes(text)) continue;
      parts.push(text);
      if (parts.length === 2) break;
    }

    return parts.length > 0 ? parts.join(' · ') : null;
  }

  /** Mirrors `DocumentService.scope` for document-hub sources. */
  private departmentScope(actor: WorkspaceActor): WhereInput {
    if (actor.isTenantAdmin) {
      return { tenantId: actor.tenantId };
    }

    const departmentId =
      actor.departmentId ?? actor.managedDepartmentId ?? null;
    return {
      tenantId: actor.tenantId,
      OR: departmentId
        ? [{ departmentId: null }, { departmentId }]
        : [{ departmentId: null }],
    };
  }

  /** Keep every group represented while enforcing the 20-item response cap. */
  private capTotal(groups: SearchGroup[]): SearchGroup[] {
    const capped = groups.map((group) => ({
      ...group,
      items: [] as SearchItem[],
    }));
    let added = 0;
    let index = 0;

    while (added < MAX_TOTAL_ITEMS) {
      let progressed = false;

      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        if (added >= MAX_TOTAL_ITEMS) break;
        const item = groups[groupIndex].items[index];
        if (!item) continue;
        capped[groupIndex].items.push(item);
        added += 1;
        progressed = true;
      }

      if (!progressed) break;
      index += 1;
    }

    return capped.filter((group) => group.items.length > 0);
  }
}
