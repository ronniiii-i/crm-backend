/**
 * Aggregation request contract for `POST .../aggregate`.
 *
 * The body is validated here so the controller and service share one parser.
 * Every widget is validated independently: one malformed widget becomes a
 * per-widget error instead of failing the whole dashboard.
 */

export const DASHBOARD_ENTITIES = [
  'expenses',
  'invoices',
  'deals',
  'support_tickets',
  'tasks',
] as const;

export type DashboardEntity = (typeof DASHBOARD_ENTITIES)[number];

export const AGGREGATION_KINDS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'] as const;
export type AggregationKindName = (typeof AGGREGATION_KINDS)[number];

export const TIMEFRAMES = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'MTD',
  'QTD',
  'YTD',
  'ALL',
] as const;
export type TimeframeName = (typeof TIMEFRAMES)[number];

/** Date field used to apply a timeframe, per dashboard entity. */
export const TIMEFRAME_FIELDS: Record<DashboardEntity, string> = {
  expenses: 'incurredAt',
  invoices: 'createdAt',
  deals: 'closeDate',
  support_tickets: 'resolvedAt',
  tasks: 'dueDate',
};

/** Categorical fields accepted by `groupBy`. */
export const GROUPABLE_FIELDS = [
  'status',
  'category',
  'departmentId',
  'userId',
] as const;

export interface WidgetFilter {
  field: string;
  op?:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'contains';
  value?: unknown;
}

export interface AggregateWidgetInput {
  id: string;
  entity: DashboardEntity;
  aggregation: AggregationKindName;
  field: string | null;
  timeframe: TimeframeName;
  filters: WidgetFilter[];
  groupBy: string | null;
}

export interface AggregateBody {
  widgets: AggregateWidgetInput[];
}

const WIDGET_KEYS = new Set([
  'id',
  'entity',
  'aggregation',
  'field',
  'timeframe',
  'filters',
  'groupBy',
]);

export class AggregateValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Parse and validate a single widget. Throws `AggregateValidationError` so
 * the service can box it as `{ id, error }` without aborting the batch.
 */
export function parseWidget(
  raw: unknown,
  index: number,
): AggregateWidgetInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AggregateValidationError(
      'INVALID_WIDGET',
      `Widget ${index} must be an object.`,
    );
  }

  const entry = raw as Record<string, unknown>;

  for (const key of Object.keys(entry)) {
    if (!WIDGET_KEYS.has(key)) {
      throw new AggregateValidationError(
        'UNKNOWN_WIDGET_KEY',
        `Widget ${index} has an unknown key "${key}".`,
      );
    }
  }

  const id = entry.id;
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > 120) {
    throw new AggregateValidationError(
      'INVALID_WIDGET_ID',
      `Widget ${index} requires an id of at most 120 characters.`,
    );
  }

  const entity = entry.entity;
  if (
    typeof entity !== 'string' ||
    !DASHBOARD_ENTITIES.includes(entity as DashboardEntity)
  ) {
    throw new AggregateValidationError(
      'INVALID_WIDGET_ENTITY',
      `Widget "${id}" must target one of: ${DASHBOARD_ENTITIES.join(', ')}.`,
    );
  }

  const aggregation = entry.aggregation;
  if (
    typeof aggregation !== 'string' ||
    !AGGREGATION_KINDS.includes(aggregation as AggregationKindName)
  ) {
    throw new AggregateValidationError(
      'INVALID_AGGREGATION',
      `Widget "${id}" requires an aggregation of: ${AGGREGATION_KINDS.join(', ')}.`,
    );
  }

  const field = entry.field ?? null;
  if (field !== null && (typeof field !== 'string' || field.length === 0)) {
    throw new AggregateValidationError(
      'INVALID_AGGREGATION_FIELD',
      `Widget "${id}" has an invalid field.`,
    );
  }
  if (aggregation !== 'COUNT' && !field) {
    throw new AggregateValidationError(
      'INVALID_AGGREGATION_FIELD',
      `Widget "${id}" requires a field for ${aggregation}.`,
    );
  }

  const timeframe = (entry.timeframe ?? 'ALL') as unknown;
  if (
    typeof timeframe !== 'string' ||
    !TIMEFRAMES.includes(timeframe as TimeframeName)
  ) {
    throw new AggregateValidationError(
      'INVALID_TIMEFRAME',
      `Widget "${id}" has an invalid timeframe.`,
    );
  }

  const groupBy = entry.groupBy ?? null;
  if (typeof groupBy !== 'string' && groupBy !== null) {
    throw new AggregateValidationError(
      'INVALID_GROUP_BY',
      `Widget "${id}" has an invalid groupBy.`,
    );
  }

  const filters = entry.filters ?? [];
  if (!Array.isArray(filters)) {
    throw new AggregateValidationError(
      'INVALID_WIDGET_FILTERS',
      `Widget "${id}" filters must be an array.`,
    );
  }
  if (filters.length > 10) {
    throw new AggregateValidationError(
      'INVALID_WIDGET_FILTERS',
      `Widget "${id}" supports at most 10 filters.`,
    );
  }

  return {
    id,
    entity: entity as DashboardEntity,
    aggregation: aggregation as AggregationKindName,
    field: field as string | null,
    timeframe: timeframe as TimeframeName,
    groupBy: groupBy as string | null,
    filters: filters.map((filter, filterIndex) => {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        throw new AggregateValidationError(
          'INVALID_WIDGET_FILTER',
          `Widget "${id}" filter ${filterIndex} must be an object.`,
        );
      }
      const candidate = filter as Record<string, unknown>;
      if (typeof candidate.field !== 'string' || candidate.field.length === 0) {
        throw new AggregateValidationError(
          'INVALID_WIDGET_FILTER',
          `Widget "${id}" filter ${filterIndex} requires a field.`,
        );
      }
      return {
        field: candidate.field,
        op: candidate.op as WidgetFilter['op'],
        value: candidate.value,
      };
    }),
  };
}

/** Parse the batch body, enforcing the 12 widget cap. */
export function parseAggregateBody(body: unknown): AggregateBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AggregateValidationError(
      'INVALID_BODY',
      'Aggregate body must be a JSON object.',
    );
  }

  const widgets = (body as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) {
    throw new AggregateValidationError(
      'INVALID_BODY',
      'Aggregate body requires a widgets array.',
    );
  }
  if (widgets.length === 0) {
    throw new AggregateValidationError(
      'INVALID_BODY',
      'At least one widget is required.',
    );
  }
  if (widgets.length > 12) {
    throw new AggregateValidationError(
      'TOO_MANY_WIDGETS',
      'At most 12 widgets may be requested per call.',
    );
  }

  return {
    widgets: widgets.map((widget, index) => parseWidget(widget, index)),
  };
}
