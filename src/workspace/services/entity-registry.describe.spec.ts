import { ENTITY_REGISTRY } from '../entities/entity-registry';
import { EntityRegistryService } from './entity-registry.service';

describe('EntityRegistryService descriptors', () => {
  const service = new EntityRegistryService();

  it.each([
    ['projects', 'name'],
    ['departments', 'name'],
  ])('exposes %s as a read-only tenant entity', (key, displayField) => {
    const descriptor = ENTITY_REGISTRY.get(key as never);
    expect(descriptor).toBeDefined();

    const described = service.describe(descriptor!);
    expect(described.readOnly).toBe(true);
    expect(described.softDelete).toBe(false);
    expect(described.displayField).toBe(displayField);
    expect(described.supportedScopes).toEqual(['TENANT']);
  });

  it('soft deletes business entities by default', () => {
    const deals = service.describe(ENTITY_REGISTRY.get('deals')!);
    expect(deals.readOnly).toBe(false);
    expect(deals.softDelete).toBe(true);
  });

  it('publishes relation metadata for scalar foreign keys', () => {
    const deals = service.describe(ENTITY_REGISTRY.get('deals')!);

    expect(
      deals.fields.find((field) => field.name === 'contactId')?.reference,
    ).toMatchObject({ entity: 'contacts', labelField: 'firstName' });

    expect(
      deals.fields.find((field) => field.name === 'userId')?.reference,
    ).toMatchObject({
      entity: 'users',
      labelField: 'name',
      relationField: 'assignedTo',
    });
  });

  it('maps support ticket ownership onto the assignedTo relation', () => {
    const tickets = service.describe(ENTITY_REGISTRY.get('support_tickets')!);

    expect(
      tickets.fields.find((field) => field.name === 'userId')?.reference,
    ).toMatchObject({ relationField: 'assignedTo' });

    expect(
      tickets.fields.find((field) => field.name === 'contactId')?.reference,
    ).toMatchObject({ relationField: 'createdBy' });
  });

  it('marks audit network fields as sensitive', () => {
    const audit = service.describe(ENTITY_REGISTRY.get('audit_logs')!);
    expect(audit.fields.find((field) => field.name === 'ip')?.sensitive).toBe(
      true,
    );
  });

  it('exposes department references for membership-scoped entities', () => {
    const users = service.describe(ENTITY_REGISTRY.get('users')!);
    expect(
      users.fields.find((field) => field.name === 'departmentId')?.reference,
    ).toMatchObject({
      entity: 'departments',
      relationField: 'department',
    });
  });

  it('reports display and secondary fields for card/table fallbacks', () => {
    const deals = service.describe(ENTITY_REGISTRY.get('deals')!);
    expect(deals.displayField).toBe('name');
    expect(deals.secondaryDisplayFields).toEqual(['amount', 'status']);
  });
});
