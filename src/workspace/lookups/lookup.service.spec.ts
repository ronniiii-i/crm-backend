import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { EntityRegistryService } from '../services/entity-registry.service';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { ScopeFilterService } from '../services/scope-filter.service';
import { EntityDescriptor } from '../types/entity';
import { LookupService } from './lookup.service';

const TENANT = 'tenant-1';

function makeDescriptor(): EntityDescriptor {
  return {
    key: 'deals',
    label: 'Deals',
    fields: [
      {
        name: 'contactId',
        label: 'Contact',
        type: 'text',
        reference: {
          entity: 'contacts',
          labelField: 'firstName',
          secondaryFields: ['lastName'],
        },
      },
      {
        name: 'userId',
        label: 'Owner',
        type: 'text',
        reference: {
          entity: 'users',
          labelField: 'name',
          secondaryFields: ['email'],
          relationField: 'assignedTo',
        },
      },
      { name: 'name', label: 'Deal', type: 'text' },
    ],
    displayField: 'name',
    secondaryDisplayFields: [],
    select: {},
    includeMap: {},
    nestedFields: {},
    searchFields: [],
    defaultSort: { field: 'createdAt', dir: 'desc' },
    owner: {},
    numericFields: [],
    dateFields: [],
    groupableFields: [],
    supportedScopes: ['TENANT'],
  } as unknown as EntityDescriptor;
}

function makeAccess(): ResolvedModuleAccess {
  return {
    actor: {
      id: 'user-1',
      tenantId: TENANT,
      roleId: 'role-1',
      dataScope: 'TENANT',
      departmentId: null,
      managedDepartmentId: null,
      isTenantAdmin: false,
    },
    module: { id: 'module-1', key: 'deals' } as never,
    department: null,
    config: {} as never,
    entity: makeDescriptor(),
    actions: ['VIEW'],
    scope: 'TENANT',
  };
}

describe('LookupService', () => {
  const findMany = jest.fn();
  let service: LookupService;
  let scopes: { build: jest.Mock };

  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);

    const prisma = {
      withTenant: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
        Promise.resolve(fn({ contact: { findMany }, user: { findMany } })),
      ),
    } as unknown as PrismaService;

    scopes = { build: jest.fn() };
    service = new LookupService(
      prisma,
      new EntityRegistryService(),
      scopes as unknown as ScopeFilterService,
    );
  });

  it('returns labelled options for a reference field', async () => {
    findMany.mockResolvedValue([
      {
        id: 'contact-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        company: 'Analytical',
        email: 'ada@example.test',
      },
    ]);

    const result = await service.lookup(makeAccess(), 'contactId', {});

    expect(result.field).toBe('contactId');
    expect(result.options).toEqual([
      {
        value: 'contact-1',
        label: 'Ada Lovelace',
        secondary: 'Analytical',
        meta: { company: 'Analytical', email: 'ada@example.test' },
      },
    ]);
  });

  it('scopes every query to the actor tenant and the source filter', async () => {
    await service.lookup(makeAccess(), 'contactId', {});

    const call = findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([{ tenantId: TENANT }, { deletedAt: null }]),
    );
    expect(call.select).toMatchObject({ id: true, firstName: true });
    expect(call.take).toBe(20);
    expect(scopes.build).not.toHaveBeenCalled();
  });

  it('searches case-insensitively across the declared columns', async () => {
    await service.lookup(makeAccess(), 'contactId', { q: '  ada  ' });

    const call = findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { firstName: { contains: 'ada', mode: 'insensitive' } },
            { lastName: { contains: 'ada', mode: 'insensitive' } },
            { company: { contains: 'ada', mode: 'insensitive' } },
            { email: { contains: 'ada', mode: 'insensitive' } },
          ],
        },
      ]),
    );
  });

  it('truncates long search terms', async () => {
    await service.lookup(makeAccess(), 'contactId', { q: 'x'.repeat(200) });

    const call = findMany.mock.calls[0][0];
    const search = call.where.AND.find((clause: any) => clause.OR);
    expect(search.OR[0].firstName.contains).toHaveLength(80);
  });

  it('resolves an explicit id list and widens the take', async () => {
    await service.lookup(makeAccess(), 'contactId', {
      ids: 'a,b,a',
      limit: '1',
    });

    const call = findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([{ id: { in: ['a', 'b'] } }]),
    );
    expect(call.take).toBe(2);
  });

  it('clamps the limit to the server maximum', async () => {
    await service.lookup(makeAccess(), 'contactId', { limit: '500' });
    expect(findMany.mock.calls[0][0].take).toBe(50);
  });

  it('falls back to the default limit for invalid input', async () => {
    await service.lookup(makeAccess(), 'contactId', { limit: 'abc' });
    expect(findMany.mock.calls[0][0].take).toBe(20);
  });

  it('excludes suspended and fired users', async () => {
    await service.lookup(makeAccess(), 'userId', {});

    const call = findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([{ status: { notIn: ['SUSPENDED', 'FIRED'] } }]),
    );
  });

  it('rejects unknown fields', async () => {
    await expect(
      service.lookup(makeAccess(), 'password', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects fields that are not references', async () => {
    await expect(
      service.lookup(makeAccess(), 'name', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a module with no entity', async () => {
    const access = { ...makeAccess(), entity: null };
    await expect(service.lookup(access, 'name', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
