/**
 * Types for the workspace entity layer.
 *
 * The entity registry is the security core of the dynamic workspace: the
 * client never supplies a model name, a Prisma `select`, or raw SQL. Every
 * query and write is built from the descriptors declared in
 * `entities/entity-registry.ts`.
 */

/** Entities that may be addressed through the workspace API. */
export const ENTITY_KEYS = [
  'contacts',
  'invoices',
  'expenses',
  'inventory_items',
  'users',
  'audit_logs',
  'deals',
  'support_tickets',
  'tasks',
  'attendance_records',
] as const;

export type EntityKey = (typeof ENTITY_KEYS)[number];

export type FieldType =
  | 'text'
  | 'email'
  | 'number'
  | 'currency'
  | 'date'
  | 'enum'
  | 'boolean'
  | 'json'
  | 'string[]';

export type ScopeName = 'TENANT' | 'DEPARTMENT' | 'TEAM' | 'SELF';

export interface FieldMeta {
  /** Prisma field name. Relations are addressable for reads only. */
  name: string;
  label: string;
  type: FieldType;
  /** True when the field is a relation rather than a scalar column. */
  relation?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  groupable?: boolean;
  /** Accepts a value on create/update. */
  writable?: boolean;
  required?: boolean;
  readOnly?: boolean;
  enumValues?: string[];
  description?: string;
}

export interface EntityOwnerMeta {
  /** Column holding the owning user id. */
  userField?: string;
  /** Column holding the owning department id. */
  departmentField?: string;
  /** Relation path ending in `departmentId`, e.g. `assignedTo`. */
  departmentVia?: string;
  /** Relation path ending in the owning user id, e.g. `customer.userId`. */
  userVia?: string;
}

export interface EntityDescriptor {
  key: EntityKey;
  /** Prisma delegate name. Never exposed to clients. */
  delegate: string;
  label: string;
  fields: FieldMeta[];
  /** Scalar columns returned by list/get. */
  select: string[];
  /** Relation includes allowed for this entity. */
  includeMap: Record<string, Record<string, unknown>>;
  /** Relation paths allowed for sorting/filtering, e.g. `customer.company`. */
  nestedFields: Record<string, string[]>;
  searchFields: string[];
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  owner: EntityOwnerMeta;
  status?: { field: string; values: string[] };
  numericFields: string[];
  dateFields: string[];
  groupableFields: string[];
  supportedScopes: ScopeName[];
  /** Entities exposed read-only through the workspace API. */
  readOnly?: boolean;
}

/** Prisma where fragment; typed loosely because it is built per entity. */
export type WhereInput = Record<string, unknown>;
