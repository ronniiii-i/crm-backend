import { ModuleType } from '@prisma/client';

/**
 * Renderer configuration contracts stored on `modules.config`.
 *
 * Every config carries a `version` so the frontend can migrate safely. The
 * shapes below are the source of truth for the backend normalisation and
 * validation; the frontend mirrors them in TypeScript.
 */

export const MODULE_CONFIG_VERSION = 1;

export interface TableColumnConfig {
  field: string;
  label: string;
  type?: string;
  sortable?: boolean;
  filterable?: boolean;
  width?: number;
}

export interface TableFilterConfig {
  field: string;
  label: string;
  options?: string[];
}

export interface TableConfig {
  version: typeof MODULE_CONFIG_VERSION;
  entity: string | null;
  columns: TableColumnConfig[];
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  pageSize: number;
  searchFields: string[];
  createEnabled: boolean;
  filters: TableFilterConfig[];
}

export interface KanbanColumnConfig {
  value: string;
  label: string;
  color: string;
}

export interface KanbanConfig {
  version: typeof MODULE_CONFIG_VERSION;
  entity: string | null;
  statusField: string;
  columns: KanbanColumnConfig[];
  secondaryColumns: KanbanColumnConfig[];
  titleField: string;
  valueField: string | null;
  assigneeField: string | null;
  dueField: string | null;
  allowCreate: boolean;
  allowMove: boolean;
}

export type AggregationKind = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';

export type WidgetKind = 'stat' | 'bar' | 'line' | 'pie';

export type Timeframe =
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'MTD'
  | 'QTD'
  | 'YTD'
  | 'ALL';

export interface AggregateFilter {
  field: string;
  op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value?: unknown;
}

export interface DashboardWidget {
  id: string;
  kind: WidgetKind;
  title: string;
  entity: string;
  aggregation: AggregationKind;
  field: string;
  timeframe: Timeframe;
  filters: AggregateFilter[];
  groupBy: string | null;
  format: 'number' | 'currency' | 'percent';
  color: string;
  span: number;
}

export interface DashboardConfig {
  version: typeof MODULE_CONFIG_VERSION;
  layout: 'grid';
  columns: number;
  widgets: DashboardWidget[];
}

export interface DocumentConfig {
  version: typeof MODULE_CONFIG_VERSION;
  categories: string[];
  defaultFormat: 'MARKDOWN' | 'RICH_TEXT';
  allowCreate: boolean;
  allowRichText: boolean;
}

export interface FormFieldConfig {
  name: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'currency'
    | 'date'
    | 'select'
    | 'checkbox'
    | 'email';
  required?: boolean;
  options?: string[];
  mapTo?: 'column' | 'customFields';
}

export interface FormConfig {
  version: typeof MODULE_CONFIG_VERSION;
  entity: string | null;
  mode: 'create';
  fields: FormFieldConfig[];
  submitLabel: string;
  successMessage: string;
}

export type ModuleConfig =
  | TableConfig
  | KanbanConfig
  | DashboardConfig
  | DocumentConfig
  | FormConfig;

export interface ModuleConfigByType {
  [ModuleType.DATA_TABLE]: TableConfig;
  [ModuleType.KANBAN_BOARD]: KanbanConfig;
  [ModuleType.DASHBOARD_VIEW]: DashboardConfig;
  [ModuleType.DOCUMENT_HUB]: DocumentConfig;
  [ModuleType.FORM_BUILDER]: FormConfig;
}
