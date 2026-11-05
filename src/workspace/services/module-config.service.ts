import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import { EntityDescriptor } from '../types/entity';
import {
  DashboardConfig,
  DocumentConfig,
  FormConfig,
  FormFieldConfig,
  KanbanConfig,
  MODULE_CONFIG_VERSION,
  ModuleConfig,
  TableConfig,
} from '../types/module-config';
import { EntityRegistryService } from './entity-registry.service';

const DEFAULT_DOCUMENT_CATEGORIES = ['Policies', 'SOPs', 'Wiki', 'Templates'];

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Normalises and validates renderer configuration.
 *
 * Older tenants were provisioned before Phase 3 and carry `config = {}`. The
 * definition endpoint must still return a usable renderer config, so a
 * normalised default is synthesised from the module type and its entity
 * descriptor. Provisioned tenants keep their authored config untouched.
 */
@Injectable()
export class ModuleConfigService {
  constructor(private readonly registry: EntityRegistryService) {}

  normalize(module: {
    type: ModuleType;
    targetEntity: string | null;
    config: unknown;
  }): ModuleConfig {
    const defaults = this.defaults(module.type, module.targetEntity);
    const raw =
      module.config &&
      typeof module.config === 'object' &&
      !Array.isArray(module.config)
        ? (module.config as Record<string, unknown>)
        : {};

    return {
      ...defaults,
      ...raw,
      version: MODULE_CONFIG_VERSION,
    } as ModuleConfig;
  }

  /** Validate a client-supplied config for `PATCH .../config`. */
  validate(type: ModuleType, input: unknown): ModuleConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException({
        code: 'INVALID_MODULE_CONFIG',
        message: 'Module config must be an object.',
      });
    }

    const config = input as Record<string, unknown>;
    this.assertVersion(config);

    switch (type) {
      case ModuleType.DATA_TABLE:
        return this.validateTable(config);
      case ModuleType.KANBAN_BOARD:
        return this.validateKanban(config);
      case ModuleType.DASHBOARD_VIEW:
        return this.validateDashboard(config);
      case ModuleType.DOCUMENT_HUB:
        return this.validateDocument(config);
      case ModuleType.FORM_BUILDER:
        return this.validateForm(config);
      default:
        throw new BadRequestException({
          code: 'INVALID_MODULE_CONFIG',
          message: `Module type ${String(type)} has no configurable schema.`,
        });
    }
  }

  private defaults(
    type: ModuleType,
    targetEntity: string | null,
  ): ModuleConfig {
    const descriptor = this.registry.forModule(targetEntity);

    switch (type) {
      case ModuleType.DATA_TABLE:
        return this.tableDefaults(descriptor);
      case ModuleType.KANBAN_BOARD:
        return this.kanbanDefaults(descriptor);
      case ModuleType.DASHBOARD_VIEW:
        return {
          version: MODULE_CONFIG_VERSION,
          layout: 'grid',
          columns: 12,
          widgets: [],
        } satisfies DashboardConfig;
      case ModuleType.DOCUMENT_HUB:
        return {
          version: MODULE_CONFIG_VERSION,
          categories: DEFAULT_DOCUMENT_CATEGORIES,
          defaultFormat: 'MARKDOWN',
          allowCreate: true,
          allowRichText: true,
        } satisfies DocumentConfig;
      case ModuleType.FORM_BUILDER:
        return this.formDefaults(descriptor);
      default:
        return {
          version: MODULE_CONFIG_VERSION,
          layout: 'grid',
          columns: 12,
          widgets: [],
        } as DashboardConfig;
    }
  }

  private tableDefaults(descriptor: EntityDescriptor | null): TableConfig {
    if (!descriptor) {
      return {
        version: MODULE_CONFIG_VERSION,
        entity: null,
        columns: [],
        defaultSort: { field: 'createdAt', dir: 'desc' },
        pageSize: 25,
        searchFields: [],
        createEnabled: false,
        filters: [],
      };
    }

    const hidden = new Set([
      'id',
      'createdAt',
      'updatedAt',
      'customFields',
      'departmentId',
      'userId',
      'contactId',
      'customerId',
      'projectId',
      'assignedToId',
      'roleId',
    ]);

    const columns = descriptor.fields
      .filter((field) => !field.relation && !hidden.has(field.name))
      .slice(0, 7)
      .map((field) => ({
        field: field.name,
        label: field.label,
        type:
          field.type === 'currency'
            ? 'currency'
            : field.type === 'date'
              ? 'date'
              : field.type === 'enum'
                ? 'badge'
                : field.type === 'number'
                  ? 'number'
                  : 'text',
        sortable: field.sortable === true,
        filterable: field.filterable === true,
      }));

    const status = descriptor.status;

    return {
      version: MODULE_CONFIG_VERSION,
      entity: descriptor.key,
      columns,
      defaultSort: descriptor.defaultSort,
      pageSize: 25,
      searchFields: descriptor.searchFields.slice(0, 3),
      createEnabled: descriptor.readOnly !== true,
      filters: status
        ? [
            {
              field: status.field,
              label: status.field === 'status' ? 'Status' : 'Filter',
              options: status.values,
            },
          ]
        : [],
    };
  }

  private kanbanDefaults(descriptor: EntityDescriptor | null): KanbanConfig {
    const statusValues = descriptor?.status?.values ?? [];
    const palette = ['slate', 'blue', 'violet', 'amber', 'emerald', 'rose'];
    const titleField =
      descriptor?.fields.find(
        (field) =>
          field.writable &&
          (field.type === 'text' || field.type === 'email') &&
          !field.relation,
      )?.name ?? 'name';
    const valueField =
      descriptor?.numericFields.find((field) => field !== 'priority') ?? null;
    const assigneeField = descriptor?.owner.userField ?? null;
    const dueField =
      descriptor?.dateFields.find((field) =>
        ['dueDate', 'closeDate', 'slaDueDate'].includes(field),
      ) ?? null;

    return {
      version: MODULE_CONFIG_VERSION,
      entity: descriptor?.key ?? null,
      statusField: descriptor?.status?.field ?? 'status',
      columns: statusValues.slice(0, 5).map((value, index) => ({
        value,
        label: value,
        color: palette[index % palette.length],
      })),
      secondaryColumns: statusValues.slice(5).map((value) => ({
        value,
        label: value,
        color: 'rose',
      })),
      titleField,
      valueField,
      assigneeField,
      dueField,
      allowCreate: descriptor?.readOnly !== true,
      allowMove: true,
    };
  }

  private formDefaults(descriptor: EntityDescriptor | null): FormConfig {
    if (!descriptor) {
      return {
        version: MODULE_CONFIG_VERSION,
        entity: null,
        mode: 'create',
        fields: [],
        submitLabel: 'Submit',
        successMessage: 'Submitted.',
      };
    }

    const fields: FormFieldConfig[] = descriptor.fields
      .filter((field) => field.writable && !field.relation)
      .filter((field) => field.type !== 'json')
      .map((field) => ({
        name: field.name,
        label: field.label,
        type:
          field.type === 'currency'
            ? 'currency'
            : field.type === 'date'
              ? 'date'
              : field.type === 'number'
                ? 'number'
                : field.type === 'enum'
                  ? 'select'
                  : field.type === 'boolean'
                    ? 'checkbox'
                    : field.type === 'email'
                      ? 'email'
                      : field.name === 'description' || field.name === 'notes'
                        ? 'textarea'
                        : 'text',
        required: field.required === true,
        options: field.enumValues,
        mapTo: 'column',
      }));

    return {
      version: MODULE_CONFIG_VERSION,
      entity: descriptor.key,
      mode: 'create',
      fields,
      submitLabel: 'Submit',
      successMessage: 'Saved.',
    };
  }

  private assertVersion(config: Record<string, unknown>) {
    const version = config.version;
    if (version !== undefined && version !== MODULE_CONFIG_VERSION) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_CONFIG_VERSION',
        message: `Unsupported config version ${asText(version)}. Expected ${MODULE_CONFIG_VERSION}.`,
      });
    }
    config.version = MODULE_CONFIG_VERSION;
  }

  private validateTable(config: Record<string, unknown>): TableConfig {
    const columns = config.columns;
    if (!Array.isArray(columns)) {
      throw invalid('DATA_TABLE config requires a columns array.');
    }

    for (const column of columns) {
      if (
        !column ||
        typeof column !== 'object' ||
        typeof (column as Record<string, unknown>).field !== 'string'
      ) {
        throw invalid('Every table column requires a field name.');
      }
    }

    const pageSize = Number(config.pageSize ?? 25);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw invalid('pageSize must be an integer between 1 and 100.');
    }

    const defaultSort = config.defaultSort;
    if (
      !defaultSort ||
      typeof defaultSort !== 'object' ||
      typeof (defaultSort as Record<string, unknown>).field !== 'string'
    ) {
      throw invalid('defaultSort requires a field and direction.');
    }

    return {
      ...(config as unknown as TableConfig),
      pageSize,
      createEnabled: config.createEnabled !== false,
      filters: Array.isArray(config.filters)
        ? (config.filters as TableConfig['filters'])
        : [],
    };
  }

  private validateKanban(config: Record<string, unknown>): KanbanConfig {
    if (!Array.isArray(config.columns) || config.columns.length === 0) {
      throw invalid('KANBAN_BOARD config requires at least one column.');
    }

    for (const column of config.columns) {
      const value = (column as Record<string, unknown>)?.value;
      if (typeof value !== 'string') {
        throw invalid('Every kanban column requires a string value.');
      }
    }

    if (typeof config.statusField !== 'string') {
      throw invalid('KANBAN_BOARD config requires a statusField.');
    }

    return {
      ...(config as unknown as KanbanConfig),
      allowCreate: config.allowCreate !== false,
      allowMove: config.allowMove !== false,
      secondaryColumns: Array.isArray(config.secondaryColumns)
        ? (config.secondaryColumns as KanbanConfig['secondaryColumns'])
        : [],
    };
  }

  private validateDashboard(config: Record<string, unknown>): DashboardConfig {
    if (!Array.isArray(config.widgets)) {
      throw invalid('DASHBOARD_VIEW config requires a widgets array.');
    }

    const kinds = new Set(['stat', 'bar', 'line', 'pie']);
    const aggregations = new Set(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);

    for (const widget of config.widgets) {
      const entry = widget as Record<string, unknown>;
      if (typeof entry?.id !== 'string' || typeof entry?.title !== 'string') {
        throw invalid('Every widget requires an id and title.');
      }
      if (!kinds.has(String(entry.kind))) {
        throw invalid(`Unknown widget kind "${String(entry.kind)}".`);
      }
      if (!aggregations.has(String(entry.aggregation))) {
        throw invalid(`Unknown aggregation "${String(entry.aggregation)}".`);
      }
    }

    return {
      ...(config as unknown as DashboardConfig),
      layout: 'grid',
      columns: Number(config.columns ?? 12) || 12,
    };
  }

  private validateDocument(config: Record<string, unknown>): DocumentConfig {
    if (
      !Array.isArray(config.categories) ||
      config.categories.some((category) => typeof category !== 'string')
    ) {
      throw invalid('DOCUMENT_HUB config requires a categories string array.');
    }

    if (
      config.defaultFormat !== undefined &&
      !['MARKDOWN', 'RICH_TEXT'].includes(asText(config.defaultFormat))
    ) {
      throw invalid('defaultFormat must be MARKDOWN or RICH_TEXT.');
    }

    return {
      ...(config as unknown as DocumentConfig),
      defaultFormat:
        config.defaultFormat === 'RICH_TEXT' ? 'RICH_TEXT' : 'MARKDOWN',
      allowCreate: config.allowCreate !== false,
      allowRichText: config.allowRichText !== false,
    };
  }

  private validateForm(config: Record<string, unknown>): FormConfig {
    if (!Array.isArray(config.fields)) {
      throw invalid('FORM_BUILDER config requires a fields array.');
    }

    const fieldTypes = new Set([
      'text',
      'textarea',
      'number',
      'currency',
      'date',
      'select',
      'checkbox',
      'email',
    ]);

    for (const field of config.fields) {
      const entry = field as Record<string, unknown>;
      if (typeof entry?.name !== 'string' || typeof entry?.label !== 'string') {
        throw invalid('Every form field requires a name and label.');
      }
      if (!fieldTypes.has(String(entry.type))) {
        throw invalid(`Unknown form field type "${String(entry.type)}".`);
      }
      if (
        entry.mapTo !== undefined &&
        entry.mapTo !== 'column' &&
        entry.mapTo !== 'customFields'
      ) {
        throw invalid('mapTo must be column or customFields.');
      }
    }

    return {
      ...(config as unknown as FormConfig),
      mode: 'create',
      submitLabel: asText(config.submitLabel ?? 'Submit'),
      successMessage: asText(config.successMessage ?? 'Saved.'),
    };
  }
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_MODULE_CONFIG',
    message,
  });
}
