import { EntityKey, FieldMeta } from '../types/entity';

/**
 * Field catalogue for every entity exposed by the workspace API.
 *
 * Only fields declared here can be selected, filtered, sorted, searched, or
 * written. Anything else is rejected with `400` by the query/write services.
 */

const f = (
  name: string,
  label: string,
  type: FieldMeta['type'],
  options: Partial<FieldMeta> = {},
): FieldMeta => ({ name, label, type, ...options });

const ID = f('id', 'ID', 'text', {
  sortable: true,
  filterable: true,
  readOnly: true,
});
const CREATED = f('createdAt', 'Created', 'date', {
  sortable: true,
  filterable: true,
});
const UPDATED = f('updatedAt', 'Updated', 'date', {
  sortable: true,
  filterable: true,
});
const CUSTOM = f('customFields', 'Custom fields', 'json', {
  filterable: true,
  writable: true,
  readOnly: false,
});

const CONTACT_STATUS = [
  'Lead',
  'Prospect',
  'Qualified',
  'Customer',
  'Inactive',
];

const INVOICE_STATUS = ['Pending', 'Paid', 'Overdue', 'Cancelled'];

const EXPENSE_CATEGORIES = [
  'Travel',
  'Software',
  'Office',
  'Marketing',
  'Payroll',
  'Other',
];

const DEAL_STATUS = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
];

const TICKET_STATUS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const TASK_STATUS = ['Todo', 'In Progress', 'Review', 'Completed'];

const ATTENDANCE_STATUS = ['Present', 'Absent', 'Late', 'Leave'];

export const FIELDS: Record<EntityKey, FieldMeta[]> = {
  contacts: [
    ID,
    f('firstName', 'First name', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('lastName', 'Last name', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('email', 'Email', 'email', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
    }),
    f('phone', 'Phone', 'text', {
      filterable: true,
      searchable: true,
      writable: true,
    }),
    f('company', 'Company', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
    }),
    f('jobTitle', 'Job title', 'text', { filterable: true, writable: true }),
    f('notes', 'Notes', 'text', { writable: true }),
    f('status', 'Status', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      enumValues: CONTACT_STATUS,
    }),
    f('tags', 'Tags', 'string[]', { writable: true }),
    f('userId', 'Owner', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      description: 'Defaults to the signed-in user.',
    }),
    CREATED,
    UPDATED,
    CUSTOM,
    f('createdBy', 'Created by', 'json', {
      relation: true,
      readOnly: true,
    }),
    f('deals', 'Deals', 'json', { relation: true, readOnly: true }),
    f('invoices', 'Invoices', 'json', { relation: true, readOnly: true }),
    f('supportTickets', 'Tickets', 'json', { relation: true, readOnly: true }),
  ],

  invoices: [
    ID,
    f('invoiceNumber', 'Invoice #', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('customerId', 'Customer', 'text', {
      filterable: true,
      writable: true,
      required: true,
    }),
    f('amount', 'Amount', 'currency', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      required: true,
    }),
    f('status', 'Status', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      enumValues: INVOICE_STATUS,
    }),
    f('dueDate', 'Due date', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
      required: true,
    }),
    f('paidDate', 'Paid date', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    CREATED,
    UPDATED,
    CUSTOM,
    f('customer', 'Customer', 'json', { relation: true, readOnly: true }),
    f('payments', 'Payments', 'json', { relation: true, readOnly: true }),
  ],

  expenses: [
    ID,
    f('description', 'Description', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('amount', 'Amount', 'currency', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      required: true,
    }),
    f('category', 'Category', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      required: true,
      enumValues: EXPENSE_CATEGORIES,
    }),
    f('incurredAt', 'Incurred', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
      required: true,
    }),
    f('departmentId', 'Department', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      description: 'Defaults to the signed-in user department.',
    }),
    f('userId', 'Owner', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      description: 'Defaults to the signed-in user.',
    }),
    CREATED,
    CUSTOM,
    f('department', 'Department', 'json', { relation: true, readOnly: true }),
    f('createdBy', 'Created by', 'json', { relation: true, readOnly: true }),
  ],

  inventory_items: [
    ID,
    f('name', 'Item', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('description', 'Description', 'text', { writable: true }),
    f('sku', 'SKU', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
    }),
    f('quantity', 'Quantity', 'number', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    f('unit', 'Unit', 'text', { filterable: true, writable: true }),
    f('minStock', 'Min stock', 'number', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    f('location', 'Location', 'text', {
      filterable: true,
      searchable: true,
      writable: true,
    }),
    CREATED,
    UPDATED,
    CUSTOM,
  ],

  users: [
    ID,
    f('name', 'Name', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      readOnly: true,
    }),
    f('email', 'Email', 'email', {
      sortable: true,
      filterable: true,
      searchable: true,
      readOnly: true,
    }),
    f('status', 'Status', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      readOnly: true,
      enumValues: ['ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'FIRED'],
    }),
    f('departmentId', 'Department', 'text', {
      filterable: true,
      groupable: true,
      readOnly: true,
    }),
    f('roleId', 'Role', 'text', { filterable: true, readOnly: true }),
    f('isVerified', 'Verified', 'boolean', { readOnly: true }),
    f('lastLoginAt', 'Last login', 'date', { sortable: true, readOnly: true }),
    CREATED,
    UPDATED,
    f('role', 'Role', 'json', { relation: true, readOnly: true }),
    f('department', 'Department', 'json', { relation: true, readOnly: true }),
  ],

  audit_logs: [
    ID,
    f('action', 'Action', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      groupable: true,
      readOnly: true,
    }),
    f('entity', 'Entity', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      groupable: true,
      readOnly: true,
    }),
    f('entityId', 'Entity id', 'text', {
      filterable: true,
      searchable: true,
      readOnly: true,
    }),
    f('actorId', 'Actor', 'text', { filterable: true, readOnly: true }),
    f('departmentId', 'Department', 'text', {
      filterable: true,
      groupable: true,
      readOnly: true,
    }),
    f('ip', 'IP address', 'text', { readOnly: true }),
    f('userAgent', 'User agent', 'text', { readOnly: true }),
    CREATED,
    f('before', 'Before', 'json', { readOnly: true }),
    f('after', 'After', 'json', { readOnly: true }),
    f('actor', 'Actor', 'json', { relation: true, readOnly: true }),
    f('department', 'Department', 'json', { relation: true, readOnly: true }),
  ],

  deals: [
    ID,
    f('name', 'Deal', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('contactId', 'Contact', 'text', {
      filterable: true,
      writable: true,
      required: true,
    }),
    f('amount', 'Amount', 'currency', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      required: true,
    }),
    f('status', 'Stage', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      enumValues: DEAL_STATUS,
    }),
    f('closeDate', 'Close date', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    f('userId', 'Owner', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      description: 'Defaults to the signed-in user.',
    }),
    CREATED,
    UPDATED,
    CUSTOM,
    f('contact', 'Contact', 'json', { relation: true, readOnly: true }),
    f('assignedTo', 'Owner', 'json', { relation: true, readOnly: true }),
  ],

  support_tickets: [
    ID,
    f('subject', 'Subject', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('description', 'Description', 'text', {
      searchable: true,
      writable: true,
    }),
    f('status', 'Status', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      enumValues: TICKET_STATUS,
    }),
    f('priority', 'Priority', 'number', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
    }),
    f('contactId', 'Customer', 'text', {
      filterable: true,
      writable: true,
      required: true,
    }),
    f('userId', 'Assignee', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      description: 'Defaults to the signed-in user.',
    }),
    f('slaDueDate', 'SLA due', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    f('resolvedAt', 'Resolved', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    f('customerRating', 'Rating', 'number', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    CREATED,
    UPDATED,
    CUSTOM,
    f('createdBy', 'Customer', 'json', { relation: true, readOnly: true }),
    f('assignedTo', 'Assignee', 'json', { relation: true, readOnly: true }),
  ],

  tasks: [
    ID,
    f('title', 'Task', 'text', {
      sortable: true,
      filterable: true,
      searchable: true,
      writable: true,
      required: true,
    }),
    f('description', 'Description', 'text', {
      searchable: true,
      writable: true,
    }),
    f('status', 'Status', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      enumValues: TASK_STATUS,
    }),
    f('priority', 'Priority', 'number', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
    }),
    f('dueDate', 'Due date', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
    }),
    f('projectId', 'Project', 'text', {
      filterable: true,
      writable: true,
      description: 'Defaults to the tenant default project.',
    }),
    f('assignedToId', 'Assignee', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      description: 'Defaults to the signed-in user.',
    }),
    CREATED,
    UPDATED,
    CUSTOM,
    f('assignedTo', 'Assignee', 'json', { relation: true, readOnly: true }),
    f('project', 'Project', 'json', { relation: true, readOnly: true }),
  ],

  attendance_records: [
    ID,
    f('userId', 'Employee', 'text', {
      filterable: true,
      groupable: true,
      writable: true,
      required: true,
    }),
    f('date', 'Date', 'date', {
      sortable: true,
      filterable: true,
      writable: true,
      required: true,
    }),
    f('status', 'Status', 'enum', {
      sortable: true,
      filterable: true,
      groupable: true,
      writable: true,
      required: true,
      enumValues: ATTENDANCE_STATUS,
    }),
    CREATED,
    f('user', 'Employee', 'json', { relation: true, readOnly: true }),
  ],
};

/** Scalar columns for a field list (relations excluded). */
export const scalarFields = (fields: FieldMeta[]): string[] =>
  fields.filter((field) => !field.relation).map((field) => field.name);

/** Fields that may be used as a text `contains` search. */
export const searchableFields = (fields: FieldMeta[]): string[] =>
  fields
    .filter((field) => field.searchable && field.type !== 'enum')
    .map((field) => field.name);

/** Fields accepted on create/update. */
export const writableFields = (fields: FieldMeta[]): string[] =>
  fields.filter((field) => field.writable).map((field) => field.name);
