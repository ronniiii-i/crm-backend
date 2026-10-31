import {
  EntityDescriptor,
  EntityKey,
  ENTITY_KEYS,
  FieldMeta,
  ScopeName,
} from '../types/entity';
import { FIELDS, scalarFields, searchableFields } from './field-catalog';

/**
 * Allowlist registry for the workspace API.
 *
 * Adding an entity here is the *only* way to make it reachable from the
 * dynamic workspace. The `delegate` and `select` values are server-side
 * constants and are never accepted from a request.
 */

const READ_ONLY: EntityKey[] = ['users', 'audit_logs'];

const relation = (
  name: string,
  label: string,
  include: Record<string, unknown>,
): { field: FieldMeta; include: Record<string, unknown> } => ({
  field: {
    name,
    label,
    type: 'json',
    relation: true,
    readOnly: true,
  },
  include,
});

const userSelect = { id: true, name: true, email: true, departmentId: true };
const departmentSelect = { id: true, key: true, name: true };
const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  company: true,
  email: true,
  userId: true,
};

function build<T extends EntityKey>(
  key: T,
  config: {
    delegate: string;
    label: string;
    fields: FieldMeta[];
    includes: Array<{
      field: FieldMeta;
      include: Record<string, unknown>;
    }>;
    searchFields: string[];
    defaultSort?: { field: string; dir: 'asc' | 'desc' };
    owner: EntityDescriptor['owner'];
    status?: EntityDescriptor['status'];
    supportedScopes: ScopeName[];
    readOnly?: boolean;
    nestedFields?: Record<string, string[]>;
  },
): EntityDescriptor {
  const allFields = [...config.fields, ...config.includes.map((i) => i.field)];
  const includeMap: Record<string, Record<string, unknown>> = {};
  for (const include of config.includes) {
    includeMap[include.field.name] = include.include;
  }

  return {
    key,
    delegate: config.delegate,
    label: config.label,
    fields: allFields,
    select: scalarFields(config.fields),
    includeMap,
    nestedFields: config.nestedFields ?? {},
    searchFields: config.searchFields,
    defaultSort: config.defaultSort ?? { field: 'createdAt', dir: 'desc' },
    owner: config.owner,
    status: config.status,
    numericFields: allFields
      .filter((field) => field.type === 'number' || field.type === 'currency')
      .map((field) => field.name),
    dateFields: allFields
      .filter((field) => field.type === 'date')
      .map((field) => field.name),
    groupableFields: allFields
      .filter((field) => field.groupable)
      .map((field) => field.name),
    supportedScopes: config.supportedScopes,
    readOnly: config.readOnly,
  };
}

function descriptor(key: EntityKey): EntityDescriptor {
  const fields = FIELDS[key];
  const contacts = relation('createdBy', 'Created by', { select: userSelect });
  const customer = relation('customer', 'Customer', {
    select: contactSelect,
  });

  switch (key) {
    case 'contacts':
      return build(key, {
        delegate: 'contact',
        nestedFields: { createdBy: ['name', 'email', 'departmentId'] },
        label: 'Contacts',
        fields,
        includes: [
          contacts,
          relation('deals', 'Deals', { select: { id: true, name: true } }),
          relation('invoices', 'Invoices', {
            select: { id: true, invoiceNumber: true, amount: true },
          }),
          relation('supportTickets', 'Tickets', {
            select: { id: true, subject: true, status: true },
          }),
        ],
        searchFields: searchableFields(fields),
        owner: {
          userField: 'userId',
          departmentVia: 'createdBy',
        },
        status: { field: 'status', values: ['Lead', 'Prospect', 'Qualified', 'Customer', 'Inactive'] },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'invoices':
      return build(key, {
        delegate: 'invoice',
        nestedFields: {
          customer: ['firstName', 'lastName', 'company', 'email'],
        },
        label: 'Invoices',
        fields,
        includes: [
          customer,
          relation('payments', 'Payments', {
            select: { id: true, amount: true, paidAt: true, method: true },
          }),
        ],
        searchFields: searchableFields(fields),
        owner: {
          userVia: 'customer',
          departmentVia: 'customer.createdBy',
        },
        status: {
          field: 'status',
          values: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'expenses':
      return build(key, {
        delegate: 'expense',
        nestedFields: {
          department: ['name', 'key'],
          createdBy: ['name', 'email'],
        },
        label: 'Expenses',
        fields,
        includes: [
          relation('department', 'Department', {
            select: departmentSelect,
          }),
          relation('createdBy', 'Created by', { select: userSelect }),
        ],
        searchFields: searchableFields(fields),
        owner: { userField: 'userId', departmentField: 'departmentId' },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'inventory_items':
      return build(key, {
        delegate: 'inventoryItem',
        nestedFields: {},
        label: 'Inventory',
        fields,
        includes: [],
        searchFields: searchableFields(fields),
        owner: {},
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'users':
      return build(key, {
        delegate: 'user',
        nestedFields: {
          role: ['name', 'slug'],
          department: ['name', 'key'],
        },
        label: 'Users',
        fields,
        includes: [
          relation('role', 'Role', {
            select: { id: true, name: true, slug: true, dataScope: true },
          }),
          relation('department', 'Department', {
            select: departmentSelect,
          }),
        ],
        searchFields: searchableFields(fields),
        owner: { userField: 'id', departmentField: 'departmentId' },
        status: {
          field: 'status',
          values: ['ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'FIRED'],
        },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
        readOnly: true,
      });

    case 'audit_logs':
      return build(key, {
        delegate: 'auditLog',
        nestedFields: {
          actor: ['name', 'email'],
          department: ['name', 'key'],
        },
        label: 'Audit log',
        fields,
        includes: [
          relation('actor', 'Actor', { select: userSelect }),
          relation('department', 'Department', {
            select: departmentSelect,
          }),
        ],
        searchFields: searchableFields(fields),
        owner: { userField: 'actorId', departmentField: 'departmentId' },
        supportedScopes: ['TENANT', 'DEPARTMENT'],
        readOnly: true,
      });

    case 'deals':
      return build(key, {
        delegate: 'deal',
        nestedFields: {
          contact: ['firstName', 'lastName', 'company'],
          assignedTo: ['name', 'email'],
        },
        label: 'Deals',
        fields,
        includes: [
          relation('contact', 'Contact', { select: contactSelect }),
          relation('assignedTo', 'Owner', { select: userSelect }),
        ],
        searchFields: searchableFields(fields),
        owner: { userField: 'userId', departmentVia: 'assignedTo' },
        status: {
          field: 'status',
          values: [
            'LEAD',
            'QUALIFIED',
            'PROPOSAL',
            'NEGOTIATION',
            'WON',
            'LOST',
          ],
        },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'support_tickets':
      return build(key, {
        delegate: 'supportTicket',
        nestedFields: {
          createdBy: ['firstName', 'lastName', 'company'],
          assignedTo: ['name', 'email'],
        },
        label: 'Support tickets',
        fields,
        includes: [
          relation('createdBy', 'Customer', { select: contactSelect }),
          relation('assignedTo', 'Assignee', { select: userSelect }),
        ],
        searchFields: searchableFields(fields),
        owner: { userField: 'userId', departmentVia: 'assignedTo' },
        status: {
          field: 'status',
          values: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
        },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'tasks':
      return build(key, {
        delegate: 'task',
        nestedFields: {
          assignedTo: ['name', 'email'],
          project: ['name', 'status'],
        },
        label: 'Tasks',
        fields,
        includes: [
          relation('assignedTo', 'Assignee', { select: userSelect }),
          relation('project', 'Project', {
            select: { id: true, name: true, status: true },
          }),
        ],
        searchFields: searchableFields(fields),
        owner: { userField: 'assignedToId', departmentVia: 'assignedTo' },
        status: {
          field: 'status',
          values: ['Todo', 'In Progress', 'Review', 'Completed'],
        },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });

    case 'attendance_records':
      return build(key, {
        delegate: 'attendanceRecord',
        nestedFields: { user: ['name', 'email'] },
        label: 'Attendance',
        fields,
        includes: [relation('user', 'Employee', { select: userSelect })],
        searchFields: searchableFields(fields),
        defaultSort: { field: 'date', dir: 'desc' },
        owner: { userField: 'userId', departmentVia: 'user' },
        status: {
          field: 'status',
          values: ['Present', 'Absent', 'Late', 'Leave'],
        },
        supportedScopes: ['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'],
      });
  }
}

export const ENTITY_REGISTRY: ReadonlyMap<EntityKey, EntityDescriptor> =
  new Map(ENTITY_KEYS.map((key) => [key, descriptor(key)]));

export function getEntityDescriptor(key: string): EntityDescriptor | undefined {
  if (!ENTITY_KEYS.includes(key as EntityKey)) return undefined;
  return ENTITY_REGISTRY.get(key as EntityKey);
}

export function isEntityKey(key: string): key is EntityKey {
  return ENTITY_KEYS.includes(key as EntityKey);
}

export { READ_ONLY };
