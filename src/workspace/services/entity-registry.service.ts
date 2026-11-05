import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ENTITY_REGISTRY,
  getEntityDescriptor,
  isEntityKey,
} from '../entities/entity-registry';
import { EntityDescriptor } from '../types/entity';

/**
 * Read-only access to the entity allowlist. Services use this instead of
 * touching the registry map directly so validation stays in one place.
 */
@Injectable()
export class EntityRegistryService {
  get(key: string): EntityDescriptor | undefined {
    return getEntityDescriptor(key);
  }

  require(key: string): EntityDescriptor {
    if (!isEntityKey(key)) {
      throw new BadRequestException({
        code: 'UNKNOWN_ENTITY',
        message: `Unknown entity "${key}".`,
      });
    }

    const descriptor = ENTITY_REGISTRY.get(key);
    if (!descriptor) {
      throw new BadRequestException({
        code: 'UNKNOWN_ENTITY',
        message: `Unknown entity "${key}".`,
      });
    }

    return descriptor;
  }

  /** Descriptor for a module's `targetEntity`, or null when not configured. */
  forModule(targetEntity: string | null | undefined): EntityDescriptor | null {
    if (!targetEntity) return null;
    return this.get(targetEntity) ?? null;
  }

  /** Field metadata payload used by the frontend catalog / definition. */
  describe(descriptor: EntityDescriptor) {
    return {
      key: descriptor.key,
      label: descriptor.label,
      fields: descriptor.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        relation: field.relation === true,
        sortable: field.sortable === true,
        filterable: field.filterable === true,
        searchable: field.searchable === true,
        groupable: field.groupable === true,
        writable: field.writable === true,
        required: field.required === true,
        readOnly: field.readOnly === true,
        enumValues: field.enumValues,
        description: field.description,
      })),
      defaultSort: descriptor.defaultSort,
      searchFields: descriptor.searchFields,
      statusField: descriptor.status?.field ?? null,
      statusOptions: descriptor.status?.values ?? [],
      numericFields: descriptor.numericFields,
      dateFields: descriptor.dateFields,
      groupableFields: descriptor.groupableFields,
      supportedScopes: descriptor.supportedScopes,
      readOnly: descriptor.readOnly === true,
    };
  }

  catalog() {
    return {
      entities: Array.from(ENTITY_REGISTRY.values()).map((descriptor) =>
        this.describe(descriptor),
      ),
      limits: {
        maxWidgetsPerRequest: 12,
        maxPageSize: 100,
        maxCustomFieldKeys: 50,
        maxCustomFieldValueBytes: 2048,
        maxDocumentBytes: 200 * 1024,
      },
    };
  }
}
