import { EntityDescriptor, FieldMeta } from '../types/entity';

export type ResolvedField =
  | { kind: 'scalar'; field: FieldMeta }
  | { kind: 'nested'; relation: string; leaf: string }
  | { kind: 'custom'; path: string }
  | { kind: 'tags'; field: FieldMeta };

const CUSTOM_PREFIX = 'customFields.';

/**
 * Resolve a client-supplied field path against the entity allowlist.
 *
 * Returns `null` for anything not explicitly declared, which callers turn
 * into a `400` (never a silent ignore).
 */
export function resolveField(
  descriptor: EntityDescriptor,
  path: string,
): ResolvedField | null {
  if (!path) return null;

  if (path === 'customFields') {
    return null;
  }

  if (path.startsWith(CUSTOM_PREFIX)) {
    const customPath = path.slice(CUSTOM_PREFIX.length);
    if (!customPath || customPath.includes('.')) return null;
    const meta = descriptor.fields.find(
      (field) => field.name === 'customFields',
    );
    if (!meta?.filterable) return null;
    return { kind: 'custom', path: customPath };
  }

  const parts = path.split('.');
  if (parts.length === 1) {
    const field = descriptor.fields.find(
      (entry) => entry.name === path && entry.relation !== true,
    );
    if (!field) return null;
    if (field.name === 'tags') return { kind: 'tags', field };
    return { kind: 'scalar', field };
  }

  if (parts.length === 2) {
    const [relation, leaf] = parts;
    if (descriptor.nestedFields[relation]?.includes(leaf)) {
      return { kind: 'nested', relation, leaf };
    }
  }

  return null;
}

/** Field metadata for a writable scalar, or `undefined`. */
export function findField(
  descriptor: EntityDescriptor,
  name: string,
): FieldMeta | undefined {
  return descriptor.fields.find(
    (field) => field.name === name && field.relation !== true,
  );
}
