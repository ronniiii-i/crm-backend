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
  'leave_requests',
  'projects',
  'departments',
] as const;

export type EntityKey = (typeof ENTITY_KEYS)[number];

/** Entities that can back a lookup (relation dropdown) source. */
export const LOOKUP_ENTITY_KEYS = [
  'users',
  'projects',
  'departments',
  'contacts',
] as const;

export type LookupEntityKey = (typeof LOOKUP_ENTITY_KEYS)[number];

/**
 * Relation metadata for a scalar foreign key. The frontend uses this to render
 * a searchable relation picker instead of a free-text id input.
 */
export interface FieldReference {
  entity: LookupEntityKey;
  labelField: string;
  secondaryFields?: string[];
  /** Relation key carrying the included object (`userId` -> `assignedTo`). */
  relationField?: string;
  /** Server-side predicate always applied to the lookup source. */
  filter?: Record<string, unknown>;
}

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
  /** Scalar FK -> lookup source; drives relation pickers and hydration. */
  reference?: FieldReference;
  /** Writable when the record is in `SELF` scope. */
  selfEditable?: boolean;
  /** Never exported and only shown in the admin metadata panel. */
  sensitive?: boolean;
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

export interface EntitySelfMeta {
  /**
   * Scalar column compared against the actor id for `SELF` reads and
   * ownership checks. When omitted, `owner.userField` is used.
   */
  selfField?: string;
  /** Whether a `SELF`-scoped actor may edit matching records. */
  selfCanEdit?: boolean;
  /** Allowlisted fields a `SELF`-scoped actor may write. */
  selfEditableFields?: string[];
}

export interface EntityDescriptor extends EntitySelfMeta {
  key: EntityKey;
  /** Prisma delegate name. Never exposed to clients. */
  delegate: string;
  label: string;
  fields: FieldMeta[];
  /** Human label field used for links, pickers and the command palette. */
  displayField: string;
  /** Additional human-readable fields shown beside the display field. */
  secondaryDisplayFields?: string[];
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
  /** Uses `deletedAt`/`deletedById` instead of a hard delete. */
  softDelete?: boolean;
  /** Whether the generic CSV export endpoint accepts this entity. */
  exportable?: boolean;
  /** Whether the record can be reassigned to another user. */
  reassignable?: boolean;
  /**
   * Generic create/update/delete routes are rejected for this entity; all
   * mutations must go through a dedicated state-machine service.
   */
  directWritesDenied?: boolean;
}

/** Prisma where fragment; typed loosely because it is built per entity. */
export type WhereInput = Record<string, unknown>;
